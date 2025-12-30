# 📄 backend/services/stock/stocktake_draft_service.py
# 도메인: STOCKTAKE (모바일 전용 Draft 기반 재고실사)
# 역할:
#  - 실사 진행 중: Draft에만 저장(재고/원장 직접 수정 금지)
#    - SKU별 final_qty는 "누적"이 아니라 "최종값 덮어쓰기"가 원칙
#  - 실사 종료(Confirm): Draft 선점 + request_id 멱등 처리 후
#    - Draft 전체를 한 번에 확정(재고/원장 반영은 이 시점에만 1회)
#
# 단계: v1.0 (실사용 연결 버전 / 라우터는 서비스 호출만)

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Dict, Any, List, Optional, Sequence, Tuple, Literal

from sqlalchemy.orm import Session
from sqlalchemy import text

from backend.system.error_codes import DomainError
from backend.services.draft.draft_core_service import DraftCoreService


DraftConfirmResultKind = Literal["DONE", "IDEMPOTENT_DONE"]


@dataclass(frozen=True)
class StocktakeDraftUpsertResult:
    draft_key: str
    draft_id: int
    sku: str
    final_qty: int
    barcode: Optional[str]


@dataclass(frozen=True)
class StocktakeDraftConfirmResult:
    kind: DraftConfirmResultKind
    draft_key: str
    draft_id: int
    request_id: str
    result: Dict[str, Any]


class StocktakeDraftService:
    """
    Stocktake Draft Service
    - upsert(final_qty 덮어쓰기)
    - confirm(실사 종료 시점에만 실제 반영)
    """

    PAGE = "stock.take"
    PAGE_VERSION = "v1.0"
    STAGE = "service+draft"

    def __init__(
        self,
        db: Session,
        draft_core: DraftCoreService,
        # ✅ 실제 확정(재고/원장 반영) 함수 주입
        # (db, draft_key, items, operator, user_id) -> dict
        # items: [(sku, final_qty), ...]
        stocktake_confirm: Callable[[Session, str, Sequence[Tuple[str, int]], str, int], Dict[str, Any]],
    ) -> None:
        self.db = db
        self.draft_core = draft_core
        self.stocktake_confirm = stocktake_confirm

    # -----------------------------
    # helpers
    # -----------------------------
    @staticmethod
    def _draft_key(draft_key: str) -> str:
        k = (draft_key or "").strip()
        if not k:
            raise DomainError(
                code="STOCKTAKE-VALID-001",
                message="draft_key가 비어있습니다",
                hint="draft_key를 확인하세요",
                detail=None,
            )
        # 권장 형식: STOCKTAKE-YYYY-MM-DD (프론트와 합의)
        return k

    @staticmethod
    def _require_sku(sku: str) -> str:
        s = (sku or "").strip()
        if not s:
            raise DomainError(
                code="STOCKTAKE-VALID-002",
                message="sku가 비어있습니다",
                hint="sku를 확인하세요",
                detail=None,
            )
        return s

    @staticmethod
    def _require_final_qty(final_qty: int) -> int:
        try:
            q = int(final_qty)
        except Exception:
            raise DomainError(
                code="STOCKTAKE-VALID-003",
                message="final_qty가 올바르지 않습니다",
                hint="final_qty는 정수여야 합니다",
                detail={"final_qty": final_qty},
            )
        if q < 0:
            raise DomainError(
                code="STOCKTAKE-VALID-004",
                message="final_qty는 0 이상이어야 합니다",
                hint="final_qty를 확인하세요",
                detail={"final_qty": q},
            )
        return q

    # -----------------------------
    # ping
    # -----------------------------
    def ping(self) -> Dict[str, Any]:
        return {"page": self.PAGE, "version": self.PAGE_VERSION, "stage": self.STAGE}

    # -----------------------------
    # upsert(final_qty overwrite)
    # -----------------------------
    def upsert_final_qty(
        self,
        *,
        draft_key: str,
        sku: str,
        final_qty: int,
        barcode: Optional[str],
        memo: Optional[str],
        user_id: int,
    ) -> StocktakeDraftUpsertResult:
        """
        실사 중 저장:
        - Draft Header 생성/조회 (draft_type=STOCKTAKE, draft_key=draft_key)
        - Draft Item은 "누적"이 아니라 "최종값 덮어쓰기"
          -> draft_item.qty를 final_qty로 SET
        """
        k = self._draft_key(draft_key)
        s = self._require_sku(sku)
        q = self._require_final_qty(final_qty)
        b = (barcode or "").strip() or None

        header = self.draft_core.get_or_create_header(
            self.db,
            draft_type="STOCKTAKE",
            draft_key=k,
            created_by=user_id,
        )

        # ✅ overwrite: qty = final_qty (누적이 아님)
        row = self.db.execute(
            text(
                """
                INSERT INTO draft_item (draft_id, sku, qty, last_barcode)
                VALUES (:draft_id, :sku, :qty, :last_barcode)
                ON CONFLICT (draft_id, sku)
                DO UPDATE SET
                    qty = EXCLUDED.qty,
                    last_barcode = COALESCE(EXCLUDED.last_barcode, draft_item.last_barcode),
                    updated_at = now()
                RETURNING id, draft_id, sku, qty, last_barcode, created_at, updated_at
                """
            ),
            {"draft_id": header.id, "sku": s, "qty": q, "last_barcode": b},
        ).mappings().first()

        # 메모는 헤더 meta_json에 누적해도 되지만(옵션), 일단 최소로만(필요하면 다음 턴에 확장)
        if memo:
            # meta_json에 last_memo 정도만 저장(옵션)
            self.draft_core.set_meta_merge(self.db, draft_id=header.id, patch={"last_memo": str(memo)})

        self.db.commit()

        return StocktakeDraftUpsertResult(
            draft_key=k,
            draft_id=header.id,
            sku=s,
            final_qty=int(row["qty"]),
            barcode=b,
        )

    # -----------------------------
    # confirm(종료 시점 1회)
    # -----------------------------
    def confirm(
        self,
        *,
        draft_key: str,
        request_id: str,
        user_id: int,
        operator: str = "MOBILE",
    ) -> StocktakeDraftConfirmResult:
        """
        실사 종료(확정):
        - request_id 멱등
        - header 선점(DRAFT -> CONFIRMING)
        - draft_item 전체를 읽어서 (sku, final_qty) 리스트 생성
        - 실제 stocktake_confirm을 1회 호출(재고/원장 반영은 여기서만)
        - DONE/FAILED 마킹
        """
        k = self._draft_key(draft_key)
        rid = (request_id or "").strip()
        if not rid:
            raise DomainError(
                code="STOCKTAKE-VALID-005",
                message="request_id가 비어있습니다",
                hint="request_id를 확인하세요",
                detail=None,
            )

        op = (operator or "").strip() or "MOBILE"

        header = self.draft_core.get_or_create_header(
            self.db,
            draft_type="STOCKTAKE",
            draft_key=k,
            created_by=user_id,
        )

        idem = self.draft_core.ensure_idempotency(self.db, draft_id=header.id, request_id=rid)
        if idem == "DUPLICATE_DONE":
            return StocktakeDraftConfirmResult(
                kind="IDEMPOTENT_DONE",
                draft_key=k,
                draft_id=header.id,
                request_id=rid,
                result={"ok": True, "idempotent": True},
            )

        acquired = self.draft_core.acquire_confirm(self.db, draft_id=header.id)
        if not acquired:
            raise DomainError(
                code="STOCKTAKE-CONFIRM-LOCK-001",
                message="이미 실사 종료 처리 중입니다",
                hint="잠시 후 다시 시도하세요",
                detail={"draft_key": k},
            )

        try:
            items = self.draft_core.list_items(self.db, draft_id=header.id)
            pairs: List[Tuple[str, int]] = [(str(it.sku), int(it.qty)) for it in items if int(it.qty) >= 0]

            if not pairs:
                raise DomainError(
                    code="STOCKTAKE-CONFIRM-001",
                    message="확정할 실사 데이터가 없습니다",
                    hint="실사 저장(임시)을 먼저 진행하세요",
                    detail={"draft_key": k},
                )

            result = self.stocktake_confirm(self.db, k, pairs, op, user_id) or {}

            self.draft_core.mark_confirm_done(self.db, draft_id=header.id, request_id=rid)

            return StocktakeDraftConfirmResult(
                kind="DONE",
                draft_key=k,
                draft_id=header.id,
                request_id=rid,
                result={"ok": True, "idempotent": False, "detail": result},
            )

        except Exception:
            self.draft_core.mark_confirm_failed(self.db, draft_id=header.id, request_id=rid)
            raise
