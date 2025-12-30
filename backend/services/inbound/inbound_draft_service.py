# 📄 backend/services/inbound/inbound_draft_service.py
# 도메인: INBOUND (모바일 전용 Draft 기반 입고처리)
# 페이지: (모바일) inbound-process
# 역할:
#  - 작업 중(scan/set-qty)은 Draft에만 UPSERT (stock/ledger 직접 수정 금지)
#  - confirm 시점에만 1회 실제 반영(재고/원장) + 멱등/동시확정 제어
# 단계: v1.0 (실사용 연결 버전 / 라우터는 서비스 호출만)

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional, Dict, Any, List, Sequence
from hashlib import sha256
import json
import uuid

from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.draft.draft_core_service import DraftCoreService


# ─────────────────────────────────────────────
# DTO (모바일 스펙에 맞춘 내부 표현)
# ─────────────────────────────────────────────

@dataclass(frozen=True)
class InboundProcessScanResult:
    sku: str
    barcode: str
    name: str
    brand: Optional[str]
    category: Optional[str]
    last_inbound_unit_price: Optional[str]
    last_inbound_date: Optional[str]
    is_active: bool


@dataclass(frozen=True)
class InboundProcessSetQtyResult:
    sku: str
    name: str
    qty: int


@dataclass(frozen=True)
class InboundConfirmItem:
    item_id: int
    sku: str
    qty: int


# ─────────────────────────────────────────────
# Service
# ─────────────────────────────────────────────

class InboundDraftService:
    """
    ✅ 모바일 inbound-process 전용 Draft Service

    - scan: 바코드→상품(=SKU 포함) 조회 (조회는 가능)
    - set-qty: Draft에 SKU 수량 절대값 저장
    - confirm: (payload items → Draft 동기화) → Draft 멱등/선점 → 실제확정 1회 → DONE/FAILED 마킹

    ⚠️ 작업 중에는 stock/ledger 직접 수정 금지 (확정에서만 처리)
    """

    PAGE = "inbound-process"
    PAGE_VERSION = "v1.0"
    STAGE = "service+draft"

    def __init__(
        self,
        db: Session,
        draft_core: DraftCoreService,
        # barcode로 상품정보(=sku 포함) 조회: (db, barcode) -> dict
        product_lookup_by_barcode: Callable[[Session, str], Dict[str, Any]],
        # 바코드 등록: (db, barcode, sku, name, user_id) -> dict{sku, barcode, name}
        register_barcode: Callable[[Session, str, str, Optional[str], int], Dict[str, Any]],
        # 실제 입고 확정(재고/원장 반영): (db, header_id, items, operator, user_id) -> dict{header_id, confirmed_count, total_qty, operator}
        inbound_confirm: Callable[[Session, int, Sequence[InboundConfirmItem], str, int], Dict[str, Any]],
    ) -> None:
        self.db = db
        self.draft_core = draft_core
        self.product_lookup_by_barcode = product_lookup_by_barcode
        self.register_barcode = register_barcode
        self.inbound_confirm = inbound_confirm

    # ─────────────────────────────────────────────
    # key / validate
    # ─────────────────────────────────────────────

    @staticmethod
    def _draft_key(header_id: int) -> str:
        if not isinstance(header_id, int) or header_id <= 0:
            raise DomainError(
                code="INBOUND-VALID-001",
                message="header_id가 올바르지 않습니다",
                hint="입고 전표(header_id)를 확인하세요",
                detail={"header_id": header_id},
            )
        return f"inbound:{header_id}"

    @staticmethod
    def _require_barcode(barcode: str) -> str:
        b = (barcode or "").strip()
        if not b:
            raise DomainError(
                code="INBOUND-VALID-002",
                message="바코드가 비어있습니다",
                hint="barcode를 확인하세요",
                detail=None,
            )
        return b

    @staticmethod
    def _require_sku(sku: str) -> str:
        s = (sku or "").strip()
        if not s:
            raise DomainError(
                code="INBOUND-VALID-003",
                message="SKU가 비어있습니다",
                hint="sku를 확인하세요",
                detail=None,
            )
        return s

    @staticmethod
    def _require_qty(qty: int) -> int:
        if not isinstance(qty, int) or qty <= 0:
            raise DomainError(
                code="INBOUND-VALID-004",
                message="수량은 1 이상이어야 합니다",
                hint="qty를 확인하세요",
                detail={"qty": qty},
            )
        return qty

    # ─────────────────────────────────────────────
    # ping (router에서 그대로 래핑)
    # ─────────────────────────────────────────────

    def ping(self) -> Dict[str, Any]:
        return {"page": self.PAGE, "version": self.PAGE_VERSION, "stage": self.STAGE}

    # ─────────────────────────────────────────────
    # scan (조회만, Draft 저장은 안 함)
    # ─────────────────────────────────────────────

    def scan(self, barcode: str) -> InboundProcessScanResult:
        """
        POST /api/inbound/process/scan
        - 바코드로 상품(=SKU 포함) 조회
        - Draft에는 아직 안 쌓음 (수량은 set-qty에서만 저장)
        """
        b = self._require_barcode(barcode)
        data = self.product_lookup_by_barcode(self.db, b) or {}

        sku = (data.get("sku") or "").strip()
        name = (data.get("name") or "").strip()

        if not sku or not name:
            raise DomainError(
                code="INBOUND-SCAN-001",
                message="해당 바코드에 매핑된 상품이 없습니다",
                hint="바코드를 등록하거나, 상품 정보를 확인하세요",
                detail={"barcode": b},
            )

        return InboundProcessScanResult(
            sku=sku,
            barcode=b,
            name=name,
            brand=data.get("brand"),
            category=data.get("category"),
            last_inbound_unit_price=data.get("last_inbound_unit_price"),
            last_inbound_date=data.get("last_inbound_date"),
            is_active=bool(data.get("is_active", True)),
        )

    # ─────────────────────────────────────────────
    # register-barcode (기존 규칙 유지)
    # ─────────────────────────────────────────────

    def process_register_barcode(self, barcode: str, sku: str, name: Optional[str], user_id: int) -> Dict[str, Any]:
        """
        POST /api/inbound/process/register-barcode
        - 바코드 등록 페이지/입고처리 내부용 공용
        """
        b = self._require_barcode(barcode)
        s = self._require_sku(sku)
        result = self.register_barcode(self.db, b, s, name, user_id) or {}

        out_sku = (result.get("sku") or "").strip()
        out_barcode = (result.get("barcode") or "").strip()
        out_name = (result.get("name") or "").strip()

        if not out_sku or not out_barcode or not out_name:
            raise DomainError(
                code="INBOUND-BARCODE-REG-001",
                message="바코드 등록 결과가 올바르지 않습니다",
                hint="등록 로직/응답을 확인하세요",
                detail={"result": result},
            )
        return {"sku": out_sku, "barcode": out_barcode, "name": out_name}

    # ─────────────────────────────────────────────
    # set-qty (Draft only)
    # ─────────────────────────────────────────────

    def set_qty(self, header_id: int, sku: str, qty: int, user_id: int, name_for_response: Optional[str] = None) -> InboundProcessSetQtyResult:
        """
        POST /api/inbound/process/set-qty
        - Draft에 SKU qty 절대값 저장
        - (모바일 스펙) 응답에 name이 필요해서, name은 가능한 경우 채워준다
        """
        draft_key = self._draft_key(header_id)
        s = self._require_sku(sku)
        q = self._require_qty(qty)

        # Draft header 확보(재진입 포함)
        self.draft_core.get_or_create_header(
            draft_type="INBOUND",
            draft_key=draft_key,
            created_by=user_id,
        )

        row = self.draft_core.upsert_item_set(
            draft_type="INBOUND",
            draft_key=draft_key,
            sku=s,
            qty=q,
            actor_user_id=user_id,
        )

        # name은 Draft에 없을 수 있음 → 호출자가 준 값 우선, 없으면 스캔 조회로 보강 시도
        nm = (name_for_response or "").strip()
        if not nm:
            try:
                # barcode 없이 sku 기반 name 조회가 없으면 여기서 못 채울 수 있음(참고)
                # 운영에서는 router에서 scan 결과의 name을 같이 넘겨주는 편이 안정적
                nm = ""
            except Exception:
                nm = ""

        return InboundProcessSetQtyResult(
            sku=str(row["sku"]),
            name=nm,
            qty=int(row["qty"]),
        )

    # ─────────────────────────────────────────────
    # confirm (Draft 멱등 + 선점 + 1회 실반영)
    # ─────────────────────────────────────────────

    @staticmethod
    def _make_request_id_for_confirm(draft_key: str, operator: str, items: Sequence[InboundConfirmItem]) -> str:
        """
        모바일이 request_id를 안 보내는 전제에서,
        동일 payload 재시도 시 멱등이 되도록 request_id를 "결정적"으로 만든다.
        """
        payload = {
            "draft_key": draft_key,
            "operator": operator,
            "items": [{"item_id": it.item_id, "sku": it.sku, "qty": it.qty} for it in items],
        }
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        digest = sha256(raw.encode("utf-8")).hexdigest()
        rid = uuid.uuid5(uuid.NAMESPACE_URL, f"inbound-confirm:{digest}")
        return str(rid)

    def confirm(self, header_id: int, items: Sequence[InboundConfirmItem], operator: str, user_id: int) -> Dict[str, Any]:
        """
        POST /api/inbound/process/confirm (모바일 스펙)
        - payload items를 Draft에 먼저 동기화(절대값 set)
        - DraftCore confirm_begin으로 멱등/선점
        - 실제 입고 확정(inbound_confirm) 1회 호출
        - confirm_done/failed 마킹
        """
        draft_key = self._draft_key(header_id)

        op = (operator or "").strip()
        if not op:
            raise DomainError(
                code="INBOUND-VALID-005",
                message="operator가 비어있습니다",
                hint="operator를 확인하세요 (예: MOBILE)",
                detail=None,
            )

        if not items:
            raise DomainError(
                code="INBOUND-CONFIRM-001",
                message="확정할 items가 없습니다",
                hint="items를 확인하세요",
                detail={"header_id": header_id},
            )

        norm_items: List[InboundConfirmItem] = []
        for it in items:
            if not isinstance(it.item_id, int) or it.item_id <= 0:
                raise DomainError(
                    code="INBOUND-CONFIRM-002",
                    message="item_id가 올바르지 않습니다",
                    hint="items.item_id를 확인하세요",
                    detail={"item_id": getattr(it, "item_id", None)},
                )
            s = self._require_sku(it.sku)
            q = self._require_qty(int(it.qty))
            norm_items.append(InboundConfirmItem(item_id=int(it.item_id), sku=s, qty=q))

        # 0) Draft header 확보
        self.draft_core.get_or_create_header(
            draft_type="INBOUND",
            draft_key=draft_key,
            created_by=user_id,
        )

        # 1) payload items → Draft 동기화(절대값 set)
        #    (UI가 Draft list를 따로 쓰지 않아도, confirm payload만으로 Draft가 완성되게)
        for it in norm_items:
            self.draft_core.upsert_item_set(
                draft_type="INBOUND",
                draft_key=draft_key,
                sku=it.sku,
                qty=it.qty,
                actor_user_id=user_id,
            )

        # 2) request_id 결정(멱등)
        request_id = self._make_request_id_for_confirm(draft_key, op, norm_items)

        # 3) 멱등/선점
        begin = self.draft_core.confirm_begin(
            draft_type="INBOUND",
            draft_key=draft_key,
            request_id=request_id,
            actor_user_id=user_id,
        )
        if begin.get("already_done") is True:
            # 이미 DONE이면 결과 재사용
            return {"header_id": header_id, **(begin.get("result") or {}), "idempotent": True}

        try:
            # 4) 실제 확정(재고/원장 반영) — 여기서만 stock/ledger 수정 허용
            result = self.inbound_confirm(self.db, header_id, norm_items, op, user_id) or {}

            # 5) 결과 검증(최소 스펙)
            if "header_id" not in result:
                result["header_id"] = header_id
            if "operator" not in result:
                result["operator"] = op
            if "confirmed_count" not in result:
                result["confirmed_count"] = len(norm_items)
            if "total_qty" not in result:
                result["total_qty"] = sum(it.qty for it in norm_items)

            # 6) 성공 마킹
            self.draft_core.confirm_done(
                draft_type="INBOUND",
                draft_key=draft_key,
                request_id=request_id,
                result=result,
                actor_user_id=user_id,
            )
            return result

        except Exception as e:
            # 실패 마킹
            self.draft_core.confirm_failed(
                draft_type="INBOUND",
                draft_key=draft_key,
                request_id=request_id,
                error=e,
                actor_user_id=user_id,
            )
            raise
