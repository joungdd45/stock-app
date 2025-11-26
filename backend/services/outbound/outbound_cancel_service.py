# 📄 backend/services/outbound/outbound_cancel_service.py
# 페이지: 출고 취소(OutboundCancelPage)
# 역할:
#   1) 출고완료 → 출고취소된 목록 조회
#   2) 취소된 출고건을 출고등록 상태로 재출고 처리
#   3) 엑셀(xlsx) 다운로드
#
# 단계: v1.0 (Full Implementation) / 재고이찌 구조 통일 적용

from __future__ import annotations

from typing import Optional, Dict, Any, List, Tuple
from datetime import datetime, date
from io import BytesIO

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend import models as m  # ✅ backend.db 가 아니라 backend.models 사용

# 엑셀 생성
try:
    import openpyxl
except ImportError:
    openpyxl = None

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.cancel"
PAGE_VERSION = "v1.0"


# ─────────────────────────────────────────────────────────
# DTO (Router에서 참고 가능)
# ─────────────────────────────────────────────────────────
class CancelFilter:
    def __init__(self, *, date_from: Optional[date], date_to: Optional[date]):
        self.date_from = date_from
        self.date_to = date_to


class Pagination:
    def __init__(self, *, page: int = 1, size: int = 25):
        self.page = page
        self.size = size


# ─────────────────────────────────────────────────────────
# 서비스 클래스
# ─────────────────────────────────────────────────────────
class OutboundCancelService:
    """
    출고 취소 도메인 서비스

    - 출고취소 목록 조회
    - 재출고 처리
    - 엑셀 다운로드
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, db: Session, current_user: str):
        self.db = db
        self.current_user = current_user

    # ─────────────────────────────────────────────────────
    # 1) 출고취소 목록 조회
    # ─────────────────────────────────────────────────────
    def list_canceled(
        self,
        *,
        flt: CancelFilter,
        pagination: Pagination,
    ) -> Dict[str, Any]:
        """
        status = 'canceled' 인 출고 이력 조회
        기준날짜: updated_at
        """

        # VALID
        if pagination.page <= 0 or pagination.size <= 0:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="page와 size는 1 이상의 값이어야 합니다.",
                ctx={"page": pagination.page, "size": pagination.size},
            )

        conditions = [
            m.OutboundHeader.status == "canceled",
            m.OutboundHeader.deleted_at.is_(None),
        ]

        if flt.date_from:
            conditions.append(
                func.date(m.OutboundHeader.updated_at) >= flt.date_from
            )
        if flt.date_to:
            conditions.append(
                func.date(m.OutboundHeader.updated_at) <= flt.date_to
            )

        base_query = (
            self.db.query(
                m.OutboundHeader.id.label("header_id"),
                m.OutboundItem.id.label("item_id"),
                m.OutboundHeader.country.label("country"),
                m.OutboundHeader.order_number.label("order_number"),
                m.OutboundHeader.tracking_number.label("tracking_number"),
                m.OutboundItem.sku.label("sku"),
                m.Product.name.label("product_name"),
                m.OutboundItem.qty.label("qty"),
                m.OutboundHeader.weight_g.label("weight_g"),
                m.OutboundHeader.updated_at.label("updated_at"),
            )
            .join(
                m.OutboundItem,
                m.OutboundItem.header_id == m.OutboundHeader.id,
            )
            .join(
                m.Product,
                m.Product.sku == m.OutboundItem.sku,
            )
            .filter(and_(*conditions))
        )

        total_count = base_query.count()

        page = pagination.page
        size = pagination.size

        rows = (
            base_query.order_by(
                m.OutboundHeader.updated_at.desc(),
                m.OutboundHeader.id.desc(),
                m.OutboundItem.id.asc(),
            )
            .offset((page - 1) * size)
            .limit(size)
            .all()
        )

        items: List[Dict[str, Any]] = []
        for r in rows:
            items.append(
                {
                    "header_id": r.header_id,
                    "item_id": r.item_id,
                    "country": r.country,
                    "order_number": r.order_number,
                    "tracking_number": r.tracking_number,
                    "sku": r.sku,
                    "product_name": r.product_name,
                    "qty": int(r.qty) if r.qty is not None else 0,
                    # 👉 GUI의 총가격 자리에 weight_g 사용
                    "total_price": int(r.weight_g) if r.weight_g is not None else 0,
                }
            )

        return {
            "page_id": PAGE_ID,
            "page_version": PAGE_VERSION,
            "filters": {
                "date_from": flt.date_from.isoformat() if flt.date_from else None,
                "date_to": flt.date_to.isoformat() if flt.date_to else None,
            },
            "pagination": {
                "page": page,
                "size": size,
                "count": total_count,
            },
            "items": items,
        }

    # ─────────────────────────────────────────────────────
    # 2) 재출고 처리
    # ─────────────────────────────────────────────────────
    def reissue(self, *, header_ids: List[int]) -> Dict[str, Any]:
        """
        취소된 outbound_header를 새 전표로 복사하여 draft 상태로 생성
        """

        if not header_ids:
            raise DomainError(
                "OUTBOUND-VALID-002",
                detail="재출고할 출고건을 선택해야 합니다.",
                ctx={"header_ids": header_ids},
            )

        if len(header_ids) != 1:
            raise DomainError(
                "OUTBOUND-VALID-003",
                detail="재출고는 한 번에 한 건만 가능합니다.",
                ctx={"header_ids": header_ids},
            )

        header_id = header_ids[0]

        src_header: Optional[m.OutboundHeader] = (
            self.db.query(m.OutboundHeader)
            .filter(
                m.OutboundHeader.id == header_id,
                m.OutboundHeader.status == "canceled",
                m.OutboundHeader.deleted_at.is_(None),
            )
            .first()
        )

        if not src_header:
            raise DomainError(
                "OUTBOUND-NOTFOUND-001",
                detail="해당 출고 취소 전표를 찾을 수 없습니다.",
                ctx={"header_id": header_id},
            )

        src_items: List[m.OutboundItem] = (
            self.db.query(m.OutboundItem)
            .filter(
                m.OutboundItem.header_id == src_header.id,
                m.OutboundItem.deleted_at.is_(None),
            )
            .all()
        )

        if not src_items:
            raise DomainError(
                "OUTBOUND-NOTFOUND-002",
                detail="출고 취소된 품목이 존재하지 않습니다.",
                ctx={"header_id": header_id},
            )

        # 새 헤더 생성 (draft 상태)
        new_header = m.OutboundHeader(
            outbound_date=None,
            order_number=src_header.order_number,
            channel=src_header.channel,
            country=src_header.country,
            tracking_number=None,
            status="draft",
            receiver_name=src_header.receiver_name,
            created_by=self.current_user,
            memo=src_header.memo,
            weight_g=None,
            updated_by=self.current_user,
        )

        self.db.add(new_header)
        self.db.flush()  # new_header.id 확보

        item_count = 0

        for src_item in src_items:
            new_item = m.OutboundItem(
                header_id=new_header.id,
                sku=src_item.sku,
                qty=src_item.qty,
                scanned_qty=0,
                sales_price=src_item.sales_price,
                sales_total=src_item.sales_total,
                currency=src_item.currency,
                updated_by=self.current_user,
            )

            self.db.add(new_item)
            item_count += 1

        self.db.commit()

        return {
            "action": "reissue",
            "source_header_id": src_header.id,
            "new_header_id": new_header.id,
            "order_number": new_header.order_number,
            "item_count": item_count,
        }

    # ─────────────────────────────────────────────────────
    # 3) 엑셀 다운로드
    # ─────────────────────────────────────────────────────
    def export_xlsx(
        self,
        *,
        flt: CancelFilter,
        header_ids: Optional[List[int]] = None,
    ) -> Tuple[str, bytes]:

        if openpyxl is None:
            raise DomainError(
                "SYSTEM-EXCEL-001",
                detail="openpyxl 모듈이 설치되어 있지 않습니다.",
                ctx={"page_id": PAGE_ID},
            )

        conditions = [
            m.OutboundHeader.status == "canceled",
            m.OutboundHeader.deleted_at.is_(None),
        ]

        if flt.date_from:
            conditions.append(
                func.date(m.OutboundHeader.updated_at) >= flt.date_from
            )
        if flt.date_to:
            conditions.append(
                func.date(m.OutboundHeader.updated_at) <= flt.date_to
            )

        if header_ids:
            conditions.append(m.OutboundHeader.id.in_(header_ids))

        rows = (
            self.db.query(
                m.OutboundHeader.country,
                m.OutboundHeader.order_number,
                m.OutboundHeader.tracking_number,
                m.OutboundItem.sku,
                m.Product.name,
                m.OutboundItem.qty,
                m.OutboundHeader.weight_g,
            )
            .join(m.OutboundItem, m.OutboundItem.header_id == m.OutboundHeader.id)
            .join(m.Product, m.Product.sku == m.OutboundItem.sku)
            .filter(and_(*conditions))
            .order_by(
                m.OutboundHeader.updated_at.desc(),
                m.OutboundHeader.id.desc(),
                m.OutboundItem.id.asc(),
            )
            .all()
        )

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "출고취소"

        ws.append(["국가", "주문번호", "트래킹번호", "SKU", "상품명", "출고수량", "총 무게(g)"])

        for r in rows:
            ws.append(
                [
                    r[0],
                    r[1],
                    r[2],
                    r[3],
                    r[4],
                    int(r[5]) if r[5] is not None else 0,
                    int(r[6]) if r[6] is not None else 0,
                ]
            )

        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        filename = f"outbound_cancel_{date.today().isoformat()}.xlsx"

        return filename, buffer.read()
