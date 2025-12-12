# 📄 backend/services/outbound/outbound_process_service.py
# 페이지: 출고 처리(스캔 탭)
# 역할: 송장 로드, 상품 스캔, 중량 저장, 출고 확정, 상태 조회
# v2.7 — canceled 송장도 picking으로 전환 지원 + 출고확정 시 outbound_date/ship_date 동기화(KST)
#        + 모든 응답에 header.status 포함 + 논리삭제 행(헤더/아이템) 완전 차단

from __future__ import annotations
from typing import Dict, Any, List, Optional
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
import backend.models as models_module

PAGE_ID = "outbound.process"
PAGE_VERSION = "v2.7"


# ─────────────────────────────────────────
# 모델 로딩
# ─────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    product_model = getattr(models_module, "Product", None)
    outbound_header_model = getattr(models_module, "OutboundHeader", None)
    outbound_item_model = getattr(models_module, "OutboundItem", None)
    inventory_ledger_model = getattr(models_module, "InventoryLedger", None)
    stock_current_model = getattr(models_module, "StockCurrent", None)

    missing: List[str] = []
    if product_model is None:
        missing.append("Product")
    if outbound_header_model is None:
        missing.append("OutboundHeader")
    if outbound_item_model is None:
        missing.append("OutboundItem")
    if inventory_ledger_model is None:
        missing.append("InventoryLedger")
    if stock_current_model is None:
        missing.append("StockCurrent")

    if missing:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="출고 처리 서비스 모델을 찾을 수 없습니다.",
            ctx={"page_id": PAGE_ID, "missing": missing},
        )

    return {
        "Product": product_model,
        "OutboundHeader": outbound_header_model,
        "OutboundItem": outbound_item_model,
        "InventoryLedger": inventory_ledger_model,
        "StockCurrent": stock_current_model,
    }


# ─────────────────────────────────────────
# Normalizer
# ─────────────────────────────────────────
def _normalize_invoice_no(invoice_no: str) -> str:
    value = (invoice_no or "").strip()
    if not value:
        raise DomainError(
            "OUTBOUND-VALID-001",
            detail="송장번호는 필수입니다.",
            ctx={"page_id": PAGE_ID, "field": "invoice_no"},
        )
    return value


def _normalize_barcode(barcode: str) -> str:
    value = (barcode or "").strip()
    if not value:
        raise DomainError(
            "OUTBOUND-VALID-001",
            detail="바코드는 필수입니다.",
            ctx={"page_id": PAGE_ID, "field": "barcode"},
        )
    return value


def _normalize_weight(weight_g: Any) -> int:
    try:
        value = int(weight_g)
    except Exception:
        raise DomainError(
            "OUTBOUND-VALID-001",
            detail="중량은 정수여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "weight_g"},
        )
    if value <= 0:
        raise DomainError(
            "OUTBOUND-VALID-001",
            detail="중량은 1g 이상이어야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "weight_g"},
        )
    return value


# ─────────────────────────────────────────
# 조회 유틸
# ─────────────────────────────────────────
def _get_header(session: Session, OutboundHeader, invoice_no: str):
    # 🔒 논리삭제된 헤더는 완전히 제외
    stmt = select(OutboundHeader).where(
        (OutboundHeader.order_number == invoice_no)
        | (OutboundHeader.tracking_number == invoice_no),
        OutboundHeader.deleted_at.is_(None),
    )

    header = session.execute(stmt).scalars().first()
    if header is None:
        raise DomainError(
            "OUTBOUND-NOTFOUND-101",
            detail="해당 송장번호 또는 주문번호의 출고 전표를 찾을 수 없습니다.",
            ctx={"page_id": PAGE_ID, "invoice_no": invoice_no},
        )
    return header


def _build_status(item):
    planned = getattr(item, "qty", 0) or 0
    scanned = getattr(item, "scanned_qty", 0) or 0
    return "일치" if planned == scanned else "부족"


# ─────────────────────────────────────────
# Service
# ─────────────────────────────────────────
class OutboundProcessService:
    page_id = PAGE_ID
    page_version = PAGE_VERSION

    def __init__(self, *, session: Session, user: Dict[str, Any]):
        self.session: Session = session
        self.user: Dict[str, Any] = user or {}

        raw_user_id = self.user.get("user_id") or self.user.get("sub") or 0
        try:
            self._current_user_id: int = int(raw_user_id)
        except (TypeError, ValueError):
            self._current_user_id = 0

        self._current_role: str = str(self.user.get("role", ""))

        models = _get_models()
        self.Product = models["Product"]
        self.OutboundHeader = models["OutboundHeader"]
        self.OutboundItem = models["OutboundItem"]
        self.InventoryLedger = models["InventoryLedger"]
        self.StockCurrent = models["StockCurrent"]

    # 1) 송장 로드
    async def load_invoice(self, *, invoice_no: str) -> Dict[str, Any]:
        session = self.session
        Product = self.Product
        OutboundHeader = self.OutboundHeader
        OutboundItem = self.OutboundItem

        invoice_no = _normalize_invoice_no(invoice_no)
        header = _get_header(session, OutboundHeader, invoice_no)

        # draft + canceled → picking 전환 허용
        if header.status in ["draft", "canceled"]:
            header.status = "picking"
            header.updated_at = datetime.utcnow()
            session.add(header)
            session.commit()

        # Product 와 조인해서 product_name 포함 (논리삭제 아이템은 제외)
        stmt = (
            select(
                OutboundItem,
                Product.name.label("product_name"),
            )
            .join(Product, Product.sku == OutboundItem.sku, isouter=True)
            .where(
                OutboundItem.header_id == header.id,
                OutboundItem.deleted_at.is_(None),
            )
        )
        rows = session.execute(stmt).all()

        total_qty = 0
        total_scanned = 0
        item_list: List[Dict[str, Any]] = []

        for row in rows:
            it = row[0]
            product_name = row[1]

            planned = it.qty or 0
            scanned = it.scanned_qty or 0

            total_qty += planned
            total_scanned += scanned

            item_list.append(
                {
                    "item_id": it.id,
                    "sku": it.sku,
                    "qty": planned,
                    "scanned_qty": scanned,
                    "status": _build_status(it),
                    # 🔹 프론트에서 사용하는 필드명: product_name
                    "product_name": product_name or getattr(it, "product_name", None),
                }
            )

        overall = "일치" if total_qty == total_scanned else "부족"

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "status": header.status,  # 🔹 헤더 상태(draft/picking/canceled/completed)
            "weight_g": getattr(header, "weight_g", None),
            "overall_status": overall,
            "items": item_list,
            "summary": {
                "total_qty": total_qty,
                "total_scanned": total_scanned,
            },
        }

    # 2) 상품 스캔
    async def scan_item(self, *, invoice_no: str, barcode: str) -> Dict[str, Any]:
        session = self.session
        Product = self.Product
        OutboundHeader = self.OutboundHeader
        OutboundItem = self.OutboundItem

        invoice_no = _normalize_invoice_no(invoice_no)
        barcode = _normalize_barcode(barcode)

        header = _get_header(session, OutboundHeader, invoice_no)

        if header.status not in ["picking"]:
            raise DomainError(
                "OUTBOUND-STATE-451",
                detail="출고 가능한 상태가 아닙니다.",
                ctx={"page_id": PAGE_ID, "current_status": header.status},
            )

        product = (
            session.execute(select(Product).where(Product.barcode == barcode))
            .scalars()
            .first()
        )

        if not product:
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="해당 바코드의 상품을 찾을 수 없습니다.",
                ctx={"barcode": barcode},
            )

        item = (
            session.execute(
                select(OutboundItem).where(
                    OutboundItem.header_id == header.id,
                    OutboundItem.sku == product.sku,
                    OutboundItem.deleted_at.is_(None),  # 🔒 논리삭제 아이템 제외
                )
            )
            .scalars()
            .first()
        )

        if not item:
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="해당 상품은 이 송장에 없습니다.",
                ctx={"sku": product.sku},
            )

        # 초과 스캔 시에도 product_name 포함
        if item.scanned_qty >= item.qty:
            return {
                "invoice_no": invoice_no,
                "header_id": header.id,
                "status": header.status,  # 🔹 현재 헤더 상태
                "item": {
                    "item_id": item.id,
                    "sku": item.sku,
                    "qty": item.qty,
                    "scanned_qty": item.scanned_qty,
                    "status": _build_status(item),
                    "product_name": getattr(product, "name", None),
                    "message": "초과 스캔",
                },
            }

        item.scanned_qty += 1
        item.updated_at = datetime.utcnow()
        session.add(item)
        session.commit()

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "status": header.status,  # 🔹 현재 헤더 상태
            "item": {
                "item_id": item.id,
                "sku": item.sku,
                "qty": item.qty,
                "scanned_qty": item.scanned_qty,
                "status": _build_status(item),
                # 🔹 스캔 응답에도 product_name 포함
                "product_name": getattr(product, "name", None),
            },
        }

    # 3) 중량 저장
    async def set_weight(self, *, invoice_no: str, weight_g: int) -> Dict[str, Any]:
        session = self.session
        OutboundHeader = self.OutboundHeader

        invoice_no = _normalize_invoice_no(invoice_no)
        weight = _normalize_weight(weight_g)

        header = _get_header(session, OutboundHeader, invoice_no)

        header.weight_g = weight
        header.updated_at = datetime.utcnow()

        session.add(header)
        session.commit()

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "status": header.status,  # 🔹 현재 헤더 상태
            "weight_g": weight,
        }

    # 4) 출고 확정
    async def confirm_outbound(self, *, invoice_no: str) -> Dict[str, Any]:
        session = self.session
        OutboundHeader = self.OutboundHeader
        OutboundItem = self.OutboundItem
        StockCurrent = self.StockCurrent
        InventoryLedger = self.InventoryLedger

        invoice_no = _normalize_invoice_no(invoice_no)
        header = _get_header(session, OutboundHeader, invoice_no)

        if header.status != "picking":
            raise DomainError(
                "OUTBOUND-STATE-451",
                detail="출고 가능한 상태가 아닙니다.",
                ctx={"current_status": header.status},
            )

        # 🔒 논리삭제되지 않은 아이템만 대상으로 확정
        items = (
            session.execute(
                select(OutboundItem).where(
                    OutboundItem.header_id == header.id,
                    OutboundItem.deleted_at.is_(None),
                )
            )
            .scalars()
            .all()
        )

        if not items:
            raise DomainError(
                "OUTBOUND-STATE-451",
                detail="출고 확정할 품목이 없습니다.",
                ctx={"page_id": PAGE_ID, "header_id": header.id},
            )

        for it in items:
            if it.qty != it.scanned_qty:
                raise DomainError(
                    "OUTBOUND-STATE-451",
                    detail="스캔 수량이 일치하지 않습니다.",
                    ctx={"sku": it.sku},
                )

        now = datetime.utcnow()
        kst_now = now + timedelta(hours=9)
        kst_date = kst_now.date()

        # 🔹 상품 정보 미리 로드 (묶음 여부 확인용)
        Product = self.Product
        sku_list = list({it.sku for it in items})
        products = (
            session.execute(select(Product).where(Product.sku.in_(sku_list)))
            .scalars()
            .all()
        )
        product_map = {p.sku: p for p in products}

        # 재고 차감 및 이력
        # - 묶음 SKU(is_bundle=True, base_sku/pack_qty 설정)는
        #   단품 SKU 기준으로 환산해서 차감한다.
        for it in items:
            product = product_map.get(it.sku)

            # 기본값: 그냥 단품으로 취급
            target_sku = it.sku
            factor = 1

            if product is not None:
                is_bundle = bool(getattr(product, "is_bundle", False))
                base_sku = getattr(product, "base_sku", None)
                pack_qty = getattr(product, "pack_qty", 1) or 1

                # 묶음 SKU인 경우: base_sku × pack_qty 로 환산
                if is_bundle and base_sku and pack_qty > 1:
                    target_sku = base_sku
                    factor = pack_qty

            effective_qty = it.qty * factor

            stock = (
                session.execute(
                    select(StockCurrent).where(StockCurrent.sku == target_sku)
                )
                .scalars()
                .first()
            )

            if not stock or stock.qty_on_hand < effective_qty:
                raise DomainError(
                    "OUTBOUND-STATE-451",
                    detail="재고가 부족하여 출고할 수 없습니다.",
                    ctx={"sku": target_sku},
                )

            stock.qty_on_hand -= effective_qty
            stock.updated_at = now

            memo = "출고 확정"
            if target_sku != it.sku:
                memo = f"출고 확정 (묶음:{it.sku} x {it.qty})"

            ledger = InventoryLedger(
                sku=target_sku,
                event_type="OUTBOUND",
                ref_type="OUTBOUND",
                ref_id=header.id,
                qty_in=0,
                qty_out=effective_qty,
                unit_price=stock.last_unit_price,
                memo=memo,
                created_at=now,
            )

            session.add(stock)
            session.add(ledger)

        # ★ 출고일자 동기화: outbound_complete 는 outbound_date 를 사용하므로 둘 다 세팅
        if hasattr(header, "outbound_date") and header.outbound_date is None:
            header.outbound_date = kst_date
        if hasattr(header, "ship_date") and getattr(header, "ship_date", None) is None:
            header.ship_date = kst_date

        header.status = "completed"
        header.updated_at = now

        session.add(header)
        session.commit()

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "status": header.status,
        }

    # 5) 상태 조회
    async def get_state(self, *, invoice_no: str) -> Dict[str, Any]:
        session = self.session
        OutboundHeader = self.OutboundHeader
        OutboundItem = self.OutboundItem

        invoice_no = _normalize_invoice_no(invoice_no)
        header = _get_header(session, OutboundHeader, invoice_no)

        items = (
            session.execute(
                select(OutboundItem).where(
                    OutboundItem.header_id == header.id,
                    OutboundItem.deleted_at.is_(None),
                )
            )
            .scalars()
            .all()
        )

        total_qty = sum([i.qty for i in items])
        total_scanned = sum([i.scanned_qty for i in items])

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "status": header.status,
            "overall_status": "일치" if total_qty == total_scanned else "부족",
            "weight_g": getattr(header, "weight_g", None),
            "summary": {
                "total_qty": total_qty,
                "total_scanned": total_scanned,
            },
        }
