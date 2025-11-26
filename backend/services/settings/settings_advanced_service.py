# 📄 backend/services/settings/settings_advanced_service.py
# 페이지: 설정 - 고급설정(AdvancedPage)
# 역할: settings_advanced 테이블 조회/저장 비즈니스 로직 전담
# 단계: v2.1 (ORM 의존 제거, raw SQL 사용)
#
# PAGE_ID      : "settings.advanced"
# PAGE_VERSION : "v2.1"
#
# 규칙:
# - 라우터는 HTTP/DTO만, 이 파일이 비즈니스 로직 전담
# - DB 접근은 모두 여기에서만 수행
# - DomainError를 통해 에러를 보고하고, 라우터에서는 그대로 전달만 한다.

from __future__ import annotations

import os
from typing import Any, Dict, List, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError


PAGE_ID = "settings.advanced"
PAGE_VERSION = "v2.1"


# ─────────────────────────────────────────────
# 내부 매핑 규칙
# ─────────────────────────────────────────────
#
# DTO 필드명  ↔  settings_advanced(category, key, value_type)
#
# security:
#   require_x_api_key   ↔ ("security",   "require_api_key", "bool")
#   require_jwt_token   ↔ ("security",   "require_jwt",     "bool")
#   api_key             ↔ ("security",   "api_key",         "string")
#
# performance:
#   request_limit_per_minute ↔ ("performance", "request_limit", "int")
#   cache_ttl_seconds        ↔ ("performance", "cache_ttl",     "int")
#
# api:
#   api_base_url        ↔ ("api",       "base_url",       "string")
#


SecurityMap = {
    "require_x_api_key": ("security", "require_api_key", "bool"),
    "require_jwt_token": ("security", "require_jwt", "bool"),
    "api_key": ("security", "api_key", "string"),
}

PerformanceMap = {
    "request_limit_per_minute": ("performance", "request_limit", "int"),
    "cache_ttl_seconds": ("performance", "cache_ttl", "int"),
}

ApiMap = {
    "api_base_url": ("api", "base_url", "string"),
}


class SettingsAdvancedService:
    """
    설정 - 고급설정 서비스

    - settings_advanced 테이블 조회/저장
    - DTO ↔ DB (category, key, value, value_type) 매핑
    - 권한/유효성 검증, DomainError 관리 담당
    """

    def __init__(self, db: Session, current_user: str | None):
        self.db = db
        # current_user가 없으면 시스템 계정으로 기록
        self.current_user = current_user or "system"

    # ─────────────────────────────────────────
    # 공통 유틸
    # ─────────────────────────────────────────

    @staticmethod
    def _parse_value(value: str, value_type: str) -> Any:
        """DB에 문자열로 저장된 value를 타입에 맞게 변환"""
        try:
            if value_type == "bool":
                return value.lower() in ("1", "true", "yes", "on")
            if value_type == "int":
                return int(value)
            if value_type == "json":
                import json

                return json.loads(value)
        except Exception as exc:  # 타입 변환 실패
            raise DomainError(
                "SETTINGS-VALUE-001",
                detail=f"설정값을 {value_type} 타입으로 변환할 수 없습니다.",
                ctx={"page_id": PAGE_ID, "value": value, "value_type": value_type, "exc": str(exc)},
                stage="service",
                domain=PAGE_ID,
            )

        # string 등은 그대로 반환
        return value

    @staticmethod
    def _serialize_value(value: Any, value_type: str) -> str:
        """파이썬 값을 DB 저장용 문자열로 변환"""
        if value_type == "bool":
            return "true" if bool(value) else "false"
        if value_type == "int":
            return str(int(value))
        if value_type == "json":
            import json

            return json.dumps(value, ensure_ascii=False)
        # string
        return str(value)

    # ─────────────────────────────────────────
    # 조회
    # ─────────────────────────────────────────

    def get_advanced_settings(self) -> Dict[str, Any]:
        """
        고급설정 전체 조회

        반환 형태:

        {
            "security": {
                "require_x_api_key": bool,
                "require_jwt_token": bool,
                "api_key": str | None
            },
            "performance": {
                "request_limit_per_minute": int,
                "cache_ttl_seconds": int
            },
            "api": {
                "api_base_url": str
            }
        }
        """

        # 기본값(환경변수 → 없으면 하드코딩)
        default_security = {
            "require_x_api_key": False,
            "require_jwt_token": False,
            "api_key": os.getenv("API_KEY", ""),
        }
        default_performance = {
            "request_limit_per_minute": int(os.getenv("RATE_LIMIT_REQUESTS", "5")),
            "cache_ttl_seconds": 15,
        }
        default_api = {
            "api_base_url": os.getenv("VITE_API_BASE_URL", "http://localhost:8000"),
        }

        security = dict(default_security)
        performance = dict(default_performance)
        api = dict(default_api)

        try:
            stmt = text(
                """
                SELECT category, key, value, value_type
                FROM settings_advanced
                WHERE deleted_at IS NULL
                """
            )
            rows = self.db.execute(stmt).mappings().all()
        except Exception as exc:
            raise DomainError(
                "SETTINGS-DB-002",
                detail="고급설정 조회 중 DB 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "exc": str(exc)},
                stage="service",
                domain=PAGE_ID,
            )

        for row in rows:
            category = row["category"]
            key = row["key"]
            value = row["value"]
            value_type = row["value_type"]

            dto_key = None

            if category == "security":
                for k, (_, mapped_key, _) in SecurityMap.items():
                    if mapped_key == key:
                        dto_key = k
                        break
                if dto_key:
                    security[dto_key] = self._parse_value(value, value_type)

            elif category == "performance":
                for k, (_, mapped_key, _) in PerformanceMap.items():
                    if mapped_key == key:
                        dto_key = k
                        break
                if dto_key:
                    performance[dto_key] = self._parse_value(value, value_type)

            elif category == "api":
                for k, (_, mapped_key, _) in ApiMap.items():
                    if mapped_key == key:
                        dto_key = k
                        break
                if dto_key:
                    api[dto_key] = self._parse_value(value, value_type)

        return {
            "security": security,
            "performance": performance,
            "api": api,
        }

    # ─────────────────────────────────────────
    # 저장
    # ─────────────────────────────────────────

    def save_advanced_settings(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """
        고급설정 저장

        payload 구조(라우터 DTO 기준):

        {
            "security": {
                "require_x_api_key": bool,
                "require_jwt_token": bool,
                "api_key": str | None
            },
            "performance": {
                "request_limit_per_minute": int,
                "cache_ttl_seconds": int
            },
            "api": {
                "api_base_url": str
            }
        }

        저장 후 최신 값을 다시 조회해서 반환한다.
        """
        if not isinstance(payload, dict):
            raise DomainError(
                "SETTINGS-VALID-001",
                detail="요청 본문 형식이 올바르지 않습니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        security = payload.get("security") or {}
        performance = payload.get("performance") or {}
        api_data = payload.get("api") or {}

        # 저장 대상 (category, db_key, dto_key, value_type, 실제값)
        to_save: List[Tuple[str, str, str, str, Any]] = []

        # security
        for dto_key, (category, db_key, value_type) in SecurityMap.items():
            if dto_key in security:
                to_save.append((category, db_key, dto_key, value_type, security[dto_key]))

        # performance
        for dto_key, (category, db_key, value_type) in PerformanceMap.items():
            if dto_key in performance:
                to_save.append((category, db_key, dto_key, value_type, performance[dto_key]))

        # api
        for dto_key, (category, db_key, value_type) in ApiMap.items():
            if dto_key in api_data:
                to_save.append((category, db_key, dto_key, value_type, api_data[dto_key]))

        if not to_save:
            raise DomainError(
                "SETTINGS-VALID-002",
                detail="저장할 설정 값이 없습니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        try:
            for category, db_key, dto_key, value_type, raw_value in to_save:
                value_str = self._serialize_value(raw_value, value_type)

                upsert_stmt = text(
                    """
                    INSERT INTO settings_advanced (category, key, value, value_type, updated_by, updated_at, deleted_at)
                    VALUES (:category, :key, :value, :value_type, :updated_by, NOW(), NULL)
                    ON CONFLICT (category, key)
                    DO UPDATE SET
                        value      = EXCLUDED.value,
                        value_type = EXCLUDED.value_type,
                        updated_by = EXCLUDED.updated_by,
                        updated_at = NOW(),
                        deleted_at = NULL
                    """
                )

                self.db.execute(
                    upsert_stmt,
                    {
                        "category": category,
                        "key": db_key,
                        "value": value_str,
                        "value_type": value_type,
                        "updated_by": self.current_user,
                    },
                )

            self.db.commit()
        except DomainError:
            self.db.rollback()
            raise
        except Exception as exc:
            self.db.rollback()
            raise DomainError(
                "SETTINGS-DB-001",
                detail="고급설정 저장 중 DB 오류가 발생했습니다.",
                ctx={"page_id": PAGE_ID, "exc": str(exc)},
                stage="service",
                domain=PAGE_ID,
            )

        return self.get_advanced_settings()
