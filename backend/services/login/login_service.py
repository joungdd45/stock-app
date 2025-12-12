# 📄 backend/services/login/login_service.py
# 페이지: 로그인(LoginPage)
# 역할:
#   - ID/비밀번호 검증
#   - 사용자 상태 확인(삭제, 비활성 여부)
#   - last_login_at, login_count 갱신
#   - JWT access_token / refresh_token 발급
#
# 단계: v3.2 (로그인 실패 코드 통합: AUTH-DENY-002 단일화)

from __future__ import annotations

from typing import Any, Dict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

import backend.models as models_module
from backend.security.password import verify_password
from backend.security.jwt_tokens import create_access_token, create_refresh_token
from backend.system.error_codes import DomainError

PAGE_ID = "login.main"
PAGE_VERSION = "v3.2"

# ✅ 로그인 실패 단일 UX (보안/UX)
LOGIN_FAIL_CODE = "AUTH-DENY-002"
LOGIN_FAIL_MESSAGE = "아이디 또는 비밀번호를 확인해 주세요."


def _get_user_model() -> Any:
    """
    backend.models 안에서 User/Users 모델을 안전하게 찾아서 반환.
    """
    if hasattr(models_module, "Users"):
        return getattr(models_module, "Users")
    if hasattr(models_module, "User"):
        return getattr(models_module, "User")

    raise DomainError(
        "SYSTEM-DB-901",
        detail="backend.models에서 사용자 모델(Users/User)을 찾을 수 없습니다.",
        ctx={"page_id": PAGE_ID, "available_attrs": dir(models_module)},
    )


class LoginService:
    """
    로그인(LoginPage) 서비스 구현체.
    - 로그인 실패는 어떤 경우든 AUTH-DENY-002 단일 코드/단일 문구로 처리
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Session, user: Dict[str, Any] | None = None):
        self.session: Session = session
        self.user: Dict[str, Any] = user or {}
        self.User = _get_user_model()

    def _deny_login(self, *, step: str, user_id: str | None = None) -> None:
        """
        로그인 실패(단일 코드) helper.
        - step은 내부 디버깅/로그 용도 (프론트 노출 문구는 단일)
        """
        ctx: Dict[str, Any] = {"page_id": PAGE_ID, "step": step}
        if user_id:
            ctx["user_id"] = user_id

        raise DomainError(
            LOGIN_FAIL_CODE,
            detail=LOGIN_FAIL_MESSAGE,
            ctx=ctx,
        )

    def login(self, *, user_id: str, password: str) -> Dict[str, Any]:
        """
        ID(=users.username) / 비밀번호 기반 로그인
        - 어떤 인증 실패든 AUTH-DENY-002로 통일
        """

        # 1) 입력값 (UX상 세부 안내를 주고 싶어도, 정책상 여기서도 동일 코드 유지)
        if not user_id or not user_id.strip():
            self._deny_login(step="missing_id")

        if not password or not password.strip():
            self._deny_login(step="missing_password", user_id=user_id.strip() if user_id else None)

        uid = user_id.strip()
        db = self.session
        User = self.User

        # 2) 사용자 조회 (활성 + 미삭제)
        stmt = (
            select(User)
            .where(
                User.username == uid,
                User.deleted_at.is_(None),
                User.is_active.is_(True),
            )
        )

        try:
            result = db.execute(stmt)
        except Exception as e:
            raise DomainError(
                "SYSTEM-DB-901",
                detail="로그인 중 사용자 조회에 실패했습니다.",
                ctx={"page_id": PAGE_ID, "error": str(e)},
            )

        user_obj = result.scalar_one_or_none()

        # 3) 사용자 없음 → 단일 실패
        if user_obj is None:
            self._deny_login(step="user_not_found", user_id=uid)

        # 4) 비밀번호 검증 → 단일 실패
        try:
            ok = verify_password(password, user_obj.password_hash)
        except Exception as e:
            # verify_password 자체가 예외를 던지는 진짜 사고만 UNKNOWN 처리
            raise DomainError(
                "SYSTEM-UNKNOWN-999",
                detail="비밀번호 검증 중 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "error": str(e)},
            )

        if not ok:
            self._deny_login(step="password_mismatch", user_id=uid)

        # 5) 계정 상태 재확인 (이중 방어) → 정책상 단일 실패 유지
        if getattr(user_obj, "deleted_at", None) is not None:
            self._deny_login(step="deleted_account", user_id=uid)

        if not getattr(user_obj, "is_active", True):
            self._deny_login(step="inactive_account", user_id=uid)

        # 6) 로그인 이력 갱신
        now = datetime.utcnow()
        try:
            current_count = getattr(user_obj, "login_count", 0) or 0
            user_obj.last_login_at = now
            user_obj.login_count = current_count + 1
            db.flush()
            db.commit()
        except Exception as e:
            raise DomainError(
                "SYSTEM-DB-901",
                detail="로그인 이력 업데이트에 실패했습니다.",
                ctx={"page_id": PAGE_ID, "error": str(e), "user_id": uid},
            )

        # 7) JWT 발급
        subject = str(user_obj.id)
        username = user_obj.username
        role = getattr(user_obj, "role", None)

        access_token = create_access_token(subject=subject, username=username, role=role)
        refresh_token = create_refresh_token(subject=subject, username=username, role=role)

        # 8) 반환
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": {
                "id": user_obj.id,
                "username": user_obj.username,
                "name": getattr(user_obj, "name", None),
                "role": role,
                "last_login_at": user_obj.last_login_at,
                "login_count": user_obj.login_count,
            },
        }


def login_with_id_password(
    db: Session,
    *,
    user_id: str,
    password: str,
    page_id: str = PAGE_ID,
) -> Dict[str, Any]:
    """
    라우터에서 직접 호출하는 함수형 로그인 엔트리포인트.
    """
    service = LoginService(session=db, user={})
    return service.login(user_id=user_id, password=password)
