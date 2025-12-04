# ================================================================
# 📄 inbound_complete_service.py — v4.1 (전체수정)
# 페이지: 입고관리 > 입고완료
# 역할: 조회 / 단건 수정 / 삭제(+재고 롤백) / XLSX
# ================================================================

from __future__ import annotations
from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Optional, Dict, Any, List, Tuple

from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from backend.system.error_codes import DomainError


PAGE_ID = "inbound.complete"
PAGE_VERSION = "v4.1"


# -------------------------------------------------------
# 모델 지연 로딩
# -------------------------------------------------------
def _get_models():
    try:
        from backend.models import (
            InboundHeader,
            InboundItem,
            Product,
            InventoryLedger,
            StockCurrent,
        )
    except Exception as exc:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="모델 로딩 실패",
            ctx={"exc": repr(exc)},
        )

    return {
        "InboundHeader": InboundHeader,
        "InboundItem": InboundItem,
        "Product": Product,
        "InventoryLedger": InventoryLedger,
        "StockCurrent": StockCurrent,
    }


# -------------------------------------------------------
# 세션 어댑터
# -------------------------------------------------------
def _get_session_adapter(session):
    if isinstance(session, (Session, AsyncSession)):
        return session
    raise DomainError("SYSTEM-DB-901", detail="지원하지 않는 DB 세션 타입")


# -------------------------------------------------------
# 유틸
# -------------------------------------------------------
def _parse_date(field: str, value: Optional[str]):
    if value is None:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except:
        raise DomainError("INBOUND-VALID-001", detail=f"{field} 형식 오류")


def _normalize_id(raw, *, field="id"):
    try:
        v = int(raw)
    except:
        raise DomainError("INBOUND-VALID-001", detail=f"{field}는 정수여야 함")
    if v <= 0:
        raise DomainError("INBOUND-VALID-001", detail=f"{field}는 1 이상")
    return v


def _normalize_qty(raw):
    try:
        q = int(raw)
    except:
        raise DomainError("INBOUND-VALID-001", detail="qty 정수 필요")
    if q <= 0:
        raise DomainError("INBOUND-VALID-001", detail="qty는 1 이상")
    return q


def _normalize_price(raw, *, field):
    try:
        v = Decimal(str(raw))
    except:
        raise DomainError("INBOUND-VALID-001", detail=f"{field} 숫자 필요")
    if v < 0:
        raise DomainError("INBOUND-VALID-001", detail=f"{field}는 0 이상")
    return v


# =======================================================
# SERVICE
# =======================================================
class InboundCompleteService:
    page_id = PAGE_ID
    page_version = PAGE_VERSION

    def __init__(self, *, session, user):
        self.session = _get_session_adapter(session)
        self.user = user
        self.m = _get_models()

    # ---------------------------
    async def _execute(self, stmt):
        if isinstance(self.session, AsyncSession):
            return await self.session.execute(stmt)
        return self.session.execute(stmt)

    async def _commit(self):
        if isinstance(self.session, AsyncSession):
            await self.session.commit()
        else:
            self.session.commit()

    # ====================================================
    # 1) 목록 조회
    # ====================================================
    async def list_items(self, *, start_date, end_date, keyword, page, size):
        if page <= 0:
            raise DomainError("INBOUND-VALID-001", detail="page는 1 이상")
        if size <= 0 or size > 200:
            raise DomainError("INBOUND-VALID-001", detail="size 범위 오류")

        start_dt = _parse_date("start_date", start_date) if start_date else None
        end_dt = _parse_date("end_date", end_date) if end_date else None

        InboundHeader = self.m["InboundHeader"]
        InboundItem = self.m["InboundItem"]
        Product = self.m["Product"]

        filters = [
            InboundHeader.status == "committed",
            InboundHeader.deleted_at.is_(None),
            InboundItem.deleted_at.is_(None),
            Product.deleted_at.is_(None),
        ]

        if start_dt:
            filters.append(InboundHeader.inbound_date >= start_dt)
        if end_dt:
            filters.append(InboundHeader.inbound_date <= end_dt)

        if keyword:
            kw = f"%{keyword}%"
            filters.append(or_(InboundItem.sku.ilike(kw), Product.name.ilike(kw)))

        # count
        count_stmt = (
            select(func.count())
            .select_from(InboundItem)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .where(*filters)
        )
        count = (await self._execute(count_stmt)).scalar_one()

        # list
        stmt = (
            select(
                InboundItem.id,
                InboundHeader.inbound_date,
                InboundItem.sku,
                Product.name,
                InboundItem.qty,
                InboundItem.total_price,
                InboundItem.unit_price,
                InboundHeader.supplier_name,
            )
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .where(*filters)
            .order_by(
                InboundHeader.inbound_date.desc(),
                InboundItem.sku.asc(),
                Product.name.asc(),
            )
            .offset((page - 1) * size)
            .limit(size)
        )

        rows = []
        for (
            item_id,
            inbound_date_val,
            sku,
            product_name,
            qty,
            total_price,
            unit_price,
            supplier_name,
        ) in (await self._execute(stmt)).all():

            if isinstance(inbound_date_val, datetime):
                inbound_date_str = inbound_date_val.date().isoformat()
            elif isinstance(inbound_date_val, date):
                inbound_date_str = inbound_date_val.isoformat()
            else:
                inbound_date_str = None

            rows.append(
                {
                    "item_id": item_id,
                    "inbound_date": inbound_date_str,
                    "sku": sku,
                    "product_name": product_name,
                    "qty": qty,
                    "total_price": total_price,
                    "unit_price": unit_price,
                    "supplier_name": supplier_name,
                }
            )

        return {"items": rows, "count": count, "page": page, "size": size}

    # ====================================================
    # 2) 단건 수정
    # ====================================================
    async def update_item(self, *, item_id, qty, total_price, unit_price, inbound_date, supplier_name):
        iid = _normalize_id(item_id, field="item_id")

        if total_price is None:
            raise DomainError("INBOUND-VALID-001", detail="total_price 필수")

        InboundHeader = self.m["InboundHeader"]
        InboundItem = self.m["InboundItem"]

        stmt = (
            select(InboundItem, InboundHeader)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .where(
                InboundItem.id == iid,
                InboundItem.deleted_at.is_(None),
                InboundHeader.status == "committed",
            )
        )
        row = (await self._execute(stmt)).first()
        if not row:
            raise DomainError("INBOUND-NOTFOUND-101", detail="수정 대상 없음")

        item, header = row

        new_qty = _normalize_qty(qty) if qty is not None else item.qty
        new_total = _normalize_price(total_price, field="total_price")
        new_unit = new_total / new_qty

        new_date = _parse_date("inbound_date", inbound_date) if inbound_date else header.inbound_date
        new_supplier = supplier_name.strip() if supplier_name else header.supplier_name

        item.qty = new_qty
        item.total_price = new_total
        item.unit_price = new_unit
        header.inbound_date = new_date
        header.supplier_name = new_supplier

        await self._commit()

        return {
            "item_id": item.id,
            "inbound_date": new_date.isoformat() if new_date else None,
            "qty": new_qty,
            "total_price": new_total,
            "unit_price": new_unit,
            "supplier_name": new_supplier,
        }

    # ====================================================
    # 3) 삭제 + 재고 롤백
    # ====================================================
    async def delete_items(self, *, item_ids: List[int]):
        if not item_ids:
            raise DomainError("INBOUND-VALID-001", detail="삭제 ID 없음")

        norm_ids = [_normalize_id(i, field="item_id") for i in item_ids]

        InboundHeader = self.m["InboundHeader"]
        InboundItem = self.m["InboundItem"]
        InventoryLedger = self.m["InventoryLedger"]
        StockCurrent = self.m["StockCurrent"]

        stmt = (
            select(InboundItem, InboundHeader)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .where(
                InboundItem.id.in_(norm_ids),
                InboundItem.deleted_at.is_(None),
                InboundHeader.status == "committed",
            )
        )
        rows = (await self._execute(stmt)).all()
        if not rows:
            raise DomainError("INBOUND-NOTFOUND-101", detail="삭제 대상 없음")

        now = datetime.utcnow()
        deleted_ids = []

        for item, header in rows:
            item.deleted_at = now
            deleted_ids.append(item.id)

            # 1) ledger 반전
            rollback = InventoryLedger(
                sku=item.sku,
                event_type="ADJUST",
                ref_type="INBOUND",
                ref_id=header.id,
                qty_in=0,
                qty_out=item.qty,
                unit_price=item.unit_price,
                memo="입고완료 삭제 롤백",
                created_by=self.user.get("username"),
            )
            self.session.add(rollback)

            # 2) stock_current 감소
            sc_stmt = select(StockCurrent).where(StockCurrent.sku == item.sku)
            sc = (await self._execute(sc_stmt)).scalar_one_or_none()

            if sc:
                sc.qty_on_hand = max(0, sc.qty_on_hand - item.qty)
                sc.total_value = (
                    Decimal(sc.qty_on_hand) * (sc.last_unit_price or Decimal("0"))
                )
                sc.updated_by = self.user.get("username")

        await self._commit()

        return {
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
        }

    # ====================================================
    # 4) XLSX 생성
    # ====================================================
    async def export_xlsx(self, *, item_ids: List[int]) -> Tuple[BytesIO, str]:
        if not item_ids:
            raise DomainError("INBOUND-VALID-001", detail="엑셀 대상 없음")

        norm_ids = [_normalize_id(i, field="item_id") for i in item_ids]

        InboundHeader = self.m["InboundHeader"]
        InboundItem = self.m["InboundItem"]
        Product = self.m["Product"]

        stmt = (
            select(
                InboundItem.id,
                InboundHeader.inbound_date,
                InboundItem.sku,
                Product.name,
                InboundItem.qty,
                InboundItem.total_price,
                InboundItem.unit_price,
                InboundHeader.supplier_name,
            )
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .where(
                InboundItem.id.in_(norm_ids),
                InboundItem.deleted_at.is_(None),
                Product.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
                InboundHeader.status == "committed",
            )
            .order_by(InboundHeader.inbound_date.desc(), InboundItem.sku.asc())
        )

        rows = (await self._execute(stmt)).all()
        if not rows:
            raise DomainError("INBOUND-NOTFOUND-101", detail="엑셀 대상 없음")

        # openpyxl
        try:
            from openpyxl import Workbook
        except Exception as exc:
            raise DomainError(
                "SYSTEM-EXPORT-901",
                detail="xlsx 생성 실패",
                ctx={"exc": repr(exc)},
            )

        wb = Workbook()
        ws = wb.active
        ws.title = "입고완료"

        headers = [
            "입고일",
            "SKU",
            "상품명",
            "입고 수량",
            "총 단가",
            "개당 단가",
            "입고처",
        ]
        ws.append(headers)

        for (
            _item_id,
            inbound_date_val,
            sku,
            product_name,
            qty,
            total_price,
            unit_price,
            supplier_name,
        ) in rows:

            if isinstance(inbound_date_val, datetime):
                inbound_date_str = inbound_date_val.date().isoformat()
            elif isinstance(inbound_date_val, date):
                inbound_date_str = inbound_date_val.isoformat()
            else:
                inbound_date_str = ""

            def _num(v):
                if isinstance(v, Decimal):
                    return float(v)
                return v

            ws.append(
                [
                    inbound_date_str,
                    sku,
                    product_name,
                    qty,
                    _num(total_price),
                    _num(unit_price),
                    supplier_name,
                ]
            )

        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)

        filename = f"inbound-complete-{datetime.utcnow().strftime('%Y%m%d')}.xlsx"

        return buf, filename
