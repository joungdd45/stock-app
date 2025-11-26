# 📄 backend/routers/stock/statuspage.py
# 페이지: 재고 현황(StatusPage)
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v1.5 (get_sync_session + 공용 guard 연동 + multi 지원) / 구조 통일 작업지침 v2 적용
#
# ✅ 라우터 원칙
# - 요청 받기, 인증/가드, 입력 파싱, 서비스 호출, 응답 반환, 문서화만 담당
# - 계산/조회/검증/상태처리/에러문구 생성/도메인 로직/반복분기 최소화
# - 에러 형식과 HTTP코드는 전역 핸들러(error_codes.py)가 담당
# - 파일명=라우터명=tags 통일: statuspage

from __future__ import annotations

from typing import Optional, Dict, Any, List
from enum import Enum

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.stock.statuspage_service import StatusPageService
from backend.db.session import get_sync_session  # ✅ 실제 DB 세션
from backend.security.guard import guard  # ✅ 공용 인증/권한 가드

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "stock.status"
PAGE_VERSION = "v1.5"

ROUTE_PREFIX = "/api/stock/status"
ROUTE_TAGS = ["statuspage"]

statuspage = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["statuspage"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user: Dict[str, Any] = Depends(guard),
    session: Session = Depends(get_sync_session),  # ✅ 여기서 실제 세션 주입
) -> StatusPageService:
    """
    서비스 DI.
    - 공용 guard로부터 인증된 사용자 정보(user)를 받고,
    - get_sync_session으로 DB 세션을 주입한다.
    """
    return StatusPageService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼
# ─────────────────────────────────────────────────────────
class ResponseBase(BaseModel):
    ok: bool = True
    trace_id: Optional[str] = None


class ActionData(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(ResponseBase):
    data: ActionData


class PingResponse(ResponseBase):
    page: str
    version: str
    stage: str


# ─────────────────────────────────────────────────────────
# DTO
# ─────────────────────────────────────────────────────────
class MultiSearchRequest(BaseModel):
    skus: List[str] = Field(..., description="다건 검색용 SKU 목록")
    page: int = 1
    size: int = 10
    sort_by: Optional[str] = "sku"
    order: Optional[str] = "asc"


class ActionType(str, Enum):
    ADJUST = "adjust"
    EXPORT = "export"


class ActionRequest(BaseModel):
    action: ActionType

    # adjust용
    sku: Optional[str] = None
    final_qty: Optional[int] = None
    memo: Optional[str] = None

    # export용
    selected_skus: Optional[List[str]] = None


# ─────────────────────────────────────────────────────────
# [system] ping
# ─────────────────────────────────────────────────────────
@statuspage.get("/ping", response_model=PingResponse)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="implemented",
    )

# ─────────────────────────────────────────────────────────
# 1️⃣ 재고현황 목록
# ─────────────────────────────────────────────────────────
@statuspage.get("/list", response_model=ActionResponse)
async def list_items(
    q: Optional[str] = None,
    page: int = 1,
    size: int = 10,
    sort_by: Optional[str] = "sku",
    order: Optional[str] = "asc",
    svc: StatusPageService = Depends(get_service),
):
    try:
        result = await svc.list_items(
            q=q,
            page=page,
            size=size,
            sort_by=sort_by,
            order=order,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ─────────────────────────────────────────────────────────
# 2️⃣ 다건 검색
# ─────────────────────────────────────────────────────────
@statuspage.post("/multi", response_model=ActionResponse)
async def multi_items(
    payload: MultiSearchRequest,
    svc: StatusPageService = Depends(get_service),
):
    try:
        result = await svc.list_by_skus(
            skus=payload.skus,
            page=payload.page,
            size=payload.size,
            sort_by=payload.sort_by,
            order=payload.order,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ─────────────────────────────────────────────────────────
# 3️⃣ 재고 조정 / 엑셀
# ─────────────────────────────────────────────────────────
@statuspage.post("/action", response_model=ActionResponse)
async def do_action(
    payload: ActionRequest,
    svc: StatusPageService = Depends(get_service),
):
    try:
        if payload.action == ActionType.ADJUST:
            result = await svc.adjust(payload=payload.dict())

        elif payload.action == ActionType.EXPORT:
            skus = payload.selected_skus or []
            result = await svc.export_items(selected_skus=skus)

        else:
            raise DomainError(
                "STOCK-VALID-001",
                detail="지원하지 않는 액션입니다.",
                ctx={"page_id": PAGE_ID, "action": payload.action},
            )

    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))
