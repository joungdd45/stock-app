# 📄 backend/routers/settings/settings_basic.py
# 페이지: 설정 > 기본설정(BasicPage.tsx)
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v2.1 (사용자설정 + 페이지설정 전체 구현, 공용 guard 연동) / 구조 통일 작업지침 v2 적용
#
# ✅ 라우터 원칙
# - 요청 받기, 인증/가드, 입력 파싱, 서비스 호출, 응답 반환, 문서화만 담당
# - 계산/조회/검증/상태처리/에러문구 생성/도메인 로직/반복분기 금지
# - 에러 형식과 HTTP코드는 전역 핸들러(error_codes.py)가 담당
# - 파일명=라우터명=tags 통일: settings_basic

from __future__ import annotations

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.db.session import get_sync_session
from backend.services.settings.settings_basic_service import SettingsBasicService
from backend.security.guard import guard  # ✅ 공용 가드 사용

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "settings.basic"
PAGE_VERSION = "v2.1"

ROUTE_PREFIX = "/api/settings/basic"
ROUTE_TAGS = ["settings_basic"]

settings_basic = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["settings_basic"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user: Dict[str, Any] = Depends(guard),
    session: Session = Depends(get_sync_session),
) -> SettingsBasicService:
    """
    서비스 DI.
    - DB 세션과 현재 사용자 정보를 서비스에 주입
    - 인증은 backend.security.guard.guard 공용 가드를 사용
    """
    return SettingsBasicService(session=session, user=user)

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
# 도메인 전용 DTO — 기본설정 전용
# ─────────────────────────────────────────────────────────
# [페이지 설정] 바디
class PageSettingsBody(BaseModel):
    page_size: int = Field(..., ge=10, le=200, description="페이지당 항목 수(10 to 200)")
    theme: str = Field(..., description="UI 테마 (라이트/다크/시스템)")


# [사용자 설정] 바디
class UserCreateBody(BaseModel):
    username: str = Field(..., description="로그인 ID (이메일 아님)")
    name: Optional[str] = Field(default=None, description="사용자 이름")
    role: str = Field(..., description="권한 (관리자 / 직원 / 조회 또는 admin/manager/user)")


class UserUpdateBody(BaseModel):
    name: Optional[str] = Field(default=None, description="사용자 이름")
    role: Optional[str] = Field(default=None, description="권한 (관리자 / 직원 / 조회 또는 admin/manager/user)")
    is_active: Optional[bool] = Field(default=None, description="계정 활성 여부")

# ─────────────────────────────────────────────────────────
# [system] 핑
# ─────────────────────────────────────────────────────────
@settings_basic.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 설정 > 기본설정 페이지 핑",
)
def ping():
    """
    Swagger 노출 및 페이지 메타 정보 확인용 핑.
    """
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="implemented",
    )

# ─────────────────────────────────────────────────────────
# A. 사용자 설정 영역 (좌측 표)
# ─────────────────────────────────────────────────────────

@settings_basic.get(
    "/users",
    response_model=ActionResponse,
    summary="[관리자] 사용자 목록 조회",
    responses={
        403: {"description": "FORBIDDEN"},
    },
)
async def list_users(
    svc: SettingsBasicService = Depends(get_service),
):
    """
    [관리자] 사용자 목록 조회
    - 논리삭제(deleted_at IS NULL)만 조회
    """
    try:
        items: List[Dict[str, Any]] = await svc.list_users()
    except DomainError as exc:
        raise exc

    return ActionResponse(
        ok=True,
        data=ActionData(result={"items": items}),
    )


@settings_basic.post(
    "/users",
    response_model=ActionResponse,
    summary="[관리자] 사용자 추가",
    responses={
        403: {"description": "FORBIDDEN"},
        422: {"description": "VALID"},
    },
)
async def create_user(
    payload: UserCreateBody,
    svc: SettingsBasicService = Depends(get_service),
):
    """
    [관리자] 사용자 추가
    - username 중복 체크
    - role 유효성 검증
    """
    try:
        result_dict = await svc.create_user(payload=payload.dict())
    except DomainError as exc:
        raise exc

    return ActionResponse(
        ok=True,
        data=ActionData(result=result_dict),
    )


@settings_basic.put(
    "/users/{user_id}",
    response_model=ActionResponse,
    summary="[관리자] 사용자 정보 수정",
    responses={
        403: {"description": "FORBIDDEN"},
        404: {"description": "NOTFOUND"},
        422: {"description": "VALID"},
    },
)
async def update_user(
    user_id: int,
    payload: UserUpdateBody,
    svc: SettingsBasicService = Depends(get_service),
):
    """
    [관리자] 사용자 정보 수정
    - 이름/권한/활성여부 수정
    """
    try:
        result_dict = await svc.update_user(
            user_id=user_id,
            payload={k: v for k, v in payload.dict().items() if v is not None},
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(
        ok=True,
        data=ActionData(result=result_dict),
    )


@settings_basic.delete(
    "/users/{user_id}",
    response_model=ActionResponse,
    summary="[관리자] 사용자 삭제(논리삭제)",
    responses={
        403: {"description": "FORBIDDEN"},
        404: {"description": "NOTFOUND"},
    },
)
async def delete_user(
    user_id: int,
    svc: SettingsBasicService = Depends(get_service),
):
    """
    [관리자] 사용자 삭제(논리삭제)
    - is_active = False
    - deleted_at 설정
    """
    try:
        result_dict = await svc.delete_user(user_id=user_id)
    except DomainError as exc:
        raise exc

    return ActionResponse(
        ok=True,
        data=ActionData(result=result_dict),
    )

# ─────────────────────────────────────────────────────────
# B. [내 설정] 페이지 설정 영역 (우측 표)
# ─────────────────────────────────────────────────────────

@settings_basic.get(
    "/page",
    response_model=ActionResponse,
    summary="[내 설정] 개인 페이지 설정 조회",
    responses={
        404: {"description": "NOTFOUND"},
    },
)
async def get_my_page_settings(
    svc: SettingsBasicService = Depends(get_service),
):
    """
    로그인 사용자의 개인 페이지 설정 조회.
    - settings_basic_user에서 user_id 기준 조회
    - 없으면 기본값 반환
    """
    try:
        result_dict = await svc.get_my_page_settings()
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result_dict))


@settings_basic.put(
    "/page",
    response_model=ActionResponse,
    summary="[내 설정] 개인 페이지 설정 저장",
    responses={
        422: {"description": "VALID"},
    },
)
async def put_my_page_settings(
    payload: PageSettingsBody,
    svc: SettingsBasicService = Depends(get_service),
):
    """
    로그인 사용자의 개인 페이지 설정 저장.
    """
    try:
        result_dict = await svc.put_my_page_settings(payload=payload.dict())
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result_dict))

# ─────────────────────────────────────────────────────────
# C. [관리자] 특정 사용자 페이지 설정 영역
# ─────────────────────────────────────────────────────────

@settings_basic.get(
    "/admin/users/{target_user_id}/page",
    response_model=ActionResponse,
    summary="[관리자] 특정 사용자 페이지 설정 조회",
    responses={
        403: {"description": "FORBIDDEN"},
        404: {"description": "NOTFOUND"},
    },
)
async def admin_get_user_page_settings(
    target_user_id: int,
    svc: SettingsBasicService = Depends(get_service),
):
    """
    관리자: 특정 사용자의 개인 페이지 설정 조회.
    """
    try:
        result_dict = await svc.admin_get_user_page_settings(target_user_id=target_user_id)
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result_dict))


@settings_basic.put(
    "/admin/users/{target_user_id}/page",
    response_model=ActionResponse,
    summary="[관리자] 특정 사용자 페이지 설정 저장",
    responses={
        403: {"description": "FORBIDDEN"},
        422: {"description": "VALID"},
    },
)
async def admin_put_user_page_settings(
    target_user_id: int,
    payload: PageSettingsBody,
    svc: SettingsBasicService = Depends(get_service),
):
    """
    관리자: 특정 사용자의 개인 페이지 설정 저장.
    """
    try:
        result_dict = await svc.admin_put_user_page_settings(
            target_user_id=target_user_id,
            payload=payload.dict(),
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result_dict))
