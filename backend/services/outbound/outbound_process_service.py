# 📄 backend/services/outbound/outbound_process_service.py
# 페이지: 출고 처리(스캔 탭)
# 역할: 비즈니스 로직 전담 (송장 로드, 상품 스캔, 중량 설정, 출고 확정, 진행상태 조회 + 재고/장부 반영)
# 단계: v2.1 (상태 전환 로직 반영)
#
# ✅ 상태 흐름
# - draft  → picking    : 송장 load 시
# - picking → completed : 출고 확정 시

from __future__ import annotations
from typing import Dict, Any, List, Optional

from datetime import datetime
from sqlalchemy import select

from backend.system.error_codes import DomainError

PAGE_ID = "outbound.process"
PAGE_VERSION = "v2.1"

_SESSION_FACTORY: Optional[Any] = None
_MODELS_FN: Optional[Any] = None


def configure_outbound_process_service(*, session_factory: Any, models_fn: Any) -> None:
    global _SESSION_FACTORY, _MODELS_FN
    _SESSION_FACTORY = session_factory
    _MODELS_FN = models_fn


def _ensure_config_ready() -> None:
    if _SESSION_FACTORY is None or _MODELS_FN is None:
        raise DomainError(
            "SYSTEM-UNKNOWN-999",
            detail="출고 처리 서비스의 세션/모델 팩토리가 설정되지 않았습니다",
            ctx={"page_id": PAGE_ID},
        )


def _get_session():
    _ensure_config_ready()
    session = _SESSION_FACTORY()
    if session is None:
        raise DomainError(
            "SYSTEM-UNKNOWN-999",
            detail="세션 팩토리에서 세션을 생성하지 못했습니다",
            ctx={"page_id": PAGE_ID},
        )
    return session


def _get_models() -> Dict[str, Any]:
    _ensure_config_ready()
    models = _MODELS_FN()
    required = ["Product", "OutboundHeader", "OutboundItem", "InventoryLedger", "StockCurrent"]
    missing = [k for k in required if k not in models]

    if missing:
        raise DomainError(
            "SYSTEM-UNKNOWN-999",
            detail="출고 처리 서비스 모델이 설정되지 않았습니다",
            ctx={"page_id": PAGE_ID, "missing": missing},
        )
    return models


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


def _get_header(session, models, invoice_no: str):
    OutboundHeader = models["OutboundHeader"]

    stmt = select(OutboundHeader).where(
        OutboundHeader.order_number == invoice_no   # type: ignore
    )

    header = session.execute(stmt).scalars().first()
    if header is None:
        raise DomainError(
            "OUTBOUND-NOTFOUND-101",
            detail="해당 송장번호의 출고 전표를 찾을 수 없습니다.",
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

    # 1) 송장 로드
    async def load_invoice(self, *, invoice_no: str) -> Dict[str, Any]:

        session = _get_session()
        models = _get_models()

        invoice_no = _normalize_invoice_no(invoice_no)
        header = _get_header(session, models, invoice_no)

        # ✅ 상태 전환: draft → picking
        if header.status == "draft":
            header.status = "picking"
            header.updated_at = datetime.utcnow()
            session.add(header)
            session.commit()

        OutboundItem = models["OutboundItem"]

        stmt = select(OutboundItem).where(
            OutboundItem.header_id == header.id   # type: ignore
        )

        items = session.execute(stmt).scalars().all()

        total_qty = 0
        total_scanned = 0

        item_list = []
        for it in items:
            planned = it.qty or 0
            scanned = it.scanned_qty or 0

            total_qty += planned
            total_scanned += scanned

            item_list.append({
                "item_id": it.id,
                "sku": it.sku,
                "qty": planned,
                "scanned_qty": scanned,
                "status": _build_status(it),
            })

        overall = "일치" if total_qty == total_scanned else "부족"

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "status": header.status,
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

        session = _get_session()
        models = _get_models()

        invoice_no = _normalize_invoice_no(invoice_no)
        barcode = _normalize_barcode(barcode)

        header = _get_header(session, models, invoice_no)

        if header.status not in ["picking"]:
            raise DomainError(
                "OUTBOUND-STATE-451",
                detail="출고 가능한 상태가 아닙니다.",
                ctx={"page_id": PAGE_ID, "current_status": header.status},
            )

        Product = models["Product"]
        OutboundItem = models["OutboundItem"]

        product = session.execute(
            select(Product).where(Product.barcode == barcode)   # type: ignore
        ).scalars().first()

        if not product:
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="해당 바코드의 상품을 찾을 수 없습니다.",
                ctx={"barcode": barcode},
            )

        item = session.execute(
            select(OutboundItem).where(
                OutboundItem.header_id == header.id,   # type: ignore
                OutboundItem.sku == product.sku,
            )
        ).scalars().first()

        if not item:
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="해당 상품은 이 송장에 없습니다.",
                ctx={"sku": product.sku},
            )

        if item.scanned_qty >= item.qty:
            return {
                "invoice_no": invoice_no,
                "header_id": header.id,
                "item": {
                    "item_id": item.id,
                    "sku": item.sku,
                    "qty": item.qty,
                    "scanned_qty": item.scanned_qty,
                    "status": _build_status(item),
                    "message": "초과 스캔"
                }
            }

        item.scanned_qty += 1
        item.updated_at = datetime.utcnow()

        session.add(item)
        session.commit()

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "item": {
                "item_id": item.id,
                "sku": item.sku,
                "qty": item.qty,
                "scanned_qty": item.scanned_qty,
                "status": _build_status(item),
            },
        }

    # 3) 중량 저장
    async def set_weight(self, *, invoice_no: str, weight_g: int) -> Dict[str, Any]:

        session = _get_session()
        models = _get_models()

        invoice_no = _normalize_invoice_no(invoice_no)
        weight = _normalize_weight(weight_g)

        header = _get_header(session, models, invoice_no)

        header.weight_g = weight
        header.updated_at = datetime.utcnow()

        session.add(header)
        session.commit()

        return {
            "invoice_no": invoice_no,
            "header_id": header.id,
            "weight_g": weight,
        }

    # 4) 출고 확정
    async def confirm_outbound(self, *, invoice_no: str) -> Dict[str, Any]:

        session = _get_session()
        models = _get_models()

        invoice_no = _normalize_invoice_no(invoice_no)
        header = _get_header(session, models, invoice_no)

        if header.status != "picking":
            raise DomainError(
                "OUTBOUND-STATE-451",
                detail="출고 가능한 상태가 아닙니다.",
                ctx={"current_status": header.status}
            )

        OutboundItem = models["OutboundItem"]
        StockCurrent = models["StockCurrent"]
        InventoryLedger = models["InventoryLedger"]

        items = session.execute(
            select(OutboundItem).where(
                OutboundItem.header_id == header.id   # type: ignore
            )
        ).scalars().all()

        for it in items:
            if it.qty != it.scanned_qty:
                raise DomainError(
                    "OUTBOUND-STATE-451",
                    detail="스캔 수량이 일치하지 않습니다.",
                    ctx={"sku": it.sku}
                )

        now = datetime.utcnow()

        for it in items:

            stock = session.execute(
                select(StockCurrent).where(StockCurrent.sku == it.sku)
            ).scalars().first()

            if not stock or stock.qty_on_hand < it.qty:
                raise DomainError(
                    "OUTBOUND-STATE-451",
                    detail="재고가 부족하여 출고할 수 없습니다.",
                    ctx={"sku": it.sku}
                )

            stock.qty_on_hand -= it.qty
            stock.updated_at = now

            ledger = InventoryLedger(
                sku=it.sku,
                event_type="OUTBOUND",
                ref_type="OUTBOUND",
                ref_id=header.id,
                qty_in=0,
                qty_out=it.qty,
                unit_price=stock.last_unit_price,
                memo="출고 확정",
                created_at=now,
            )

            session.add(stock)
            session.add(ledger)

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

        session = _get_session()
        models = _get_models()

        invoice_no = _normalize_invoice_no(invoice_no)
        header = _get_header(session, models, invoice_no)

        OutboundItem = models["OutboundItem"]

        items = session.execute(
            select(OutboundItem).where(
                OutboundItem.header_id == header.id   # type: ignore
            )
        ).scalars().all()

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
