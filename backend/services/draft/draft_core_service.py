# 📄 backend/services/draft/draft_core_service.py
# Draft Core Service
# 역할:
# - draft_header 생성/조회
# - draft_item UPSERT(수량 누적)
# - 상태 전이(DRAFT→CONFIRMING→CONFIRMED)
# - request_id 멱등 처리(중복 확정 방지)
# - ✅ draft_header.meta_json 저장/조회 (출고 weight 등 헤더 메타 저장용)
#
# 주의:
# - 도메인(입고/출고/실사) 규칙/계산은 여기서 하지 않는다.
# - 여기서는 "공통 포장 규칙"만 제공한다.
# - ORM 모델이 아직 준비되지 않았을 수 있어, SQL(text) 기반으로 구현한다.

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, List, Literal, Dict, Any
from datetime import datetime
import json

from sqlalchemy.orm import Session
from sqlalchemy import text

DraftType = Literal["INBOUND", "OUTBOUND", "STOCKTAKE"]
DraftStatus = Literal["DRAFT", "CONFIRMING", "CONFIRMED", "CANCELED"]


@dataclass(frozen=True)
class DraftHeaderRow:
    id: int
    draft_type: str
    status: str
    draft_key: str
    created_by: int
    created_at: datetime
    updated_at: datetime
    confirmed_at: Optional[datetime]
    meta_json: Dict[str, Any]


@dataclass(frozen=True)
class DraftItemRow:
    id: int
    draft_id: int
    sku: str
    qty: int
    last_barcode: Optional[str]
    created_at: datetime
    updated_at: datetime


class DraftCoreService:
    """
    Draft Core = 공통 규칙(생성/UPSERT/선점/멱등 + 헤더 메타)만 담당
    """

    # -----------------------------
    # Header
    # -----------------------------
    def get_or_create_header(
        self,
        db: Session,
        *,
        draft_type: DraftType,
        draft_key: str,
        created_by: int,
    ) -> DraftHeaderRow:
        """
        (draft_type, draft_key) 유니크를 기반으로
        없으면 생성하고, 있으면 기존을 반환한다.
        """
        # 1) 먼저 조회
        row = db.execute(
            text(
                """
                SELECT id, draft_type, status, draft_key, created_by, created_at, updated_at, confirmed_at, meta_json
                FROM draft_header
                WHERE draft_type = :draft_type AND draft_key = :draft_key
                """
            ),
            {"draft_type": draft_type, "draft_key": draft_key},
        ).mappings().first()

        if row:
            return DraftHeaderRow(**row)

        # 2) 없으면 생성(동시성 대비: insert 후 충돌 시 재조회)
        try:
            row2 = db.execute(
                text(
                    """
                    INSERT INTO draft_header (draft_type, status, draft_key, created_by)
                    VALUES (:draft_type, 'DRAFT', :draft_key, :created_by)
                    RETURNING id, draft_type, status, draft_key, created_by, created_at, updated_at, confirmed_at, meta_json
                    """
                ),
                {"draft_type": draft_type, "draft_key": draft_key, "created_by": created_by},
            ).mappings().first()
            db.commit()
            return DraftHeaderRow(**row2)
        except Exception:
            db.rollback()
            # 누군가 먼저 만들었을 수 있으니 재조회
            row3 = db.execute(
                text(
                    """
                    SELECT id, draft_type, status, draft_key, created_by, created_at, updated_at, confirmed_at, meta_json
                    FROM draft_header
                    WHERE draft_type = :draft_type AND draft_key = :draft_key
                    """
                ),
                {"draft_type": draft_type, "draft_key": draft_key},
            ).mappings().first()
            if not row3:
                raise
            return DraftHeaderRow(**row3)

    def get_header(self, db: Session, *, draft_id: int) -> Optional[DraftHeaderRow]:
        row = db.execute(
            text(
                """
                SELECT id, draft_type, status, draft_key, created_by, created_at, updated_at, confirmed_at, meta_json
                FROM draft_header
                WHERE id = :draft_id
                """
            ),
            {"draft_id": draft_id},
        ).mappings().first()
        return DraftHeaderRow(**row) if row else None

    # -----------------------------
    # Header Meta (meta_json)
    # -----------------------------
    def get_meta(self, db: Session, *, draft_id: int) -> Dict[str, Any]:
        """
        draft_header.meta_json 조회
        """
        row = db.execute(
            text(
                """
                SELECT meta_json
                FROM draft_header
                WHERE id = :draft_id
                """
            ),
            {"draft_id": draft_id},
        ).mappings().first()
        if not row or row["meta_json"] is None:
            return {}
        return dict(row["meta_json"])

    def set_meta_merge(self, db: Session, *, draft_id: int, patch: Dict[str, Any]) -> Dict[str, Any]:
        """
        meta_json에 patch를 merge 저장 (jsonb ||)
        - meta_json = meta_json || patch
        - patch가 {}면 변경 없음
        """
        patch = patch or {}
        row = db.execute(
            text(
                """
                UPDATE draft_header
                SET meta_json = COALESCE(meta_json, '{}'::jsonb) || (:patch::jsonb),
                    updated_at = now()
                WHERE id = :draft_id
                RETURNING meta_json
                """
            ),
            {"draft_id": draft_id, "patch": json.dumps(patch, ensure_ascii=False)},
        ).mappings().first()
        db.commit()
        if not row or row["meta_json"] is None:
            return {}
        return dict(row["meta_json"])

    # -----------------------------
    # Items
    # -----------------------------
    def upsert_item_add_qty(
        self,
        db: Session,
        *,
        draft_id: int,
        sku: str,
        delta_qty: int,
        last_barcode: Optional[str] = None,
    ) -> DraftItemRow:
        """
        draft_item(draft_id, sku) 기준 UPSERT
        - qty = qty + delta_qty (누적)
        - last_barcode는 값이 들어오면 갱신
        """
        row = db.execute(
            text(
                """
                INSERT INTO draft_item (draft_id, sku, qty, last_barcode)
                VALUES (:draft_id, :sku, :delta_qty, :last_barcode)
                ON CONFLICT (draft_id, sku)
                DO UPDATE SET
                    qty = draft_item.qty + EXCLUDED.qty,
                    last_barcode = COALESCE(EXCLUDED.last_barcode, draft_item.last_barcode),
                    updated_at = now()
                RETURNING id, draft_id, sku, qty, last_barcode, created_at, updated_at
                """
            ),
            {
                "draft_id": draft_id,
                "sku": sku,
                "delta_qty": delta_qty,
                "last_barcode": last_barcode,
            },
        ).mappings().first()
        db.commit()
        return DraftItemRow(**row)

    def list_items(self, db: Session, *, draft_id: int) -> List[DraftItemRow]:
        rows = db.execute(
            text(
                """
                SELECT id, draft_id, sku, qty, last_barcode, created_at, updated_at
                FROM draft_item
                WHERE draft_id = :draft_id
                ORDER BY sku ASC
                """
            ),
            {"draft_id": draft_id},
        ).mappings().all()
        return [DraftItemRow(**r) for r in rows]

    # -----------------------------
    # Confirm 선점 + 멱등
    # -----------------------------
    def acquire_confirm(self, db: Session, *, draft_id: int) -> bool:
        """
        확정 선점(동시 확정 방지):
        - status가 DRAFT일 때만 CONFIRMING으로 바꾸고 True
        - 이미 CONFIRMING/CONFIRMED/CANCELED면 False
        """
        res = db.execute(
            text(
                """
                UPDATE draft_header
                SET status = 'CONFIRMING', updated_at = now()
                WHERE id = :draft_id AND status = 'DRAFT'
                """
            ),
            {"draft_id": draft_id},
        )
        db.commit()
        return res.rowcount == 1

    def ensure_idempotency(
        self,
        db: Session,
        *,
        draft_id: int,
        request_id: str,
    ) -> Literal["NEW", "DUPLICATE_DONE", "DUPLICATE_FAILED", "DUPLICATE_UNKNOWN"]:
        """
        request_id 멱등 처리:
        - 최초면 draft_request 생성 후 NEW
        - 이미 있으면 status 기준으로 DUPLICATE_* 반환
        """
        existing = db.execute(
            text(
                """
                SELECT status
                FROM draft_request
                WHERE request_id = :request_id
                """
            ),
            {"request_id": request_id},
        ).mappings().first()

        if existing:
            st = (existing["status"] or "").upper()
            if st == "DONE":
                return "DUPLICATE_DONE"
            if st == "FAILED":
                return "DUPLICATE_FAILED"
            return "DUPLICATE_UNKNOWN"

        try:
            db.execute(
                text(
                    """
                    INSERT INTO draft_request (draft_id, request_id, kind, status)
                    VALUES (:draft_id, :request_id, 'CONFIRM', 'STARTED')
                    """
                ),
                {"draft_id": draft_id, "request_id": request_id},
            )
            db.commit()
            return "NEW"
        except Exception:
            db.rollback()
            # 동시에 들어와서 먼저 insert 되었을 수 있음 → 재조회
            existing2 = db.execute(
                text(
                    """
                    SELECT status
                    FROM draft_request
                    WHERE request_id = :request_id
                    """
                ),
                {"request_id": request_id},
            ).mappings().first()
            if not existing2:
                raise
            st2 = (existing2["status"] or "").upper()
            if st2 == "DONE":
                return "DUPLICATE_DONE"
            if st2 == "FAILED":
                return "DUPLICATE_FAILED"
            return "DUPLICATE_UNKNOWN"

    def mark_confirm_done(self, db: Session, *, draft_id: int, request_id: str) -> None:
        db.execute(
            text(
                """
                UPDATE draft_request
                SET status = 'DONE'
                WHERE request_id = :request_id
                """
            ),
            {"request_id": request_id},
        )
        db.execute(
            text(
                """
                UPDATE draft_header
                SET status = 'CONFIRMED', confirmed_at = now(), updated_at = now()
                WHERE id = :draft_id
                """
            ),
            {"draft_id": draft_id},
        )
        db.commit()

    def mark_confirm_failed(self, db: Session, *, draft_id: int, request_id: str) -> None:
        db.execute(
            text(
                """
                UPDATE draft_request
                SET status = 'FAILED'
                WHERE request_id = :request_id
                """
            ),
            {"request_id": request_id},
        )
        # 실패 시 CONFIRMING을 DRAFT로 되돌릴지(재시도 허용) 정책은 도메인에서 결정.
        # 기본은 DRAFT로 롤백.
        db.execute(
            text(
                """
                UPDATE draft_header
                SET status = 'DRAFT', updated_at = now()
                WHERE id = :draft_id AND status = 'CONFIRMING'
                """
            ),
            {"draft_id": draft_id},
        )
        db.commit()
