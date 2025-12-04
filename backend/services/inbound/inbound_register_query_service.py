# 📄 backend/services/inbound/inbound_register_query_service.py
# 페이지: 입고관리 - 입고 등록 - 조회(inboundRegisterQueryPage)
# 역할: 비즈니스 로직 전담 (조회, 단건조회, 수정, 삭제, 검증, 상태변경, 트랜잭션, 도메인 예외)
# 단계: v2.1 (barcode 포함) / 구조 통일 작업지침 v2 적용
#
# ✅ 서비스 원칙
# - 판단/조회/계산/검증/상태변경/트랜잭션/도메인 예외만 담당
# - HTTP 상태코드, 메시지/문구, JSON 응답 포맷, Swagger 문서화는 담당하지 않음
# - 문제 발생 시 DomainError(code, detail, ctx, ...)만 던진다

from __future__ import annotations

from typing import Any, Dict, Optional, List, Tuple
from datetime import datetime

from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import or_

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.register.query"
PAGE_VERSION = "v2.0"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    실제 프로젝트 모델을 반환하도록 연결.
    """
    try:
        from backend.models import InboundHeader, InboundItem, Product
    except Exception as exc:  # pragma: no cover
        raise DomainError(
            "SYSTEM-DB-901",
            detail="inbound_register_query 서비스에서 모델을 불러오지 못했습니다.",
            ctx={"page_id": PAGE_ID, "exc": str(exc)},
        )

    return {
        "InboundHeader": InboundHeader,
        "InboundItem": InboundItem,
        "Product": Product,
    }


def _get_session_adapter(session: Any) -> Any:
    """
    동기/비동기 세션 차이를 흡수하기 위한 어댑터.
    - 현재는 Session, AsyncSession만 허용
    """
    if isinstance(session, (Session, AsyncSession)):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


def _parse_date(date_str: Optional[str], field_name: str):
    """
    YYYY-MM-DD 문자열을 date로 변환.
    """
    if date_str is None:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field_name} 형식이 올바르지 않습니다. YYYY-MM-DD 형식을 사용하세요.",
            ctx={"page_id": PAGE_ID, "field": field_name, "value": date_str},
        )


def _ensure_positive_int(value: Optional[int], field: str) -> Optional[int]:
    if value is None:
        return None
    if not isinstance(value, int) or value <= 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field} 값은 1 이상의 정수여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": field, "value": value},
        )
    return value


def _ensure_non_negative_float(
    value: Optional[float],
    field: str,
) -> Optional[float]:
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field} 값은 숫자여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": field, "value": value},
        )
    if v < 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field} 값은 0 이상이어야 합니다.",
            ctx={"page_id": PAGE_ID, "field": field, "value": value},
        )
    return v


def _calc_order_no(order_date, header_id: int) -> str:
    """
    주문번호 생성 규칙:
    - YYYYMMDD-00001 (order_date + header.id 5자리 패딩)
    """
    if order_date is None:
        prefix = "00000000"
    else:
        prefix = order_date.strftime("%Y%m%d")
    return f"{prefix}-{header_id:05d}"


# ─────────────────────────────────────────────────────────
# 서비스 클래스 — 라우터에서 DI로 주입
# ─────────────────────────────────────────────────────────
class InboundRegisterQueryService:
    """
    입고관리 - 입고 등록 - 조회 서비스 구현체.

    라우터에서는 이 클래스를 의존성으로 주입받아 사용한다.

    예)
        svc: InboundRegisterQueryService = Depends(get_service)
        result = await svc.list_items(...)
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user
        self.models = _get_models()

    # -----------------------------------------------------
    # 1) 목록 조회 — list_items
    # -----------------------------------------------------
    async def list_items(
        self,
        *,
        date_from: Optional[str],
        date_to: Optional[str],
        keyword: Optional[str],
        page: int,
        size: int,
    ) -> Dict[str, Any]:
        """
        입고 등록 목록 조회.

        - 주문일자 범위(order_date)와 키워드(SKU/상품명/입고처)로 필터
        - 한 행 = inbound_header 1건 + inbound_item 1건 + product 1건
        - 페이지 기준 합계(summary)는 현재 페이지 기준으로 계산
        """
        # 기본 검증
        if page < 1:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="page 값은 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "page": page},
            )
        if size <= 0 or size > 200:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="size 값은 1에서 200 사이여야 합니다.",
                ctx={"page_id": PAGE_ID, "size": size},
            )

        from_date = _parse_date(date_from, "date_from")
        to_date = _parse_date(date_to, "date_to")

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]
        Product = self.models["Product"]

        # 기본 쿼리 구성 (상품과 조인해서 barcode 포함)
        query = (
            self.session.query(InboundItem, InboundHeader, Product)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .filter(
                InboundItem.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
            )
        )

        # 상태 필터: draft, committed 둘 다 조회
        query = query.filter(InboundHeader.status.in_(["draft", "committed"]))

        # 날짜 필터
        if from_date is not None:
            query = query.filter(InboundHeader.order_date >= from_date)
        if to_date is not None:
            query = query.filter(InboundHeader.order_date <= to_date)

        # 키워드 필터
        if keyword:
            like_kw = f"%{keyword}%"
            query = query.filter(
                or_(
                    InboundItem.sku.ilike(like_kw),
                    Product.name.ilike(like_kw),
                    InboundHeader.supplier_name.ilike(like_kw),
                )
            )

        # 정렬 및 페이지
        query = query.order_by(
            InboundHeader.order_date.desc(),
            InboundItem.id.desc(),
        )

        offset = (page - 1) * size
        rows: List[Tuple[Any, Any, Any]] = query.offset(offset).limit(size).all()

        items: List[Dict[str, Any]] = []
        total_qty = 0
        total_amount = 0.0

        for item, header, product in rows:
            # unit_price가 없으면 total_price / qty로 계산
            if item.unit_price is not None:
                unit_price = float(item.unit_price)
            elif item.total_price is not None and item.qty:
                unit_price = float(item.total_price / item.qty)
            else:
                unit_price = 0.0

            total_price = float(item.total_price or 0)

            total_qty += item.qty or 0
            total_amount += total_price

            items.append(
                {
                    "header_id": header.id,
                    "item_id": item.id,
                    "order_no": _calc_order_no(header.order_date, header.id),
                    "order_date": header.order_date.isoformat()
                    if header.order_date
                    else None,
                    "sku": item.sku,
                    "name": product.name,
                    "qty": item.qty,
                    "unit_price": unit_price,
                    "total_price": total_price,
                    "supplier_name": header.supplier_name,
                    "status": header.status,
                    # ✅ 상품 기준 바코드 포함
                    "barcode": getattr(product, "barcode", None),
                }
            )

        result: Dict[str, Any] = {
            "page_id": PAGE_ID,
            "page_version": PAGE_VERSION,
            "filters": {
                "date_from": date_from,
                "date_to": date_to,
                "keyword": keyword,
            },
            "pagination": {
                "page": page,
                "size": size,
                "count": len(items),
            },
            "items": items,
            "summary": {
                "count": len(items),
                "total_qty": total_qty,
                "total_amount": total_amount,
            },
        }
        return result

    # -----------------------------------------------------
    # 2) 단건 조회 — get_item
    # -----------------------------------------------------
    async def get_item(
        self,
        *,
        item_id: int,
    ) -> Dict[str, Any]:
        """
        수정용 단건 조회.

        - inbound_item.id 기준
        - header.status는 draft만 허용
        """
        _ensure_positive_int(item_id, "item_id")

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]
        Product = self.models["Product"]

        row = (
            self.session.query(InboundItem, InboundHeader, Product)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .filter(
                InboundItem.id == item_id,
                InboundItem.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
            )
            .first()
        )

        if row is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="해당 입고 등록 항목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "item_id": item_id},
            )

        item, header, product = row

        if header.status != "draft":
            raise DomainError(
                "INBOUND-STATE-451",
                detail="확정된 전표는 수정할 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "item_id": item_id,
                    "header_id": header.id,
                    "status": header.status,
                },
            )

        if item.unit_price is not None:
            unit_price = float(item.unit_price)
        elif item.total_price is not None and item.qty:
            unit_price = float(item.total_price / item.qty)
        else:
            unit_price = 0.0

        total_price = float(item.total_price or 0)

        return {
            "page_id": PAGE_ID,
            "page_version": PAGE_VERSION,
            "item": {
                "header_id": header.id,
                "item_id": item.id,
                "order_no": _calc_order_no(header.order_date, header.id),
                "order_date": header.order_date.isoformat()
                if header.order_date
                else None,
                "sku": item.sku,
                "name": product.name,
                "qty": item.qty,
                "unit_price": unit_price,
                "total_price": total_price,
                "supplier_name": header.supplier_name,
                "status": header.status,
                "memo": header.memo,
                # ✅ 단건 조회에도 barcode 포함
                "barcode": getattr(product, "barcode", None),
            },
        }

    # -----------------------------------------------------
    # 3) 수정 — update_item
    # -----------------------------------------------------
    async def update_item(
        self,
        *,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        입고 등록 한 건의 수량/단가 수정.

        기대 payload 예:
            {
                "item_id": 1,
                "qty": 120,
                "unit_price": 1300.0
            }
        """
        item_id_raw = payload.get("item_id")
        qty_raw = payload.get("qty")
        unit_price_raw = payload.get("unit_price")

        item_id = _ensure_positive_int(item_id_raw, "item_id")
        qty = _ensure_positive_int(qty_raw, "qty") if qty_raw is not None else None
        unit_price = (
            _ensure_non_negative_float(unit_price_raw, "unit_price")
            if unit_price_raw is not None
            else None
        )

        if qty is None and unit_price is None:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="qty 또는 unit_price 중 최소 하나는 입력해야 합니다.",
                ctx={"page_id": PAGE_ID, "payload": payload},
            )

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]
        Product = self.models["Product"]

        row = (
            self.session.query(InboundItem, InboundHeader, Product)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .filter(
                InboundItem.id == item_id,
                InboundItem.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
            )
            .with_for_update()
            .first()
        )

        if row is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="수정할 입고 등록 항목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "item_id": item_id},
            )

        item, header, product = row

        if header.status != "draft":
            raise DomainError(
                "INBOUND-STATE-451",
                detail="확정된 전표는 수정할 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "item_id": item_id,
                    "header_id": header.id,
                    "status": header.status,
                },
            )

        # 기존 값에서 변경값 적용
        new_qty = qty if qty is not None else item.qty
        if new_qty is None or new_qty <= 0:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="수정 후 qty 값은 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "item_id": item_id, "qty": new_qty},
            )

        if unit_price is not None:
            new_unit_price = unit_price
        else:
            if item.unit_price is not None:
                new_unit_price = float(item.unit_price)
            elif item.total_price is not None and item.qty:
                new_unit_price = float(item.total_price / item.qty)
            else:
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="기존 단가 정보가 없어 unit_price를 필수로 입력해야 합니다.",
                    ctx={"page_id": PAGE_ID, "item_id": item_id},
                )

        new_total_price = float(new_unit_price) * int(new_qty)

        # 실제 업데이트
        item.qty = new_qty
        item.unit_price = new_unit_price
        item.total_price = new_total_price
        item.updated_at = datetime.utcnow()
        item.updated_by = self.user.get("username") or str(
            self.user.get("user_id", "")
        )

        header.updated_at = datetime.utcnow()
        header.updated_by = item.updated_by

        try:
            self.session.commit()
        except Exception as exc:  # pragma: no cover
            self.session.rollback()
            raise DomainError(
                "SYSTEM-UNKNOWN-999",
                detail="입고 등록 수정 처리 중 DB 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "exc": str(exc)},
            )

        return {
            "page_id": PAGE_ID,
            "page_version": PAGE_VERSION,
            "updated": {
                "header_id": header.id,
                "item_id": item.id,
                "qty": item.qty,
                "unit_price": float(item.unit_price or 0),
                "total_price": float(item.total_price or 0),
                "status": header.status,
            },
        }

    # -----------------------------------------------------
    # 4) 삭제 — delete_items
    # -----------------------------------------------------
    async def delete_items(
        self,
        *,
        item_ids: List[int],
    ) -> Dict[str, Any]:
        """
        선택된 입고 등록 항목 삭제(soft delete).

        - deleted_at, updated_by 갱신
        - header.status == 'draft'인 항목만 허용
        """
        if not item_ids:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="삭제할 항목이 선택되지 않았습니다.",
                ctx={"page_id": PAGE_ID},
            )

        # 각 id 검증
        normalized_ids: List[int] = []
        for raw_id in item_ids:
            normalized_ids.append(_ensure_positive_int(raw_id, "item_id"))

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]

        rows: List[Tuple[Any, Any]] = (
            self.session.query(InboundItem, InboundHeader)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .filter(
                InboundItem.id.in_(normalized_ids),
                InboundItem.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
            )
            .with_for_update()
            .all()
        )

        if not rows:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="삭제 대상 입고 등록 항목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "item_ids": normalized_ids},
            )

        # 상태 검증 (draft 아닌 전표가 포함되어 있으면 전부 거절)
        not_draft: List[Dict[str, Any]] = []
        for item, header in rows:
            if header.status != "draft":
                not_draft.append(
                    {
                        "header_id": header.id,
                        "item_id": item.id,
                        "status": header.status,
                    }
                )

        if not_draft:
            raise DomainError(
                "INBOUND-STATE-451",
                detail="확정된 전표의 항목은 삭제할 수 없습니다.",
                ctx={"page_id": PAGE_ID, "blocked": not_draft},
            )

        # soft delete 처리 (item 기준)
        deleted_ids: List[int] = []
        actor = self.user.get("username") or str(self.user.get("user_id", ""))

        now = datetime.utcnow()
        for item, header in rows:
            item.deleted_at = now
            item.updated_at = now
            item.updated_by = actor

            header.updated_at = now
            header.updated_by = actor

            deleted_ids.append(item.id)

        try:
            self.session.commit()
        except Exception as exc:  # pragma: no cover
            self.session.rollback()
            raise DomainError(
                "SYSTEM-UNKNOWN-999",
                detail="입고 등록 삭제 처리 중 DB 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "exc": str(exc)},
            )

        return {
            "page_id": PAGE_ID,
            "page_version": PAGE_VERSION,
            "deleted": {
                "count": len(deleted_ids),
                "item_ids": deleted_ids,
            },
        }
