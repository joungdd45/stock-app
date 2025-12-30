# 📄 backend/routers/draft/stocktake_draft.py
# 도메인: STOCKTAKE Draft (모바일 전용)
# 역할: 요청 → guard/세션 → 서비스 호출 → 응답
# 단계: v1.0 (router only)

from __future__ import annotations

from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.db.session import get_sync_session
from backend.security.guard import guard
from backend.services.draft.draft_core_service import DraftCoreService
from backend.services.stock.stocktake_draft_service import StocktakeDraftService


router = APIRouter(prefix="/api/draft/stocktake", tags=["Draft-Stocktake"])


def _user_id(user: Optional[Dict[str, Any]]) -> int:
    if not user:
        return 0
    sub = user.get("sub")
    try:
        return int(str(sub).strip())
    except Exception:
        return 0


class StocktakeDraftUpsertBody(BaseModel):
    draft_key: str = Field(..., description="예: STOCKTAKE-YYYY-MM-DD")
    sku: str
    final_qty: int
    barcode: Optional[str] = None
    memo: Optional[str] = None


class StocktakeDraftConfirmBody(BaseModel):
    draft_key: str
    request_id: str
    operator: Optional[str] = "MOBILE"


@router.get("/ping")
def ping():
    return {"page": "draft.stocktake", "version": "v1.0", "stage": "router"}


@router.post("/upsert")
def upsert(
    body: StocktakeDraftUpsertBody,
    db: Session = Depends(get_sync_session),
    user: Optional[Dict[str, Any]] = Depends(guard),
):
    svc = StocktakeDraftService(db=db, draft_core=DraftCoreService())
    return svc.upsert_final_qty(
        draft_key=body.draft_key,
        sku=body.sku,
        final_qty=body.final_qty,
        barcode=body.barcode,
        memo=body.memo,
        user_id=_user_id(user),
    )


@router.post("/confirm")
def confirm(
    body: StocktakeDraftConfirmBody,
    db: Session = Depends(get_sync_session),
    user: Optional[Dict[str, Any]] = Depends(guard),
):
    svc = StocktakeDraftService(db=db, draft_core=DraftCoreService())
    return svc.confirm(
        draft_key=body.draft_key,
        request_id=body.request_id,
        user_id=_user_id(user),
        operator=body.operator or "MOBILE",
    )
