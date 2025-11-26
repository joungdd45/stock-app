# 📄 backend/services/login/login_service.py
# 페이지: 로그인(LoginPage)
# 역할:
#   - ID/비밀번호 검증
#   - 사용자 상태 확인(삭제, 비활성 여부)
#   - last_login_at, login_count 갱신
#   - JWT access_token / refresh_token 발급
#
# 단계: v3.0 (토큰 포함 풀 구현)

from __future__ import annotations

from typing import Any, Dict
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

import backend.models as models_module
from backend.security.password import verify_password
from backend.security.jwt_tokens import (
    create_access_token,
    create_refresh_token,
)
from backend.system.error_codes import DomainError

PAGE_ID = "login.main"
PAGE_VERSION = "v3.0"


# ─────────────────────────────────────────────────────────
# 내부 유틸: User 모델 안전하게 찾기
# ─────────────────────────────────────────────────────────

def _get_user_model() -> Any:
    """
    backend.models 안에서 User/Users 모델을 안전하게 찾아서 반환.
    - models_module.Users 가 있으면 우선 사용
    - 없으면 models_module.User 시도
    - 둘 다 없으면 DomainError
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


# ─────────────────────────────────────────────────────────
# 서비스 클래스
# ─────────────────────────────────────────────────────────

class LoginService:
    """
    로그인(LoginPage) 서비스 구현체.

    - ID / 비밀번호 검증
    - last_login_at, login_count 업데이트
    - access_token / refresh_token 발급
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Session, user: Dict[str, Any] | None = None):
        self.session: Session = session
        self.user: Dict[str, Any] = user or {}
        self.User = _get_user_model()

    # -----------------------------------------------------
    # 로그인 비즈니스 로직
    # -----------------------------------------------------
    def login(
        self,
        *,
        user_id: str,
        password: str,
    ) -> Dict[str, Any]:
        """
        ID(=users.username) / 비밀번호 기반 로그인

        규칙:
        - deleted_at IS NULL AND is_active = TRUE 인 계정만 로그인 가능
        - ID 또는 비밀번호가 틀린 경우 동일 코드로 실패 처리
        - 성공 시 last_login_at, login_count 갱신
        - access_token / refresh_token 발급 후 함께 반환
        """

        # 1) 입력값 검증
        if not user_id or not user_id.strip():
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="아이디는 필수입니다.",
                ctx={"page_id": PAGE_ID, "field": "id"},
            )

        if not password or not password.strip():
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="비밀번호는 필수입니다.",
                ctx={"page_id": PAGE_ID, "field": "password"},
            )

        db = self.session
        User = self.User

        # 2) 사용자 조회 (활성 + 미삭제)
        stmt = (
            select(User)
            .where(
                User.username == user_id,
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

        # 3) 사용자 없음
        if user_obj is None:
            raise DomainError(
                "AUTH-LOGIN-001",
                detail="아이디 또는 비밀번호가 올바르지 않습니다.",
                ctx={"page_id": PAGE_ID, "step": "user_not_found"},
            )

        # 4) 비밀번호 검증
        try:
            if not verify_password(password, user_obj.password_hash):
                raise DomainError(
                    "AUTH-LOGIN-001",
                    detail="아이디 또는 비밀번호가 올바르지 않습니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "step": "password_mismatch",
                        "user_id": user_id,
                    },
                )
        except DomainError:
            # 위에서 던진 DomainError는 그대로 전달
            raise
        except Exception as e:
            raise DomainError(
                "SYSTEM-UNKNOWN-999",
                detail="비밀번호 검증 중 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "error": str(e)},
            )

        # 5) 계정 상태 재확인 (이중 방어)
        if getattr(user_obj, "deleted_at", None) is not None:
            raise DomainError(
                "AUTH-LOGIN-002",
                detail="비활성화된 계정입니다.",
                ctx={"page_id": PAGE_ID, "step": "deleted_account"},
            )

        if not getattr(user_obj, "is_active", True):
            raise DomainError(
                "AUTH-LOGIN-002",
                detail="비활성화된 계정입니다.",
                ctx={"page_id": PAGE_ID, "step": "inactive_account"},
            )

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
                ctx={"page_id": PAGE_ID, "error": str(e), "user_id": user_id},
            )

        # 7) JWT 발급 (access + refresh)
        subject = str(user_obj.id)
        username = user_obj.username
        role = getattr(user_obj, "role", None)

        access_token = create_access_token(
            subject=subject,
            username=username,
            role=role,
        )
        refresh_token = create_refresh_token(
            subject=subject,
            username=username,
            role=role,
        )

        # 8) 반환 (라우터에서 그대로 result로 감싸서 내려감)
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


# ─────────────────────────────────────────────────────────
# 함수형 래퍼 — 라우터에서 직접 사용하는 진입점
# ─────────────────────────────────────────────────────────

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
