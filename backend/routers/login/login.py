# 📄 backend/routers/login/login.py
# 페이지: 로그인(LoginPage)
# 역할: 프론트 로그인 요청 수신 → 로그인 서비스 호출 → 응답 포맷 래핑
# 단계: v2.0 (라우터+서비스 연결 완료, JWT는 별도 단계에서 추가)
#
# ✅ 현재 단계 요약
# - 스펙: id / password 기반 로그인 (DB users.username 컬럼 사용)
# - 이 파일은 "라우터" 역할만 담당한다.
#   - 요청 DTO 검증
#   - 서비스 호출
#   - 공통 응답 포맷(ActionResponse)으로 래핑
# - 실제 인증/비밀번호 검증/로그인 카운트 갱신은 서비스 계층에서 처리한다.

from __future__ import annotations

from typing import Optional, Dict, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.db.session import get_sync_session
from backend.services.login.login_service import login_with_id_password
from backend.system.error_codes import raise_http_exception

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "login.main"
PAGE_VERSION = "v2.0"

ROUTE_PREFIX = "/api/login"
ROUTE_TAGS = ["login"]

login = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["login"]

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼 — 라우터 전용
# ─────────────────────────────────────────────────────────
class ResponseBase(BaseModel):
    ok: bool = True
    trace_id: Optional[str] = Field(default=None, description="요청 추적용 ID")


class ActionData(BaseModel):
    result: Dict[str, Any] = Field(default_factory=dict)


class ActionResponse(ResponseBase):
    data: ActionData


class PingResponse(ResponseBase):
    page: str
    version: str
    stage: str


# ─────────────────────────────────────────────────────────
# 도메인 전용 DTO — 로그인 요청 스키마
# ─────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    id: str = Field(..., description="로그인 아이디 (users.username)")
    password: str = Field(..., description="로그인 비밀번호")


# ─────────────────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────────────────
@login.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 로그인 페이지 헬스 체크",
)
def ping():
    """
    Swagger 노출 및 페이지 메타 정보 확인용 핑.
    """
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="router+service",
    )


# ─────────────────────────────────────────────────────────
# [login] 로그인 액션
# ─────────────────────────────────────────────────────────
@login.post(
    "/action",
    response_model=ActionResponse,
    summary="[login] 아이디/비밀번호 로그인",
    responses={
        401: {"description": "DENY - 로그인 실패"},
        422: {"description": "VALID - 유효성 오류"},
        500: {"description": "SYSTEM ERROR"},
    },
)
async def login_action(
    payload: LoginRequest,
    db: Session = Depends(get_sync_session),
):
    """
    로그인 요청 엔드포인트.

    처리 흐름:
    1) 요청 DTO(id, password) 검증
    2) login_service.login_with_id_password 호출
    3) 서비스에서 DomainError 발생 시 전역 핸들러에서 HTTP 에러로 변환
    4) 성공 시 사용자 정보(및 추후 토큰)를 result에 담아 반환
    """
    result = login_with_id_password(
        db=db,
        user_id=payload.id,
        password=payload.password,
        page_id=PAGE_ID,
    )

    return ActionResponse(
        ok=True,
        trace_id=None,
        data=ActionData(result=result),
    )
