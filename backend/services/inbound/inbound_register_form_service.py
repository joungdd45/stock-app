# 📄 backend/services/inbound/inbound_register_form_service.py
# 페이지: 입고관리 - 입고등록 - 등록 탭 (InboundRegisterFormPage)
# 역할: 입고등록 - 등록 탭에서 넘어온 전표·라인 데이터를 검증하고
#       inbound_header, inbound_item, product와 연계해 비즈니스 로직을 수행하는 서비스 계층 진입점
# 단계: v2.0 (서비스 구현 / DB 연결)
#
# 헌법 매핑:
# - PAGE_ID: inbound.register_form
# - 작업 순서: 1) 스펙 → 2) 라우터 스켈레톤 → 3) 서비스 스켈레톤
#              → ✅ 4) 연결(구현, 현재 단계) → 5) Swagger 검증
#
# 규칙:
# - 이 서비스는 "입고등록 - 등록 탭"의 역할만 담당한다.
#   - 하는 일:
#       1) payload 구조·필수값 검증
#       2) product.sku 존재 여부 검증
#       3) 금액 계산 규칙 적용
#          - unit_price = total_price / qty (소수 둘째 자리까지)
#       4) inbound_header(draft) 1건 + inbound_item 1건씩 생성
#   - 하지 않는 일:
#       - inventory_ledger, stock_current 생성·수정
#       - status를 draft에서 committed로 변경
#       - 재고 수량을 실제로 증감
# - 재고 반영과 ledger 기록은 별도 도메인(inbound.process)에서 담당한다.
#
# 응답 정책(서비스 레벨):
# - 생성된 전표 목록과 요약 정보를 반환한다.
#   - 주문번호 표시는 YYYYMMDD-00001 형식을 따른다.
#   - 내부 PK는 inbound_header.id를 그대로 사용한다.

from __future__ import annotations

from typing import Any, Dict, List
from datetime import datetime, date
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import SQLAlchemyError

from backend.system.error_codes import DomainError
from backend.models import InboundHeader, InboundItem, Product

# ─────────────────────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.register_form"
PAGE_VERSION = "v2.0"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 세션 어댑터
# ─────────────────────────────────────────────────────────
def _get_session_adapter(session: Any) -> Session:
    """
    동기/비동기 세션 차이를 흡수하기 위한 어댑터.

    현재 구현:
    - 동기 Session만 지원한다.
    - 그 외 타입(AsyncSession, None 등)은 SYSTEM-DB-901 도메인 에러로 처리한다.
    """
    if isinstance(session, Session):
        return session

    # AsyncSession이나 기타 타입은 아직 지원하지 않음
    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
        stage="service",
        domain=PAGE_ID,
    )


def _parse_order_date(raw: str, *, row_index: int) -> date:
    """
    yyyymmdd 형식의 문자열을 date로 변환한다.
    잘못된 형식이면 INBOUND-VALID-001 예외를 발생시킨다.
    """
    if not isinstance(raw, str) or len(raw) != 8 or not raw.isdigit():
        raise DomainError(
            "INBOUND-VALID-001",
            detail="order_date는 yyyymmdd 형식의 8자리 숫자여야 합니다.",
            ctx={"page_id": PAGE_ID, "row_index": row_index, "value": raw},
            stage="service",
            domain=PAGE_ID,
        )
    try:
        return datetime.strptime(raw, "%Y%m%d").date()
    except ValueError:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="order_date를 날짜로 변환할 수 없습니다.",
            ctx={"page_id": PAGE_ID, "row_index": row_index, "value": raw},
            stage="service",
            domain=PAGE_ID,
        )


def _to_decimal(value: Any, *, row_index: int, field: str) -> Decimal:
    """
    숫자 입력을 Decimal로 변환한다.
    실패하면 INBOUND-VALID-001 예외를 발생시킨다.
    """
    try:
        return Decimal(str(value))
    except (InvalidOperation, TypeError):
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field} 값을 숫자로 변환할 수 없습니다.",
            ctx={"page_id": PAGE_ID, "row_index": row_index, "value": value},
            stage="service",
            domain=PAGE_ID,
        )


def _generate_order_no(order_date: date, header_id: int) -> str:
    """
    표시용 주문번호를 생성한다.

    규칙:
    - YYYYMMDD-00001 형식
    - 앞의 날짜는 order_date 기준
    - 뒤의 숫자는 PK를 5자리로 zero padding
    """
    date_part = order_date.strftime("%Y%m%d")
    return f"{date_part}-{header_id:05d}"


# ─────────────────────────────────────────────────────────
# 서비스 클래스 — 라우터에서 DI로 주입
# ─────────────────────────────────────────────────────────
class InboundRegisterFormService:
    """
    입고관리 - 입고등록 - 등록 탭 서비스 구현체 v2.0.

    역할:
    - 요청 payload 검증
    - product, inbound_header, inbound_item과의 연계
    - 총 단가, 개당 단가, 수량에 대한 계산 및 검증
    - inbound_header 1건(draft), inbound_item 1건씩 다건 생성
    - 도메인 예외(DomainError) 발생

    제한:
    - 재고 이력(inventory_ledger)과 재고 현황(stock_current)은 이 서비스에서 다루지 않는다.
      실제 재고 반영은 입고처리(inbound.process) 도메인에서 수행한다.
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        """
        생성자에서 세션 타입을 검증하고, 동기 세션으로 어댑트한다.
        """
        self.session: Session = _get_session_adapter(session)
        self.user = user or {}
        # created_by, updated_by 기본값
        self._actor = self.user.get("username") or self.user.get("id") or "system"

    # -----------------------------------------------------
    # 메인 엔드포인트용 메서드 — register_inbound_form
    # -----------------------------------------------------
    async def register_inbound_form(
        self,
        *,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        입고등록 - 등록 탭 메인 액션.

        기대 payload 형식 예:
        {
          "items": [
            {
              "order_date": "20251120",
              "sku": "ABC-001",
              "qty": 10,
              "total_price": 100000,
              "supplier_name": "쿠팡",
              "memo": "선택 메모"
            },
            ...
          ]
        }

        반환 형식 예:
        {
          "page_id": "inbound.register_form",
          "page_version": "v2.0",
          "created": [
            {
              "id": 123,
              "order_no": "20251120-00001",
              "order_date": "2025-11-20",
              "supplier_name": "쿠팡",
              "sku": "ABC-001",
              "qty": 10,
              "unit_price": 10000.0,
              "total_price": 100000.0,
              "status": "draft",
            }
          ],
          "summary": {
            "count": 1,
            "total_qty": 10,
            "total_amount": 100000.0
          }
        }
        """
        items = payload.get("items")
        if not isinstance(items, list) or len(items) == 0:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="items 배열이 비어 있거나 존재하지 않습니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        # 1차 정규화 및 필수값 검증
        normalized_rows: List[Dict[str, Any]] = []
        sku_set = set()

        for idx, raw in enumerate(items):
            if not isinstance(raw, dict):
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="각 행은 객체 형태여야 합니다.",
                    ctx={"page_id": PAGE_ID, "row_index": idx},
                    stage="service",
                    domain=PAGE_ID,
                )

            order_date_raw = raw.get("order_date")
            sku = (raw.get("sku") or "").strip()
            supplier_name = (raw.get("supplier_name") or "").strip()
            qty_raw = raw.get("qty")
            total_price_raw = raw.get("total_price")
            memo = raw.get("memo")

            # 필수 필드 검증
            if not order_date_raw or not sku or qty_raw is None or total_price_raw is None or not supplier_name:
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="order_date, sku, qty, total_price, supplier_name는 필수입니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "row_index": idx,
                        "order_date": order_date_raw,
                        "sku": sku,
                        "qty": qty_raw,
                        "total_price": total_price_raw,
                        "supplier_name": supplier_name,
                    },
                    stage="service",
                    domain=PAGE_ID,
                )

            order_date = _parse_order_date(order_date_raw, row_index=idx)

            # 수량 검증
            try:
                qty_int = int(qty_raw)
            except (TypeError, ValueError):
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="qty는 1 이상 정수여야 합니다.",
                    ctx={"page_id": PAGE_ID, "row_index": idx, "value": qty_raw},
                    stage="service",
                    domain=PAGE_ID,
                )
            if qty_int <= 0:
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="qty는 1 이상이어야 합니다.",
                    ctx={"page_id": PAGE_ID, "row_index": idx, "value": qty_int},
                    stage="service",
                    domain=PAGE_ID,
                )

            total_price_dec = _to_decimal(
                total_price_raw, row_index=idx, field="total_price"
            )
            if total_price_dec < Decimal("0"):
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="total_price는 0 이상이어야 합니다.",
                    ctx={"page_id": PAGE_ID, "row_index": idx, "value": str(total_price_dec)},
                    stage="service",
                    domain=PAGE_ID,
                )

            normalized_rows.append(
                {
                    "row_index": idx,
                    "order_date": order_date,
                    "sku": sku,
                    "supplier_name": supplier_name,
                    "qty": qty_int,
                    "total_price": total_price_dec,
                    "memo": memo,
                }
            )
            sku_set.add(sku)

        # SKU 존재 여부 검증
        try:
            existing_rows = self.session.execute(
                select(Product.sku).where(Product.sku.in_(sku_set))
            )
            existing_skus = {row[0] for row in existing_rows}
        except SQLAlchemyError as exc:
            raise DomainError(
                "SYSTEM-DB-901",
                detail="SKU 목록 조회 중 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "exc": str(exc)},
                stage="service",
                domain=PAGE_ID,
            )

        missing_skus = sorted(list(sku_set - existing_skus))
        if missing_skus:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="존재하지 않는 SKU가 포함되어 있습니다.",
                ctx={"page_id": PAGE_ID, "missing_skus": missing_skus},
                stage="service",
                domain=PAGE_ID,
            )

        created_rows: List[Dict[str, Any]] = []
        total_qty = 0
        total_amount = Decimal("0")

        try:
            for row in normalized_rows:
                qty_int = row["qty"]
                total_price_dec = row["total_price"]

                # 단가 계산 — 소수 둘째 자리까지
                unit_price_dec = (
                    total_price_dec / Decimal(qty_int)
                ).quantize(Decimal("0.01"))

                header = InboundHeader(
                    inbound_date=None,  # 실제 입고일자는 입고처리 단계에서 확정 가능
                    order_date=row["order_date"],
                    supplier_name=row["supplier_name"],
                    status="draft",
                    created_by=self._actor,
                    memo=row["memo"],
                    updated_by=self._actor,
                )
                self.session.add(header)
                # PK(id) 확보를 위한 flush
                self.session.flush()

                item = InboundItem(
                    header_id=header.id,
                    sku=row["sku"],
                    qty=qty_int,
                    unit_price=unit_price_dec,
                    total_price=total_price_dec,
                    updated_by=self._actor,
                )
                self.session.add(item)

                order_no = _generate_order_no(row["order_date"], header.id)

                created_rows.append(
                    {
                        "id": header.id,
                        "order_no": order_no,
                        "order_date": row["order_date"].isoformat(),
                        "supplier_name": row["supplier_name"],
                        "sku": row["sku"],
                        "qty": qty_int,
                        "unit_price": float(unit_price_dec),
                        "total_price": float(total_price_dec),
                        "status": header.status,
                    }
                )

                total_qty += qty_int
                total_amount += total_price_dec

            # 전표들 일괄 커밋
            self.session.commit()

        except SQLAlchemyError as exc:
            self.session.rollback()
            raise DomainError(
                "SYSTEM-DB-901",
                detail="입고등록 저장 중 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "exc": str(exc)},
                stage="service",
                domain=PAGE_ID,
            )

        return {
            "page_id": self.page_id,
            "page_version": self.page_version,
            "created": created_rows,
            "summary": {
                "count": len(created_rows),
                "total_qty": total_qty,
                "total_amount": float(total_amount),
            },
        }
