# 📄 backend/services/outbound/outbound_draft_service.py
# 도메인: OUTBOUND (모바일 전용 Draft 기반 출고처리)
# 페이지: (모바일) outbound-process
# 역할:
#  - 작업 중(invoice 로드 / scan / weight)은 Draft에만 저장(재고/원장 직접 수정 금지)
#  - confirm 시점에만 1회 실제 반영(재고/원장) + 멱등/동시확정 제어
#  - ✅ weight는 draft_header.meta_json에 저장
#
# 단계: v1.0 (실사용 연결 버전 / 라우터는 서비스 호출만)

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Optional, Dict, Any, List, Sequence, Tuple
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
class OutboundInvoiceItem:
    sku: str
    name: str
    qty: int  # 주문 수량(출고해야 할 수량)


@dataclass(frozen=True)
class OutboundInvoiceSummary:
    total_items: int
    total_qty: int
    scanned_qty: int
    remaining_qty: int
    is_ready_to_confirm: bool


@dataclass(frozen=True)
class OutboundInvoiceView:
    invoice_no: str
    items: List[OutboundInvoiceItem]
    scanned_map: Dict[str, int]  # sku -> scanned_qty
    weight: Optional[int]
    summary: OutboundInvoiceSummary


@dataclass(frozen=True)
class OutboundScanResult:
    invoice_no: str
    sku: str
    barcode: str
    name: str
    scanned_qty: int
    required_qty: int
    remaining_qty: int


# ─────────────────────────────────────────────
# Service
# ─────────────────────────────────────────────

class OutboundDraftService:
    """
    ✅ 모바일 outbound-process 전용 Draft Service

    - invoice 조회: 기본 주문(필요 수량)은 기존 데이터에서 읽고,
      scanned_qty는 Draft에서 합산해 붙인다.
    - scan: 바코드→SKU 조회 후 Draft에 +1 누적
    - weight: draft_header.meta_json에 저장
    - confirm: Draft 멱등/선점 후 실제 출고 확정(재고/원장 반영) 1회 수행
    """

    PAGE = "outbound-process"
    PAGE_VERSION = "v1.0"
    STAGE = "service+draft"

    def __init__(
        self,
        db: Session,
        draft_core: DraftCoreService,
        # 송장(invoice_no) 기반으로 "출고해야 할 품목"을 조회: (db, invoice_no) -> dict
        # 기대 형태(최소):
        # {
        #   "invoice_no": "...",
        #   "items": [{"sku": "...", "name": "...", "qty": 3}, ...]
        # }
        load_invoice_items: Callable[[Session, str], Dict[str, Any]],
        # 상품 바코드→상품(=sku 포함) 조회: (db, barcode) -> dict
        # 기대 형태(최소): {"sku": "...", "name": "..."}
        product_lookup_by_barcode: Callable[[Session, str], Dict[str, Any]],
        # 실제 출고 확정(재고/원장 반영): (db, invoice_no, items, weight, operator, user_id) -> dict(result)
        # items는 "확정에 필요한 sku/qty" 목록(일반적으로 주문 수량 또는 스캔 수량)
        outbound_confirm: Callable[[Session, str, Sequence[Tuple[str, int]], Optional[int], str, int], Dict[str, Any]],
    ) -> None:
        self.db = db
        self.draft_core = draft_core
        self.load_invoice_items = load_invoice_items
        self.product_lookup_by_barcode = product_lookup_by_barcode
        self.outbound_confirm = outbound_confirm

    # ─────────────────────────────────────────────
    # key / validate
    # ─────────────────────────────────────────────

    @staticmethod
    def _draft_key(invoice_no: str) -> str:
        inv = (invoice_no or "").strip()
        if not inv:
            raise DomainError(
                code="OUTBOUND-VALID-001",
                message="invoice_no가 비어있습니다",
                hint="송장번호(invoice_no)를 확인하세요",
                detail=None,
            )
        return f"invoice:{inv}"

    @staticmethod
    def _require_barcode(barcode: str) -> str:
        b = (barcode or "").strip()
        if not b:
            raise DomainError(
                code="OUTBOUND-VALID-002",
                message="바코드가 비어있습니다",
                hint="barcode를 확인하세요",
                detail=None,
            )
        return b

    @staticmethod
    def _require_weight(weight: int) -> int:
        if not isinstance(weight, int) or weight <= 0:
            raise DomainError(
                code="OUTBOUND-VALID-003",
                message="무게는 1 이상이어야 합니다",
                hint="weight를 확인하세요",
                detail={"weight": weight},
            )
        return weight

    # ─────────────────────────────────────────────
    # ping
    # ─────────────────────────────────────────────

    def ping(self) -> Dict[str, Any]:
        return {"page": self.PAGE, "version": self.PAGE_VERSION, "stage": self.STAGE}

    # ─────────────────────────────────────────────
    # 내부 유틸: invoice items / scanned map
    # ─────────────────────────────────────────────

    def _load_required_items(self, invoice_no: str) -> List[OutboundInvoiceItem]:
        data = self.load_invoice_items(self.db, invoice_no) or {}
        raw_items = data.get("items") or []
        items: List[OutboundInvoiceItem] = []

        for it in raw_items:
            sku = (it.get("sku") or "").strip()
            name = (it.get("name") or "").strip()
            qty = int(it.get("qty") or 0)

            if not sku or qty <= 0:
                raise DomainError(
                    code="OUTBOUND-INVOICE-001",
                    message="송장 품목 데이터가 올바르지 않습니다",
                    hint="invoice items의 sku/qty를 확인하세요",
                    detail={"item": it, "invoice_no": invoice_no},
                )
            if not name:
                # name은 없을 수도 있으니 최소 빈문자 허용(표시만)
                name = ""

            items.append(OutboundInvoiceItem(sku=sku, name=name, qty=qty))

        if not items:
            raise DomainError(
                code="OUTBOUND-INVOICE-002",
                message="송장에 출고할 품목이 없습니다",
                hint="송장번호 또는 주문 데이터를 확인하세요",
                detail={"invoice_no": invoice_no},
            )

        return items

    def _scanned_map(self, draft_id: int) -> Dict[str, int]:
        rows = self.draft_core.list_items(self.db, draft_id=draft_id)
        out: Dict[str, int] = {}
        for r in rows:
            out[str(r.sku)] = int(r.qty)
        return out

    def _get_weight(self, draft_id: int) -> Optional[int]:
        meta = self.draft_core.get_meta(self.db, draft_id=draft_id)
        w = meta.get("weight")
        if w is None:
            return None
        try:
            w_int = int(w)
            return w_int if w_int > 0 else None
        except Exception:
            return None

    # ─────────────────────────────────────────────
    # invoice 뷰 (GET /invoice/{invoiceNo})
    # ─────────────────────────────────────────────

    def get_invoice(self, invoice_no: str, user_id: int) -> OutboundInvoiceView:
        """
        - Draft header 확보
        - 송장(필요 수량) 조회
        - Draft scanned_qty 합산 + weight(meta_json) 포함
        """
        draft_key = self._draft_key(invoice_no)

        header = self.draft_core.get_or_create_header(
            self.db,
            draft_type="OUTBOUND",
            draft_key=draft_key,
            created_by=user_id,
        )

        required_items = self._load_required_items(invoice_no)
        scanned = self._scanned_map(header.id)
        weight = self._get_weight(header.id)

        total_items = len(required_items)
        total_qty = sum(i.qty for i in required_items)
        scanned_qty = sum(scanned.get(i.sku, 0) for i in required_items)

        # 남은 수량(필요-스캔, 음수면 0으로)
        remaining = 0
        for i in required_items:
            remaining += max(i.qty - int(scanned.get(i.sku, 0)), 0)

        is_ready = remaining == 0

        return OutboundInvoiceView(
            invoice_no=(invoice_no or "").strip(),
            items=required_items,
            scanned_map=scanned,
            weight=weight,
            summary=OutboundInvoiceSummary(
                total_items=total_items,
                total_qty=total_qty,
                scanned_qty=scanned_qty,
                remaining_qty=remaining,
                is_ready_to_confirm=is_ready,
            ),
        )

    # ─────────────────────────────────────────────
    # scan (POST /scan)
    # ─────────────────────────────────────────────

    def scan(self, invoice_no: str, barcode: str, user_id: int) -> OutboundScanResult:
        """
        - 바코드→SKU 조회
        - Draft에 sku qty +1 누적
        - 주문 수량 대비 남은 수량 계산해서 반환
        """
        inv = (invoice_no or "").strip()
        b = self._require_barcode(barcode)
        draft_key = self._draft_key(inv)

        header = self.draft_core.get_or_create_header(
            self.db,
            draft_type="OUTBOUND",
            draft_key=draft_key,
            created_by=user_id,
        )

        # 바코드→상품 조회
        p = self.product_lookup_by_barcode(self.db, b) or {}
        sku = (p.get("sku") or "").strip()
        name = (p.get("name") or "").strip()
        if not sku:
            raise DomainError(
                code="OUTBOUND-SCAN-001",
                message="해당 바코드에 매핑된 상품이 없습니다",
                hint="상품 바코드 등록/매핑을 확인하세요",
                detail={"barcode": b},
            )

        # 송장 품목에 없는 SKU 스캔 방지(운영 안전)
        required_items = self._load_required_items(inv)
        required_map = {i.sku: i for i in required_items}
        if sku not in required_map:
            raise DomainError(
                code="OUTBOUND-SCAN-002",
                message="송장 품목에 없는 상품입니다",
                hint="송장 품목과 바코드를 확인하세요",
                detail={"invoice_no": inv, "sku": sku, "barcode": b},
            )

        # Draft 누적 +1
        row = self.draft_core.upsert_item_add_qty(
            self.db,
            draft_id=header.id,
            sku=sku,
            delta_qty=1,
            last_barcode=b,
        )

        required_qty = int(required_map[sku].qty)
        scanned_qty = int(row.qty)
        remaining_qty = max(required_qty - scanned_qty, 0)

        return OutboundScanResult(
            invoice_no=inv,
            sku=sku,
            barcode=b,
            name=name or required_map[sku].name or "",
            scanned_qty=scanned_qty,
            required_qty=required_qty,
            remaining_qty=remaining_qty,
        )

    # ─────────────────────────────────────────────
    # weight (POST /weight)
    # ─────────────────────────────────────────────

    def set_weight(self, invoice_no: str, weight: int, user_id: int) -> Dict[str, Any]:
        """
        - draft_header.meta_json에 weight 저장
        """
        inv = (invoice_no or "").strip()
        w = self._require_weight(weight)
        draft_key = self._draft_key(inv)

        header = self.draft_core.get_or_create_header(
            self.db,
            draft_type="OUTBOUND",
            draft_key=draft_key,
            created_by=user_id,
        )

        meta = self.draft_core.set_meta_merge(self.db, draft_id=header.id, patch={"weight": w})
        return {"invoice_no": inv, "weight": int(meta.get("weight", w))}

    # ─────────────────────────────────────────────
    # confirm (POST /confirm)
    # ─────────────────────────────────────────────

    @staticmethod
    def _make_request_id_for_confirm(invoice_no: str, scanned_items: Sequence[Tuple[str, int]], weight: Optional[int], operator: str) -> str:
        """
        모바일이 request_id를 안 보내는 전제에서,
        동일 confirm 재시도 시 멱등이 되도록 request_id를 결정적으로 만든다.
        """
        payload = {
            "invoice_no": invoice_no,
            "operator": operator,
            "weight": weight,
            "items": [{"sku": sku, "qty": qty} for sku, qty in sorted(scanned_items, key=lambda x: x[0])],
        }
        raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        digest = sha256(raw.encode("utf-8")).hexdigest()
        rid = uuid.uuid5(uuid.NAMESPACE_URL, f"outbound-confirm:{digest}")
        return str(rid)

    def confirm(self, invoice_no: str, user_id: int, operator: str = "MOBILE") -> Dict[str, Any]:
        """
        Flow:
        1) Draft header 확보
        2) (멱등) ensure_idempotency
        3) (선점) acquire_confirm
        4) 주문 수량 vs Draft scanned 검증(부족/초과/이상 SKU)
        5) 실제 outbound_confirm 1회 호출(재고/원장 반영)
        6) DONE/FAILED 마킹 + header 상태 갱신
        """
        inv = (invoice_no or "").strip()
        if not inv:
            raise DomainError(
                code="OUTBOUND-VALID-004",
                message="invoice_no가 비어있습니다",
                hint="송장번호(invoice_no)를 확인하세요",
                detail=None,
            )

        op = (operator or "").strip() or "MOBILE"
        draft_key = self._draft_key(inv)

        header = self.draft_core.get_or_create_header(
            self.db,
            draft_type="OUTBOUND",
            draft_key=draft_key,
            created_by=user_id,
        )

        # 주문(필요) / 스캔(실제) 수량 준비
        required_items = self._load_required_items(inv)
        required_map = {i.sku: i.qty for i in required_items}

        scanned = self._scanned_map(header.id)
        scanned_items: List[Tuple[str, int]] = [(sku, int(qty)) for sku, qty in scanned.items() if int(qty) > 0]

        # weight
        weight = self._get_weight(header.id)

        # request_id 결정 (멱등)
        request_id = self._make_request_id_for_confirm(inv, scanned_items, weight, op)

        idem = self.draft_core.ensure_idempotency(self.db, draft_id=header.id, request_id=request_id)
        if idem == "DUPLICATE_DONE":
            return {"ok": True, "idempotent": True, "invoice_no": inv}

        # 선점
        acquired = self.draft_core.acquire_confirm(self.db, draft_id=header.id)
        if not acquired:
            # 이미 누군가 확정 중/완료
            raise DomainError(
                code="OUTBOUND-CONFIRM-LOCK-001",
                message="이미 확정 처리 중입니다",
                hint="잠시 후 다시 시도하세요",
                detail={"invoice_no": inv},
            )

        try:
            # 검증 1) 스캔 SKU가 주문에 포함되어야 함
            extra = [sku for sku in scanned.keys() if sku not in required_map]
            if extra:
                raise DomainError(
                    code="OUTBOUND-CONFIRM-001",
                    message="송장 품목에 없는 SKU가 포함되어 있습니다",
                    hint="스캔 목록을 확인하세요",
                    detail={"extra_skus": extra},
                )

            # 검증 2) 부족 수량 있으면 실패
            부족: List[Dict[str, Any]] = []
            초과: List[Dict[str, Any]] = []
            for sku, req_qty in required_map.items():
                sc = int(scanned.get(sku, 0))
                if sc < int(req_qty):
                    부족.append({"sku": sku, "required": int(req_qty), "scanned": sc})
                if sc > int(req_qty):
                    초과.append({"sku": sku, "required": int(req_qty), "scanned": sc})

            if 부족:
                raise DomainError(
                    code="OUTBOUND-CONFIRM-002",
                    message="스캔 수량이 부족합니다",
                    hint="누락된 상품을 스캔하세요",
                    detail={"missing": 부족},
                )

            # 정책: 초과 스캔은 운영 안전상 실패 처리(원하면 나중에 정책 변경 가능)
            if 초과:
                raise DomainError(
                    code="OUTBOUND-CONFIRM-003",
                    message="스캔 수량이 주문 수량을 초과했습니다",
                    hint="초과 스캔을 조정한 뒤 다시 시도하세요",
                    detail={"over": 초과},
                )

            # 실제 확정에 넘길 items는 "주문 수량" 기준으로 전달(가장 안전)
            confirm_items = [(sku, int(qty)) for sku, qty in sorted(required_map.items(), key=lambda x: x[0])]

            result = self.outbound_confirm(self.db, inv, confirm_items, weight, op, user_id) or {}

            # 성공 마킹
            self.draft_core.mark_confirm_done(self.db, draft_id=header.id, request_id=request_id)

            return {
                "ok": True,
                "idempotent": False,
                "invoice_no": inv,
                "weight": weight,
                "result": result,
            }

        except Exception as e:
            self.draft_core.mark_confirm_failed(self.db, draft_id=header.id, request_id=request_id)
            raise
