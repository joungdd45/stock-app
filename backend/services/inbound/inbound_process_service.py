# 📄 backend/services/inbound/inbound_process_service.py
# 페이지: 입고 처리 — 바코드 스캔/등록/수량지정/입고확정
# 단계: v5.2 (register_barcode_bulk 추가: 대량 바코드 등록 1회 커밋)

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, Optional, List, Iterable, Set, Tuple

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from backend.system.error_codes import DomainError

PAGE_ID = "inbound.process"
PAGE_VERSION = "v5.2"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    backend.models 에서 필요한 모델들을 지연 임포트해서 반환.
    """
    try:
        from backend.models import (  # type: ignore
            Product,
            InboundHeader,
            InboundItem,
            InventoryLedger,
            StockCurrent,
        )
    except Exception as exc:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="입고 처리 서비스에서 모델을 불러오지 못했습니다.",
            ctx={"page_id": PAGE_ID, "exc": repr(exc)},
        )

    return {
        "Product": Product,
        "InboundHeader": InboundHeader,
        "InboundItem": InboundItem,
        "InventoryLedger": InventoryLedger,
        "StockCurrent": StockCurrent,
    }


def _get_session_adapter(session: Any) -> Any:
    if isinstance(session, (Session, AsyncSession)):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


# ─────────────────────────────────────────────────────────
# 입력 정규화/검증
# ─────────────────────────────────────────────────────────
def _normalize_barcode(raw: Optional[str]) -> str:
    if raw is None:
        raise DomainError("INBOUND-VALID-001", detail="바코드는 필수입니다.", ctx={"page_id": PAGE_ID, "field": "barcode"})
    code = raw.strip()
    if not code:
        raise DomainError("INBOUND-VALID-001", detail="바코드는 공백일 수 없습니다.", ctx={"page_id": PAGE_ID, "field": "barcode"})
    if len(code) > 50:
        raise DomainError("INBOUND-VALID-001", detail="바코드는 50자 이하만 허용됩니다.", ctx={"page_id": PAGE_ID, "field": "barcode"})
    return code


def _normalize_sku(raw: Optional[str]) -> str:
    if raw is None:
        raise DomainError("INBOUND-VALID-001", detail="SKU는 필수입니다.", ctx={"page_id": PAGE_ID, "field": "sku"})
    sku = raw.strip()
    if not sku:
        raise DomainError("INBOUND-VALID-001", detail="SKU는 공백일 수 없습니다.", ctx={"page_id": PAGE_ID, "field": "sku"})
    if len(sku) > 50:
        raise DomainError("INBOUND-VALID-001", detail="SKU는 50자 이하만 허용됩니다.", ctx={"page_id": PAGE_ID, "field": "sku"})
    return sku


def _normalize_qty(raw: Any, *, allow_zero: bool) -> int:
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        raise DomainError("INBOUND-VALID-001", detail="수량을 기입하세요.", ctx={"page_id": PAGE_ID, "field": "qty"})

    try:
        qty = int(raw)
    except Exception:
        raise DomainError("INBOUND-VALID-001", detail="수량(qty)은 정수여야 합니다.", ctx={"page_id": PAGE_ID, "field": "qty"})

    if qty < 0:
        raise DomainError("INBOUND-VALID-001", detail="수량은 음수일 수 없습니다.", ctx={"page_id": PAGE_ID, "field": "qty"})

    if not allow_zero and qty <= 0:
        raise DomainError("INBOUND-VALID-001", detail="입고 수량은 1 이상이어야 합니다.", ctx={"page_id": PAGE_ID, "field": "qty"})

    return qty


def _normalize_header_id(raw: Any) -> int:
    try:
        v = int(raw)
    except Exception:
        raise DomainError("INBOUND-VALID-001", detail="header_id는 정수여야 합니다.", ctx={"page_id": PAGE_ID, "field": "header_id"})
    if v <= 0:
        raise DomainError("INBOUND-VALID-001", detail="header_id는 1 이상이어야 합니다.", ctx={"page_id": PAGE_ID, "field": "header_id"})
    return v


def _normalize_operator(raw: Optional[str]) -> str:
    if raw is None:
        raise DomainError("INBOUND-VALID-001", detail="operator는 필수입니다.", ctx={"page_id": PAGE_ID, "field": "operator"})
    op = raw.strip()
    if not op:
        raise DomainError("INBOUND-VALID-001", detail="operator는 공백일 수 없습니다.", ctx={"page_id": PAGE_ID, "field": "operator"})
    if len(op) > 50:
        raise DomainError("INBOUND-VALID-001", detail="operator는 50자 이하만 허용됩니다.", ctx={"page_id": PAGE_ID, "field": "operator"})
    return op


def _normalize_confirm_items(raw_items: Any) -> List[Dict[str, Any]]:
    if raw_items is None:
        raise DomainError("INBOUND-VALID-001", detail="items는 필수입니다.", ctx={"page_id": PAGE_ID, "field": "items"})
    if not isinstance(raw_items, Iterable) or isinstance(raw_items, (str, bytes)):
        raise DomainError("INBOUND-VALID-001", detail="items 형식이 올바르지 않습니다.", ctx={"page_id": PAGE_ID, "field": "items"})

    items: List[Dict[str, Any]] = []
    for idx, row in enumerate(raw_items):
        if not isinstance(row, dict):
            raise DomainError("INBOUND-VALID-001", detail="items 요소는 객체여야 합니다.", ctx={"page_id": PAGE_ID, "field": "items", "index": idx})
        if "item_id" not in row:
            raise DomainError("INBOUND-VALID-001", detail="각 items에는 item_id가 필요합니다.", ctx={"page_id": PAGE_ID, "field": "items.item_id", "index": idx})
        items.append(row)

    if not items:
        raise DomainError("INBOUND-VALID-001", detail="확정할 items가 없습니다.", ctx={"page_id": PAGE_ID, "field": "items"})
    return items


# ─────────────────────────────────────────────────────────
# bulk 입력 정규화/검증
# ─────────────────────────────────────────────────────────
def _normalize_register_items(raw_items: Any) -> List[Dict[str, str]]:
    if raw_items is None:
        raise DomainError("INBOUND-VALID-001", detail="items는 필수입니다.", ctx={"page_id": PAGE_ID, "field": "items"})
    if not isinstance(raw_items, Iterable) or isinstance(raw_items, (str, bytes)):
        raise DomainError("INBOUND-VALID-001", detail="items 형식이 올바르지 않습니다.", ctx={"page_id": PAGE_ID, "field": "items"})

    out: List[Dict[str, str]] = []
    for idx, row in enumerate(raw_items):
        if not isinstance(row, dict):
            raise DomainError("INBOUND-VALID-001", detail="items 요소는 객체여야 합니다.", ctx={"page_id": PAGE_ID, "field": "items", "index": idx})

        sku_raw = row.get("sku")
        barcode_raw = row.get("barcode")

        # 개별 행은 실패로 흘릴 거라 여기서 예외를 크게 터뜨리지 않고,
        # 호출부에서 try/catch하여 fail_items에 담는다.
        sku = str(sku_raw).strip() if sku_raw is not None else ""
        barcode = str(barcode_raw).strip() if barcode_raw is not None else ""

        out.append({"sku": sku, "barcode": barcode})

    if not out:
        raise DomainError("INBOUND-VALID-001", detail="등록할 items가 없습니다.", ctx={"page_id": PAGE_ID, "field": "items"})
    return out


# ─────────────────────────────────────────────────────────
# 서비스
# ─────────────────────────────────────────────────────────
class InboundProcessService:
    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user
        self.models = _get_models()

    async def _execute(self, stmt):
        if isinstance(self.session, AsyncSession):
            return await self.session.execute(stmt)
        return self.session.execute(stmt)

    async def _fetch_one(self, stmt):
        result = await self._execute(stmt)
        return result.scalar_one_or_none()

    async def _commit(self) -> None:
        if isinstance(self.session, AsyncSession):
            await self.session.commit()
        else:
            self.session.commit()

    # 1) 바코드 스캔: 다건 후보 반환 (+ 1개면 호환 키도 제공)
    async def scan_barcode(self, *, barcode: str) -> Dict[str, Any]:
        code = _normalize_barcode(barcode)
        Product = self.models["Product"]

        stmt = select(Product).where(Product.barcode == code)
        result = await self._execute(stmt)
        products = result.scalars().all()

        if not products:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="등록된 바코드를 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "barcode": code},
            )

        candidates: List[Dict[str, Any]] = []
        for p in products:
            is_active = getattr(p, "is_active", True)
            deleted_at = getattr(p, "deleted_at", None)
            if not is_active or deleted_at is not None:
                continue
            candidates.append(
                {
                    "sku": getattr(p, "sku", None),
                    "barcode": getattr(p, "barcode", None),
                    "name": getattr(p, "name", None),
                    "brand": getattr(p, "brand", None),
                    "category": getattr(p, "category", None),
                    "last_inbound_unit_price": getattr(p, "last_inbound_unit_price", None),
                    "last_inbound_date": getattr(p, "last_inbound_date", None),
                    "is_active": is_active,
                }
            )

        if not candidates:
            raise DomainError(
                "INBOUND-STATE-451",
                detail="비활성화되었거나 삭제된 상품만 존재합니다.",
                ctx={"page_id": PAGE_ID, "barcode": code},
            )

        out: Dict[str, Any] = {"barcode": code, "count": len(candidates), "candidates": candidates}
        if len(candidates) == 1:
            out.update(candidates[0])  # 구형 응답 호환
        return out

    # 2) 바코드 등록: SKU 기준 (동일 바코드 타 SKU 사용 허용 정책)
    async def register_barcode(self, *, barcode: str, sku: str) -> Dict[str, Any]:
        code = _normalize_barcode(barcode)
        norm_sku = _normalize_sku(sku)
        Product = self.models["Product"]

        product = await self._fetch_one(select(Product).where(Product.sku == norm_sku))
        if product is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="바코드를 등록할 상품(SKU)를 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "sku": norm_sku},
            )

        is_active = getattr(product, "is_active", True)
        deleted_at = getattr(product, "deleted_at", None)
        if not is_active or deleted_at is not None:
            raise DomainError(
                "INBOUND-STATE-451",
                detail="비활성화되었거나 삭제된 상품에는 바코드를 등록할 수 없습니다.",
                ctx={"page_id": PAGE_ID, "sku": norm_sku},
            )

        current = getattr(product, "barcode", None)
        if current and current != code:
            raise DomainError(
                "INBOUND-STATE-453",
                detail="이 상품에는 이미 다른 바코드가 등록되어 있습니다.",
                ctx={"page_id": PAGE_ID, "sku": norm_sku, "current_barcode": current, "new_barcode": code},
            )

        if current == code:
            return {"sku": getattr(product, "sku", None), "barcode": current, "name": getattr(product, "name", None)}

        product.barcode = code
        await self._commit()
        return {"sku": getattr(product, "sku", None), "barcode": getattr(product, "barcode", None), "name": getattr(product, "name", None)}

    # ✅ 2-b) 바코드 대량 등록: SKU 기준 (commit 1회)
    async def register_barcode_bulk(self, *, items: Any) -> Dict[str, Any]:
        """
        대량 바코드 등록(PC 대량등록용)
        - items: [{ "sku": "...", "barcode": "..." }, ...]
        - 정책:
          * SKU 기준으로 Product 조회
          * 비활성/삭제 상품은 실패
          * 이미 다른 바코드가 등록된 SKU는 실패(단건과 동일 정책)
          * 동일 바코드가 이미 등록된 SKU는 skip 처리(성공으로 치되 업데이트 없음)
          * commit은 1회만 수행
        """
        Product = self.models["Product"]

        raw_list = _normalize_register_items(items)

        # 1) 행 단위 정규화/검증 + 중복 SKU 처리(마지막 값 우선)
        #    - 같은 SKU가 여러 번 오면 마지막 요청으로 덮어쓴다(대량 복붙 UX에서 흔함)
        sku_to_barcode: Dict[str, str] = {}
        input_order: List[str] = []
        pre_fail: List[Dict[str, Any]] = []

        for idx, row in enumerate(raw_list):
            try:
                norm_sku = _normalize_sku(row.get("sku"))
                code = _normalize_barcode(row.get("barcode"))
            except DomainError as exc:
                pre_fail.append(
                    {
                        "index": idx,
                        "sku": row.get("sku"),
                        "barcode": row.get("barcode"),
                        "code": exc.code,
                        "detail": exc.detail,
                    }
                )
                continue

            if norm_sku not in sku_to_barcode:
                input_order.append(norm_sku)
            sku_to_barcode[norm_sku] = code

        if not sku_to_barcode and pre_fail:
            return {
                "ok_count": 0,
                "skip_count": 0,
                "fail_count": len(pre_fail),
                "updated_count": 0,
                "updated_items": [],
                "fail_items": pre_fail,
            }

        sku_list = list(sku_to_barcode.keys())

        # 2) 상품 한 번에 조회
        result = await self._execute(select(Product).where(Product.sku.in_(sku_list)))
        products = result.scalars().all()
        product_map: Dict[str, Any] = {str(getattr(p, "sku")): p for p in products}

        # 3) 적용/실패/스킵 분류
        updated_items: List[Dict[str, Any]] = []
        fail_items: List[Dict[str, Any]] = list(pre_fail)
        ok_count = 0
        skip_count = 0

        for sku in input_order:
            code = sku_to_barcode[sku]
            p = product_map.get(sku)

            if p is None:
                fail_items.append(
                    {
                        "sku": sku,
                        "barcode": code,
                        "code": "INBOUND-NOTFOUND-101",
                        "detail": "바코드를 등록할 상품(SKU)를 찾을 수 없습니다.",
                    }
                )
                continue

            is_active = getattr(p, "is_active", True)
            deleted_at = getattr(p, "deleted_at", None)
            if not is_active or deleted_at is not None:
                fail_items.append(
                    {
                        "sku": sku,
                        "barcode": code,
                        "code": "INBOUND-STATE-451",
                        "detail": "비활성화되었거나 삭제된 상품에는 바코드를 등록할 수 없습니다.",
                    }
                )
                continue

            current = getattr(p, "barcode", None)

            # 단건 정책과 동일: 다른 바코드가 이미 있으면 실패
            if current and current != code:
                fail_items.append(
                    {
                        "sku": sku,
                        "barcode": code,
                        "code": "INBOUND-STATE-453",
                        "detail": "이 상품에는 이미 다른 바코드가 등록되어 있습니다.",
                        "current_barcode": current,
                    }
                )
                continue

            # 동일 바코드면 업데이트 불필요(스킵)
            if current == code:
                ok_count += 1
                skip_count += 1
                continue

            # 업데이트 대상
            p.barcode = code
            ok_count += 1
            updated_items.append(
                {
                    "sku": sku,
                    "barcode": code,
                    "name": getattr(p, "name", None),
                }
            )

        # 4) 변경이 하나라도 있으면 commit 1회
        if updated_items:
            await self._commit()

        return {
            "ok_count": ok_count,
            "skip_count": skip_count,
            "fail_count": len(fail_items),
            "updated_count": len(updated_items),
            "updated_items": updated_items,
            "fail_items": fail_items,
        }

    # 3) 수량 설정: 검증 + 조회
    async def set_qty(self, *, sku: str, qty: Any) -> Dict[str, Any]:
        norm_sku = _normalize_sku(sku)
        norm_qty = _normalize_qty(qty, allow_zero=True)

        Product = self.models["Product"]
        product = await self._fetch_one(select(Product).where(Product.sku == norm_sku))
        if product is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="수량 설정 대상 SKU를 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "sku": norm_sku},
            )

        is_active = getattr(product, "is_active", True)
        deleted_at = getattr(product, "deleted_at", None)
        if not is_active or deleted_at is not None:
            raise DomainError(
                "INBOUND-STATE-451",
                detail="비활성화되었거나 삭제된 상품은 입고 처리할 수 없습니다.",
                ctx={"page_id": PAGE_ID, "sku": norm_sku},
            )

        return {"sku": getattr(product, "sku", None), "name": getattr(product, "name", None), "qty": norm_qty}

    # 4) 확정: 기존 구조 유지(필드 유무를 hasattr로 방어)
    async def confirm(self, *, header_id: Any, items: Any, operator: Optional[str]) -> Dict[str, Any]:
        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]
        InventoryLedger = self.models["InventoryLedger"]
        StockCurrent = self.models["StockCurrent"]
        Product = self.models["Product"]

        hid = _normalize_header_id(header_id)
        rows = _normalize_confirm_items(items)
        op = _normalize_operator(operator)

        now_utc = datetime.now(timezone.utc)
        inbound_date = now_utc.date()

        header = await self._fetch_one(select(InboundHeader).where(InboundHeader.id == hid))
        if header is None:
            raise DomainError("INBOUND-CONFIRM-001", detail="입고전표를 찾을 수 없습니다.", ctx={"page_id": PAGE_ID, "header_id": hid})

        if getattr(header, "status", None) == "committed":
            raise DomainError("INBOUND-CONFIRM-002", detail="이미 확정된 입고전표입니다.", ctx={"page_id": PAGE_ID, "header_id": hid})

        item_ids: List[int] = []
        for r in rows:
            try:
                iid = int(r.get("item_id"))
            except Exception:
                raise DomainError("INBOUND-VALID-001", detail="item_id는 정수여야 합니다.", ctx={"page_id": PAGE_ID, "field": "items.item_id"})
            if iid <= 0:
                raise DomainError("INBOUND-VALID-001", detail="item_id는 1 이상이어야 합니다.", ctx={"page_id": PAGE_ID, "field": "items.item_id"})
            item_ids.append(iid)

        result_items = await self._execute(select(InboundItem).where(InboundItem.id.in_(item_ids)))
        db_items = result_items.scalars().all()

        if len(db_items) != len(item_ids):
            found = {int(getattr(x, "id")) for x in db_items}
            missing = [x for x in item_ids if x not in found]
            raise DomainError("INBOUND-CONFIRM-003", detail="일부 입고 아이템을 찾을 수 없습니다.", ctx={"page_id": PAGE_ID, "missing_item_ids": missing})

        db_item_map = {int(getattr(x, "id")): x for x in db_items}

        sku_set: Set[str] = set()
        for it in db_items:
            sku = getattr(it, "sku", None)
            if sku:
                sku_set.add(str(sku))

        product_map: Dict[str, Any] = {}
        if sku_set:
            rp = await self._execute(select(Product).where(Product.sku.in_(list(sku_set))))
            plist = rp.scalars().all()
            product_map = {str(getattr(p, "sku")): p for p in plist}

        total_qty = 0
        qty_by_sku: Dict[str, int] = {}

        for r in rows:
            iid = int(r["item_id"])
            req_sku = r.get("sku")
            req_qty = r.get("qty")

            db_item = db_item_map[iid]
            db_sku = getattr(db_item, "sku", None)

            if req_sku is not None and db_sku is not None:
                if _normalize_sku(str(req_sku)) != str(db_sku):
                    raise DomainError("INBOUND-CONFIRM-006", detail="요청한 SKU와 전표의 SKU가 일치하지 않습니다.", ctx={"page_id": PAGE_ID, "item_id": iid})

            qty = _normalize_qty(req_qty, allow_zero=False)
            if hasattr(db_item, "qty"):
                db_item.qty = qty

            total_qty += qty

            if not db_sku:
                raise DomainError("INBOUND-CONFIRM-007", detail="입고 아이템에 SKU가 없습니다.", ctx={"page_id": PAGE_ID, "item_id": iid})

            sku_key = str(db_sku)

            # 묶음/팩 처리(필드가 있을 때만)
            product = product_map.get(sku_key)
            target_sku = sku_key
            factor = 1

            if product is not None:
                is_bundle = bool(getattr(product, "is_bundle", False))
                base_sku = getattr(product, "base_sku", None)
                pack_qty = getattr(product, "pack_qty", 1) or 1
                if is_bundle and base_sku and pack_qty > 1:
                    target_sku = str(base_sku)
                    factor = int(pack_qty)

            eff = qty * factor
            qty_by_sku[target_sku] = qty_by_sku.get(target_sku, 0) + eff

        if hasattr(header, "status"):
            header.status = "committed"
        if hasattr(header, "updated_by"):
            header.updated_by = op
        if hasattr(header, "inbound_date"):
            header.inbound_date = inbound_date

        for it in db_items:
            if hasattr(it, "status"):
                it.status = "committed"
            if hasattr(it, "updated_by"):
                it.updated_by = op

        # ledger
        for sku_key, qty in qty_by_sku.items():
            ledger = InventoryLedger(
                sku=sku_key,
                event_type="INBOUND",
                ref_type="INBOUND",
                ref_id=hid,
                qty_in=qty,
                qty_out=0,
            )
            if hasattr(ledger, "process_date"):
                ledger.process_date = inbound_date
            if hasattr(ledger, "created_by"):
                ledger.created_by = op
            if hasattr(ledger, "updated_by"):
                ledger.updated_by = op
            self.session.add(ledger)

        # stock_current
        sku_list = list(qty_by_sku.keys())
        if sku_list:
            rs = await self._execute(select(StockCurrent).where(StockCurrent.sku.in_(sku_list)))
            stock_list = rs.scalars().all()
            stock_map = {str(getattr(x, "sku")): x for x in stock_list}

            for sku_key, qty in qty_by_sku.items():
                row = stock_map.get(sku_key)
                if row is None:
                    row = StockCurrent(sku=sku_key, qty_on_hand=qty, qty_reserved=0, qty_pending_out=0)
                    if hasattr(row, "updated_by"):
                        row.updated_by = op
                    self.session.add(row)
                else:
                    cur = int(getattr(row, "qty_on_hand", 0) or 0)
                    row.qty_on_hand = cur + int(qty)
                    if hasattr(row, "updated_by"):
                        row.updated_by = op

        await self._commit()

        return {
            "header_id": hid,
            "confirmed_count": len(rows),
            "total_qty": total_qty,
            "operator": op,
            "inbound_date": inbound_date.isoformat(),
        }
