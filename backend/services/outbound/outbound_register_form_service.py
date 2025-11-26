# 📄 backend/services/outbound/outbound_register_form_service.py
# 페이지: 출고등록 - 등록 탭 (OutboundRegisterFormPage)
# 역할: 출고 등록 탭 비즈니스 로직 전담 (검증/그룹핑/전표 생성/트랜잭션/도메인 예외)
# 단계: v2.1 (Sync 세션, 헤더/아이템 생성까지 구현, r2 스펙 반영)
#
# ✅ 서비스 원칙
# - 판단/조회/계산/검증/상태변경/트랜잭션/도메인 예외만 담당한다.
# - HTTP 상태코드, 메시지/문구, JSON 응답 포맷, Swagger 문서화는 담당하지 않는다.
# - 문제 발생 시 DomainError(code, detail, ctx, ...)만 던진다.
#
# ✅ 현재 단계
# - Product.sku 존재 여부 검증
# - 입력 행 검증/정규화
# - (country, order_number, tracking_number) 기준 헤더 그룹핑
# - outbound_header / outbound_item 생성까지 구현
#   (outbound_header에는 country만 저장, 합계 수량/금액은 아이템 단위로 관리)
# - 재고/ledger 반영은 다음 단계에서 확장 예정
#
# PAGE_ID 매핑:
# - PAGE_ID: "outbound.register.form"
# - 파일명: outbound_register_form_service.py
# - 서비스 클래스: OutboundRegisterFormService

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Tuple, Iterable, DefaultDict
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.register.form"
PAGE_VERSION = "v2.1"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    실제 프로젝트 모델을 반환하도록 연결.

    사용 모델:
    - OutboundHeader (출고 전표 헤더)
    - OutboundItem   (출고 전표 라인)
    - Product        (상품, SKU 검증용)
    """
    try:
        from backend.models import (
            OutboundHeader,
            OutboundItem,
            Product,
        )
    except Exception as exc:  # pragma: no cover
        raise DomainError(
            "SYSTEM-DB-901",
            detail="출고등록 등록 탭 모델을 불러오지 못했습니다.",
            ctx={"page_id": PAGE_ID, "reason": "MODEL_IMPORT_FAILED", "exc": str(exc)},
            stage="service",
            domain=PAGE_ID,
        )

    return {
        "OutboundHeader": OutboundHeader,
        "OutboundItem": OutboundItem,
        "Product": Product,
    }


def _get_session_adapter(session: Any) -> Session:
    """
    Sync 세션(Session) 전용 어댑터.

    - sqlalchemy.orm.Session 타입만 허용한다.
    """
    if isinstance(session, Session):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
        stage="service",
        domain=PAGE_ID,
    )


# ─────────────────────────────────────────────────────────
# 내부 DTO — 서비스 내부 전용
# ─────────────────────────────────────────────────────────
@dataclass
class NormalizedRow:
    country: str
    order_number: str
    tracking_number: str
    sku: str
    product_name: str
    qty: int
    total_price: Decimal


@dataclass
class HeaderGroup:
    """
    (country, order_number, tracking_number) 단위로 묶인 그룹.
    """
    country: str
    order_number: str
    tracking_number: str
    rows: List[NormalizedRow]

    @property
    def total_qty(self) -> int:
        return sum(r.qty for r in self.rows)

    @property
    def total_price(self) -> Decimal:
        total = Decimal("0")
        for r in self.rows:
            total += r.total_price
        return total


# ─────────────────────────────────────────────────────────
# 서비스 클래스 — 라우터에서 DI로 주입
# ─────────────────────────────────────────────────────────
class OutboundRegisterFormService:
    """
    출고등록 - 등록 탭 서비스 구현체.

    라우터에서는 이 클래스를 의존성으로 주입받아 사용한다.

    예)
        svc: OutboundRegisterFormService = Depends(get_service)
        result = await svc.register(items=payload.items)
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session: Session = _get_session_adapter(session)
        self.user = user or {}
        self.user_id: int = int(self.user.get("user_id", 0))

        self.models = _get_models()
        self.OutboundHeader = self.models["OutboundHeader"]
        self.OutboundItem = self.models["OutboundItem"]
        self.Product = self.models["Product"]

    # -----------------------------------------------------
    # 공개 메서드: 출고 전표 일괄 등록
    # -----------------------------------------------------
    async def register(
        self,
        *,
        items: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """
        출고등록 - 등록 탭 일괄 처리 메서드.

        1) 입력 행 검증/정규화
        2) SKU → Product 매핑 검증
        3) (country, order_number, tracking_number) 기준 헤더 그룹핑
        4) outbound_header / outbound_item 생성
        5) 트랜잭션 커밋 후 생성 개수 반환
        """
        if not items:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="등록할 출고 데이터가 없습니다.",
                ctx={"page_id": PAGE_ID, "method": "register"},
                stage="service",
                domain=PAGE_ID,
            )

        # 1) 행 정규화/검증
        normalized_rows = self._normalize_and_validate_items(items)

        # 2) SKU 존재 여부 검증
        product_by_sku = self._load_and_validate_products(normalized_rows)

        # 3) 헤더별 그룹핑
        header_groups = self._group_by_header(normalized_rows)

        # 4) 전표/라인 생성
        created_headers, created_items = self._create_headers_and_items(
            header_groups,
            product_by_sku=product_by_sku,
        )

        # ⚠️ 5) 재고/ledger 반영은 다음 단계에서 확장 예정

        # 최종 커밋
        self.session.commit()

        return {
            "created_headers": created_headers,
            "created_items": created_items,
        }

    # -----------------------------------------------------
    # 1단계: 입력 행 정규화/검증
    # -----------------------------------------------------
    def _normalize_and_validate_items(
        self,
        items: Iterable[Dict[str, Any]],
    ) -> List[NormalizedRow]:
        normalized: List[NormalizedRow] = []
        row_index = 0

        for raw in items:
            row_index += 1

            try:
                country = (raw.get("country") or "").strip().upper()
                order_number = (raw.get("order_number") or "").strip()
                tracking_number = (raw.get("tracking_number") or "").strip()
                sku = (raw.get("sku") or "").strip()
                product_name = (raw.get("product_name") or "").strip()
                qty_raw = raw.get("qty", raw.get("quantity"))
                total_price_raw = raw.get("total_price")

                # 필수값 검증
                if not country or not order_number or not tracking_number or not sku or not product_name:
                    raise DomainError(
                        "OUTBOUND-VALID-002",
                        detail="필수값이 누락된 행이 있습니다.",
                        ctx={
                            "page_id": PAGE_ID,
                            "row_index": row_index,
                            "country": country,
                            "order_number": order_number,
                            "tracking_number": tracking_number,
                            "sku": sku,
                            "product_name": product_name,
                        },
                        stage="service",
                        domain=PAGE_ID,
                    )

                # 수량 검증
                try:
                    qty = int(qty_raw)
                except (TypeError, ValueError):
                    raise DomainError(
                        "OUTBOUND-VALID-003",
                        detail="출고수량은 정수여야 합니다.",
                        ctx={"page_id": PAGE_ID, "row_index": row_index, "qty": qty_raw},
                        stage="service",
                        domain=PAGE_ID,
                    )
                if qty <= 0:
                    raise DomainError(
                        "OUTBOUND-VALID-004",
                        detail="출고수량은 1 이상이어야 합니다.",
                        ctx={"page_id": PAGE_ID, "row_index": row_index, "qty": qty},
                        stage="service",
                        domain=PAGE_ID,
                    )

                # 총 가격 검증 (0 이상, Decimal 변환)
                total_price = self._to_decimal(
                    total_price_raw,
                    field="total_price",
                    row_index=row_index,
                )
                if total_price < Decimal("0"):
                    raise DomainError(
                        "OUTBOUND-VALID-005",
                        detail="총 가격은 0 이상이어야 합니다.",
                        ctx={
                            "page_id": PAGE_ID,
                            "row_index": row_index,
                            "total_price": str(total_price),
                        },
                        stage="service",
                        domain=PAGE_ID,
                    )

            except DomainError:
                # 그대로 위로 전파
                raise
            except Exception as exc:
                # 예기치 못한 예외는 SYSTEM 계열로 래핑
                raise DomainError(
                    "SYSTEM-UNKNOWN-999",
                    detail="출고등록 입력 행 처리 중 오류가 발생했습니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "row_index": row_index,
                        "raw": raw,
                        "exc": str(exc),
                    },
                    stage="service",
                    domain=PAGE_ID,
                )

            normalized.append(
                NormalizedRow(
                    country=country,
                    order_number=order_number,
                    tracking_number=tracking_number,
                    sku=sku,
                    product_name=product_name,
                    qty=qty,
                    total_price=total_price,
                )
            )

        return normalized

    def _to_decimal(
        self,
        value: Any,
        *,
        field: str,
        row_index: int,
    ) -> Decimal:
        """
        숫자/문자/float 등을 Decimal로 변환.
        - 1,000 처럼 콤마가 섞여도 허용
        """
        if value is None:
            raise DomainError(
                "OUTBOUND-VALID-006",
                detail=f"{field} 값이 비어 있습니다.",
                ctx={"page_id": PAGE_ID, "row_index": row_index},
                stage="service",
                domain=PAGE_ID,
            )

        if isinstance(value, (int, float, Decimal)):
            try:
                return Decimal(str(value))
            except InvalidOperation:
                pass
        else:
            # 문자열 처리: 콤마 제거
            try:
                txt = str(value).replace(",", "").strip()
                return Decimal(txt)
            except InvalidOperation:
                pass

        raise DomainError(
            "OUTBOUND-VALID-007",
            detail=f"{field} 값이 숫자가 아닙니다.",
            ctx={"page_id": PAGE_ID, "row_index": row_index, "value": str(value)},
            stage="service",
            domain=PAGE_ID,
        )

    # -----------------------------------------------------
    # 2단계: SKU → Product 매핑 검증
    # -----------------------------------------------------
    def _load_and_validate_products(
        self,
        rows: List[NormalizedRow],
    ) -> Dict[str, Any]:
        skus = sorted({r.sku for r in rows})
        if not skus:
            raise DomainError(
                "OUTBOUND-VALID-008",
                detail="SKU 정보가 없습니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        stmt = select(self.Product).where(self.Product.sku.in_(skus))
        products = self.session.execute(stmt).scalars().all()

        product_by_sku: Dict[str, Any] = {p.sku: p for p in products}

        missing = [sku for sku in skus if sku not in product_by_sku]
        if missing:
            raise DomainError(
                "OUTBOUND-VALID-101",
                detail=f"등록되지 않은 SKU가 있습니다: {missing[0]}",
                ctx={
                    "page_id": PAGE_ID,
                    "missing_skus": missing,
                },
                stage="service",
                domain=PAGE_ID,
            )

        return product_by_sku

    # -----------------------------------------------------
    # 3단계: 헤더 그룹핑
    # -----------------------------------------------------
    def _group_by_header(
        self,
        rows: List[NormalizedRow],
    ) -> List[HeaderGroup]:
        """
        (country, order_number, tracking_number) 기준으로 그룹핑.
        - 한 송장/주문 묶음을 하나의 outbound_header로 본다.
        """
        groups: DefaultDict[
            Tuple[str, str, str],
            List[NormalizedRow],
        ] = defaultdict(list)

        for r in rows:
            key = (r.country, r.order_number, r.tracking_number)
            groups[key].append(r)

        result: List[HeaderGroup] = []
        for (country, order_number, tracking_number), group_rows in groups.items():
            result.append(
                HeaderGroup(
                    country=country,
                    order_number=order_number,
                    tracking_number=tracking_number,
                    rows=group_rows,
                )
            )

        return result

    # -----------------------------------------------------
    # 4단계: outbound_header / outbound_item 생성
    # -----------------------------------------------------
    def _create_headers_and_items(
        self,
        header_groups: List[HeaderGroup],
        *,
        product_by_sku: Dict[str, Any],
    ) -> Tuple[int, int]:
        created_headers = 0
        created_items = 0

        now = datetime.utcnow()
        today = date.today()

        for group in header_groups:
            # 이미 동일 송장번호가 존재하는지 체크
            existing_header = (
                self.session.execute(
                    select(self.OutboundHeader).where(
                        self.OutboundHeader.tracking_number == group.tracking_number
                    )
                )
                .scalars()
                .first()
            )
            if existing_header is not None:
                raise DomainError(
                    "OUTBOUND-CONFLICT-101",
                    detail=f"이미 등록된 송장번호입니다: {group.tracking_number}",
                    ctx={
                        "page_id": PAGE_ID,
                        "tracking_number": group.tracking_number,
                        "order_number": group.order_number,
                        "country": group.country,
                    },
                    stage="service",
                    domain=PAGE_ID,
                )

            # 헤더 생성 (r2 스펙 기준: country / order_number / tracking_number 등만 사용)
            header = self.OutboundHeader(
                outbound_date=today,
                order_number=group.order_number,
                channel=None,                    # 필요 시 채널 매핑 로직 추가
                country=group.country,
                tracking_number=group.tracking_number,
                status="draft",                  # 초기 상태
                receiver_name=None,
                created_by=self.user_id,
                memo=None,
                weight_g=None,
                updated_by=self.user_id,
                created_at=now,
                updated_at=now,
            )
            self.session.add(header)
            self.session.flush()  # header.id 확보

            # 라인 생성
            for row in group.rows:
                # 존재 여부 검증용 product 조회 (현재는 값만 확인용, 컬럼에 직접 쓰지는 않음)
                _product = product_by_sku[row.sku]

                # 판매총액/단가 계산
                sales_total = row.total_price
                sales_price = (
                    (row.total_price / Decimal(row.qty))
                    if row.qty > 0
                    else Decimal("0")
                )

                item = self.OutboundItem(
                    header_id=header.id,
                    sku=row.sku,
                    qty=row.qty,
                    scanned_qty=0,
                    sales_price=sales_price,
                    sales_total=sales_total,
                    currency=None,            # 필요 시 국가→통화 매핑 로직 추가
                    updated_by=self.user_id,
                    created_at=now,
                    updated_at=now,
                )
                self.session.add(item)
                created_items += 1

            created_headers += 1

        self.session.flush()
        return created_headers, created_items

    # -----------------------------------------------------
    # (다음 단계용) 재고/ledger 반영 자리
    # -----------------------------------------------------
    # def _apply_inventory_effects(...):
    #     """
    #     TODO: 재고 차감 및 inventory_ledger 기록 추가
    #     - 현재 단계에서는 구현하지 않는다.
    #     - OUTBOUND-LEDGER-001 같은 코드로 분리 예정.
    #     """
    #     raise DomainError(...)
