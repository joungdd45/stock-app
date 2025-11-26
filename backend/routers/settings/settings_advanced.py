# 📄 backend/routers/settings/settings_advanced.py
# 페이지: 설정 - 고급설정(AdvancedPage)
# 역할: 요청 수신 → DTO 파싱 → 서비스 호출 → 표준 응답
# 단계: v2.1 (공식 guard 적용 완료)
#
# PAGE_ID       : "settings.advanced"
# PAGE_VERSION  : "v2.1"
# ROUTE_PREFIX  : "/api/settings/advanced"
# ROUTE_TAGS    : ["settings-advanced"]
#
# 규칙:
# - 라우터는 얇게, 비즈니스 로직은 서비스로 위임
# - DomainError는 그대로 던지고, 정상만 래핑해서 응답

from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.db.session import get_sync_session
from backend.security.guard import guard
from backend.services.settings.settings_advanced_service import SettingsAdvancedService


# ─────────────────────────────────────────
# 메타 정보
# ─────────────────────────────────────────
PAGE_ID = "settings.advanced"
PAGE_VERSION = "v2.1"
ROUTE_PREFIX = "/api/settings/advanced"
ROUTE_TAGS = ["settings-advanced"]

settings_advanced = APIRouter(
    prefix=ROUTE_PREFIX,
    tags=ROUTE_TAGS,
)


# ─────────────────────────────────────────
# Service DI
# ─────────────────────────────────────────
def get_service(
    user = Depends(guard),
    session: Session = Depends(get_sync_session),
) -> SettingsAdvancedService:
    return SettingsAdvancedService(db=session, current_user=user)


# ─────────────────────────────────────────
# DTO
# ─────────────────────────────────────────
class SecuritySettings(BaseModel):
    require_x_api_key: bool = Field(..., description="X-API-Key 요구 여부")
    require_jwt_token: bool = Field(..., description="JWT 인증 요구 여부")
    api_key: Optional[str] = Field(None, description="API Key 값")


class PerformanceSettings(BaseModel):
    request_limit_per_minute: int = Field(..., description="요청 한도(분당)")
    cache_ttl_seconds: int = Field(..., description="캐시 TTL(초)")


class ApiSettings(BaseModel):
    api_base_url: str = Field(..., description="API Base URL")


class AdvancedSettingsRequest(BaseModel):
    security: SecuritySettings
    performance: PerformanceSettings
    api: ApiSettings


class AdvancedSettingsResponse(BaseModel):
    ok: bool = True
    data: Dict[str, Any]
    meta: Dict[str, Any]


# ─────────────────────────────────────────
# 엔드포인트
# ─────────────────────────────────────────

@settings_advanced.get(
    "",
    response_model=AdvancedSettingsResponse,
    summary="고급설정 조회",
)
def get_advanced_settings(
    svc: SettingsAdvancedService = Depends(get_service),
):
    """
    고급설정 조회
    """
    try:
        result = svc.get_advanced_settings()

        return {
            "ok": True,
            "data": result,
            "meta": {
                "page_id": PAGE_ID,
                "version": PAGE_VERSION,
            },
        }

    except DomainError:
        raise
    except Exception as exc:
        raise DomainError(
            "SYSTEM-UNKNOWN-999",
            detail="고급설정 조회 중 알 수 없는 오류가 발생했습니다.",
            ctx={"page_id": PAGE_ID, "exc": str(exc)},
            stage="router",
            domain=PAGE_ID,
        )


@settings_advanced.post(
    "",
    response_model=AdvancedSettingsResponse,
    summary="고급설정 저장",
)
def save_advanced_settings(
    payload: AdvancedSettingsRequest,
    svc: SettingsAdvancedService = Depends(get_service),
):
    """
    고급설정 저장
    """
    try:
        result = svc.save_advanced_settings(payload.model_dump())

        return {
            "ok": True,
            "data": result,
            "meta": {
                "page_id": PAGE_ID,
                "version": PAGE_VERSION,
            },
        }

    except DomainError:
        raise
    except Exception as exc:
        raise DomainError(
            "SYSTEM-UNKNOWN-999",
            detail="고급설정 저장 중 알 수 없는 오류가 발생했습니다.",
            ctx={"page_id": PAGE_ID, "exc": str(exc)},
            stage="router",
            domain=PAGE_ID,
        )
