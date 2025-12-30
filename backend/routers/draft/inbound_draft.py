# 📄 backend/routers/draft/inbound_draft.py
# 도메인: INBOUND Draft (모바일 전용)
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
from backend.services.inbound.inbound_draft_service import InboundDraftService


router = APIRouter(prefix="/api/draft/inbound", tags=["Draft-Inbound"])


def _user_id(user: Optional[Dict[str, Any]]) -> int:
    # 개발모드(AUTH_REQUIRED=false): None 허용 → 0
    if not user:
        return 0
    sub = user.get("sub")
    try:
        return int(str(sub).strip())
    except Exception:
        return 0


class InboundDraftUpsertBody(BaseModel):
    draft_key: str = Field(..., description="예: inbound:<작업번호>")
    sku: str
    delta_qty: int
    barcode: Optional[str] = None


class InboundDraftConfirmBody(BaseModel):
    draft_key: str
    request_id: str


@router.get("/ping")
def ping():
    return {"page": "draft.inbound", "version": "v1.0", "stage": "router"}


@router.post("/upsert")
def upsert(
    body: InboundDraftUpsertBody,
    db: Session = Depends(get_sync_session),
    user: Optional[Dict[str, Any]] = Depends(guard),
):
    svc = InboundDraftService(db=db, draft_core=DraftCoreService())
    return svc.upsert_add_qty(
        draft_key=body.draft_key,
        sku=body.sku,
        delta_qty=body.delta_qty,
        barcode=body.barcode,
        user_id=_user_id(user),
    )


@router.post("/confirm")
def confirm(
    body: InboundDraftConfirmBody,
    db: Session = Depends(get_sync_session),
    user: Optional[Dict[str, Any]] = Depends(guard),
):
    svc = InboundDraftService(db=db, draft_core=DraftCoreService())
    return svc.confirm(
        draft_key=body.draft_key,
        request_id=body.request_id,
        user_id=_user_id(user),
    )
