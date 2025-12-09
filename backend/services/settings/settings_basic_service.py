# 📄 backend/services/settings/settings_basic_service.py
# 페이지: 설정 > 기본설정(BasicPage.tsx)
# 역할: 비즈니스 로직 전담 (조회, 검증, 상태변경, 트랜잭션, 도메인 예외)
# 단계: v2.2 (사용자설정 + 페이지설정 + 비밀번호 생성/수정, 모델 동적 로딩)

from __future__ import annotations

from typing import Any, Dict, List, Optional
from datetime import datetime

import bcrypt
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
import backend.models as models_module

PAGE_ID = "settings.basic"
PAGE_VERSION = "v2.2"

DEFAULT_PAGE_SIZE = 20
DEFAULT_THEME = "라이트"
THEME_ALLOWED = {"라이트", "다크", "시스템"}

# UI 라벨 to DB 코드 매핑
ROLE_LABEL_TO_DB = {
    "관리자": "admin",
    "직원": "manager",
    "조회": "user",
}
ROLE_DB_ALLOWED = {"admin", "manager", "user"}


# ─────────────────────────────────────────────
# 내부 유틸 — 모델/세션 어댑터
# ─────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    backend.models 안의 실제 모델 이름(User vs Users 등)에 따라
    동적으로 Users / SettingsBasicUser 모델을 찾아온다.
    """
    users_model = getattr(models_module, "Users", None)
    if users_model is None:
        users_model = getattr(models_module, "User", None)

    settings_basic_user_model = getattr(models_module, "SettingsBasicUser", None)

    if users_model is None or settings_basic_user_model is None:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="settings.basic: Users 또는 SettingsBasicUser 모델을 찾을 수 없습니다.",
            ctx={
                "page_id": PAGE_ID,
                "has_Users": hasattr(models_module, "Users"),
                "has_User": hasattr(models_module, "User"),
                "has_SettingsBasicUser": hasattr(models_module, "SettingsBasicUser"),
            },
        )

    return {
        "Users": users_model,
        "SettingsBasicUser": settings_basic_user_model,
    }


def _get_session_adapter(session: Any) -> Session:
    if isinstance(session, Session):
        return session
    raise DomainError(
        "SYSTEM-DB-901",
        detail="settings.basic: 지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


def _hash_password(raw_password: str) -> str:
    """
    비밀번호 해시 유틸.
    - bcrypt 사용
    - 로그인 서비스에서 사용하는 검증 로직과 동일한 알고리즘을 가정
    """
    password = (raw_password or "").strip()
    if not password:
        raise DomainError(
            "SETTINGS-VALID-013",
            detail="비밀번호는 필수입니다.",
            ctx={},
        )

    if len(password) < 4:
        # 정책은 필요에 따라 조정 가능 (너무 짧은 비밀번호 방지)
        raise DomainError(
            "SETTINGS-VALID-014",
            detail="비밀번호는 4자 이상이어야 합니다.",
            ctx={"length": len(password)},
        )

    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


# ─────────────────────────────────────────────
# 서비스 클래스
# ─────────────────────────────────────────────
class SettingsBasicService:
    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session: Session = _get_session_adapter(session)
        self.user = user or {}

        # JWT payload(sub) 또는 user_id 둘 다 지원
        raw_user_id = self.user.get("user_id") or self.user.get("sub") or 0
        try:
            self._current_user_id: int = int(raw_user_id)
        except (TypeError, ValueError):
            self._current_user_id = 0

        self._current_role: str = str(self.user.get("role", ""))

        models = _get_models()
        self.Users = models["Users"]
        self.SettingsBasicUser = models["SettingsBasicUser"]

    # ─────────────────────────────────────────────
    # 공통 유틸
    # ─────────────────────────────────────────────
    def _require_login(self) -> None:
        if self._current_user_id <= 0:
            raise DomainError(
                "SETTINGS-AUTH-001",
                detail="로그인 정보가 없습니다.",
                ctx={"page_id": self.page_id},
            )

    def _require_admin(self) -> None:
        if self._current_role not in {"admin", "관리자"}:
            raise DomainError(
                "SETTINGS-FORBIDDEN-001",
                detail="관리자만 접근 가능한 기능입니다.",
                ctx={"page_id": self.page_id, "role": self._current_role},
            )

    def _normalize_role(self, role: str) -> str:
        """
        UI 입력값(관리자/직원/조회 또는 admin/manager/user)을
        DB 저장용 코드로 정규화한다.
        """
        if role in ROLE_DB_ALLOWED:
            return role

        mapped = ROLE_LABEL_TO_DB.get(role)
        if mapped and mapped in ROLE_DB_ALLOWED:
            return mapped

        raise DomainError(
            "SETTINGS-VALID-010",
            detail="허용되지 않은 권한입니다.",
            ctx={"role": role},
        )

    def _validate_page_settings(self, page_size: int, theme: str) -> None:
        if page_size < 10 or page_size > 200:
            raise DomainError(
                "SETTINGS-VALID-001",
                detail="페이지당 개수는 10 to 200 사이여야 합니다.",
                ctx={"page_size": page_size},
            )

        if theme not in THEME_ALLOWED:
            raise DomainError(
                "SETTINGS-VALID-002",
                detail="허용되지 않은 테마입니다.",
                ctx={"theme": theme, "allowed": list(THEME_ALLOWED)},
            )

    def _get_or_default_settings(self, user_id: int) -> Dict[str, Any]:
        stmt = (
            select(self.SettingsBasicUser)
            .where(
                self.SettingsBasicUser.user_id == user_id,
                self.SettingsBasicUser.deleted_at.is_(None),
            )
            .limit(1)
        )
        row = self.session.execute(stmt).scalar_one_or_none()

        if not row:
            return {
                "page_size": DEFAULT_PAGE_SIZE,
                "theme": DEFAULT_THEME,
            }

        return {
            "page_size": row.page_size,
            "theme": row.theme,
        }

    # ─────────────────────────────────────────────
    # A. 사용자 설정 영역 (좌측 표)
    # ─────────────────────────────────────────────
    async def list_users(self) -> List[Dict[str, Any]]:
        """
        [관리자] 사용자 목록 조회
        - 논리삭제(deleted_at IS NULL)만 조회
        """
        self._require_login()
        self._require_admin()

        stmt = (
            select(self.Users)
            .where(self.Users.deleted_at.is_(None))
            .order_by(self.Users.id.asc())
        )
        rows = self.session.execute(stmt).scalars().all()

        results: List[Dict[str, Any]] = []
        for u in rows:
            results.append(
                {
                    "id": u.id,
                    "username": u.username,
                    "name": getattr(u, "name", None),
                    "role": getattr(u, "role", None),
                    "is_active": getattr(u, "is_active", True),
                    "last_login_at": getattr(u, "last_login_at", None),
                    "login_count": getattr(u, "login_count", 0),
                }
            )
        return results

    async def create_user(self, *, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        [관리자] 사용자 추가
        - username 중복 체크
        - role 유효성 검증
        - 비밀번호 해시 저장
        """
        self._require_login()
        self._require_admin()

        username = str(payload.get("username") or "").strip()
        name = str(payload.get("name") or "").strip()
        role_raw = str(payload.get("role") or "").strip()
        raw_password = str(payload.get("password") or "")

        if not username:
            raise DomainError(
                "SETTINGS-VALID-011",
                detail="사용자 ID(username)는 필수입니다.",
                ctx={"field": "username"},
            )

        norm_role = self._normalize_role(role_raw)

        # username 중복 검사 (논리삭제 안 된 행 기준)
        stmt = (
            select(self.Users)
            .where(
                self.Users.username == username,
                self.Users.deleted_at.is_(None),
            )
            .limit(1)
        )
        exists = self.session.execute(stmt).scalar_one_or_none()
        if exists:
            raise DomainError(
                "SETTINGS-VALID-012",
                detail="이미 존재하는 사용자 ID입니다.",
                ctx={"username": username},
            )

        # 비밀번호 해시
        password_hash = _hash_password(raw_password)

        now = datetime.utcnow()
        actor = str(self._current_user_id)

        user = self.Users(
            username=username,
            password_hash=password_hash,
            name=name or None,
            role=norm_role,
            is_active=True,
            created_by=actor if hasattr(self.Users, "created_by") else None,
            updated_by=actor if hasattr(self.Users, "updated_by") else None,
            created_at=now if hasattr(self.Users, "created_at") else None,
            updated_at=now if hasattr(self.Users, "updated_at") else None,
        )

        self.session.add(user)
        self.session.commit()
        self.session.refresh(user)

        return {
            "id": user.id,
            "username": user.username,
            "name": getattr(user, "name", None),
            "role": getattr(user, "role", None),
            "is_active": getattr(user, "is_active", True),
            "last_login_at": getattr(user, "last_login_at", None),
            "login_count": getattr(user, "login_count", 0),
        }

    async def update_user(
        self,
        *,
        user_id: int,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        [관리자] 사용자 정보 수정
        - name, role, is_active 수정
        - 비밀번호는 update_user_password에서만 변경
        """
        self._require_login()
        self._require_admin()

        user: Optional[Any] = self.session.get(self.Users, user_id)
        if not user or getattr(user, "deleted_at", None) is not None:
            raise DomainError(
                "SETTINGS-NOTFOUND-001",
                detail="대상 사용자를 찾을 수 없습니다.",
                ctx={"user_id": user_id},
            )

        name = payload.get("name", None)
        role_raw = payload.get("role", None)
        is_active = payload.get("is_active", None)

        if name is not None and hasattr(user, "name"):
            user.name = str(name).strip() or None

        if role_raw is not None and hasattr(user, "role"):
            norm_role = self._normalize_role(str(role_raw))
            user.role = norm_role

        if is_active is not None and hasattr(user, "is_active"):
            user.is_active = bool(is_active)

        if hasattr(user, "updated_by"):
            user.updated_by = str(self._current_user_id)
        if hasattr(user, "updated_at"):
            user.updated_at = datetime.utcnow()

        self.session.commit()
        self.session.refresh(user)

        return {
            "id": user.id,
            "username": user.username,
            "name": getattr(user, "name", None),
            "role": getattr(user, "role", None),
            "is_active": getattr(user, "is_active", True),
            "last_login_at": getattr(user, "last_login_at", None),
            "login_count": getattr(user, "login_count", 0),
        }

    async def update_user_password(
        self,
        *,
        user_id: int,
        new_password: str,
    ) -> Dict[str, Any]:
        """
        [관리자] 사용자 비밀번호 재설정
        - 사용자는 직접 비밀번호 변경 불가
        - 관리자만 재설정 가능
        """
        self._require_login()
        self._require_admin()

        user: Optional[Any] = self.session.get(self.Users, user_id)
        if not user or getattr(user, "deleted_at", None) is not None:
            raise DomainError(
                "SETTINGS-NOTFOUND-005",
                detail="비밀번호를 변경할 사용자를 찾을 수 없습니다.",
                ctx={"user_id": user_id},
            )

        # 비밀번호 해시 후 교체
        password_hash = _hash_password(new_password)
        if hasattr(user, "password_hash"):
            user.password_hash = password_hash

        if hasattr(user, "updated_by"):
            user.updated_by = str(self._current_user_id)
        if hasattr(user, "updated_at"):
            user.updated_at = datetime.utcnow()

        self.session.commit()
        self.session.refresh(user)

        return {
            "id": user.id,
            "username": user.username,
        }

    async def delete_user(self, *, user_id: int) -> Dict[str, Any]:
        """
        [관리자] 사용자 논리삭제
        - is_active False
        - deleted_at 설정
        """
        self._require_login()
        self._require_admin()

        user: Optional[Any] = self.session.get(self.Users, user_id)
        if not user or getattr(user, "deleted_at", None) is not None:
            raise DomainError(
                "SETTINGS-NOTFOUND-002",
                detail="이미 삭제되었거나 존재하지 않는 사용자입니다.",
                ctx={"user_id": user_id},
            )

        now = datetime.utcnow()
        if hasattr(user, "is_active"):
            user.is_active = False
        if hasattr(user, "deleted_at"):
            user.deleted_at = now
        if hasattr(user, "updated_by"):
            user.updated_by = str(self._current_user_id)
        if hasattr(user, "updated_at"):
            user.updated_at = now

        self.session.commit()

        return {
            "deleted_id": user_id,
            "deleted_at": now,
        }

    # ─────────────────────────────────────────────
    # B. 페이지 설정 영역 (우측 표)
    # ─────────────────────────────────────────────
    async def get_my_page_settings(self) -> Dict[str, Any]:
        self._require_login()
        return self._get_or_default_settings(user_id=self._current_user_id)

    async def put_my_page_settings(self, *, payload: Dict[str, Any]) -> Dict[str, Any]:
        self._require_login()

        page_size = int(payload.get("page_size"))
        theme = str(payload.get("theme"))
        self._validate_page_settings(page_size, theme)

        stmt = (
            select(self.SettingsBasicUser)
            .where(
                self.SettingsBasicUser.user_id == self._current_user_id,
                self.SettingsBasicUser.deleted_at.is_(None),
            )
            .limit(1)
        )
        row: Optional[Any] = self.session.execute(stmt).scalar_one_or_none()

        now = datetime.utcnow()
        actor = str(self._current_user_id)

        if row:
            row.page_size = page_size
            row.theme = theme
            if hasattr(row, "updated_by"):
                row.updated_by = actor
            if hasattr(row, "updated_at"):
                row.updated_at = now
        else:
            row = self.SettingsBasicUser(
                user_id=self._current_user_id,
                page_size=page_size,
                theme=theme,
                updated_by=actor
                if hasattr(self.SettingsBasicUser, "updated_by")
                else None,
                updated_at=now
                if hasattr(self.SettingsBasicUser, "updated_at")
                else None,
            )
            self.session.add(row)

        self.session.commit()

        return {
            "page_size": page_size,
            "theme": theme,
        }

    async def admin_get_user_page_settings(
        self, *, target_user_id: int
    ) -> Dict[str, Any]:
        self._require_login()
        self._require_admin()

        user_stmt = (
            select(self.Users)
            .where(
                self.Users.id == target_user_id,
                self.Users.deleted_at.is_(None),
            )
            .limit(1)
        )
        target = self.session.execute(user_stmt).scalar_one_or_none()
        if not target:
            raise DomainError(
                "SETTINGS-NOTFOUND-003",
                detail="대상 사용자를 찾을 수 없습니다.",
                ctx={"target_user_id": target_user_id},
            )

        return self._get_or_default_settings(user_id=target_user_id)

    async def admin_put_user_page_settings(
        self,
        *,
        target_user_id: int,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        self._require_login()
        self._require_admin()

        user_stmt = (
            select(self.Users)
            .where(
                self.Users.id == target_user_id,
                self.Users.deleted_at.is_(None),
            )
            .limit(1)
        )
        target = self.session.execute(user_stmt).scalar_one_or_none()
        if not target:
            raise DomainError(
                "SETTINGS-NOTFOUND-004",
                detail="대상 사용자를 찾을 수 없습니다.",
                ctx={"target_user_id": target_user_id},
            )

        page_size = int(payload.get("page_size"))
        theme = str(payload.get("theme"))
        self._validate_page_settings(page_size, theme)

        stmt = (
            select(self.SettingsBasicUser)
            .where(
                self.SettingsBasicUser.user_id == target_user_id,
                self.SettingsBasicUser.deleted_at.is_(None),
            )
            .limit(1)
        )
        row: Optional[Any] = self.session.execute(stmt).scalar_one_or_none()

        now = datetime.utcnow()
        actor = f"admin:{self._current_user_id}"

        if row:
            row.page_size = page_size
            row.theme = theme
            if hasattr(row, "updated_by"):
                row.updated_by = actor
            if hasattr(row, "updated_at"):
                row.updated_at = now
        else:
            row = self.SettingsBasicUser(
                user_id=target_user_id,
                page_size=page_size,
                theme=theme,
                updated_by=actor
                if hasattr(self.SettingsBasicUser, "updated_by")
                else None,
                updated_at=now
                if hasattr(self.SettingsBasicUser, "updated_at")
                else None,
            )
            self.session.add(row)

        self.session.commit()

        return {
            "page_size": page_size,
            "theme": theme,
        }
