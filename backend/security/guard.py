# 📄 backend/security/guard.py
# 역할: JWT 기반 인증 가드
# - 개발 모드(AUTH_REQUIRED=false): 토큰 검사 생략, None 반환
# - 운영 모드(AUTH_REQUIRED=true): Authorization: Bearer <access_token> 필수
#   * access_token 디코딩 및 검증
#   * 실패 시 DomainError로 통일

from __future__ import annotations

import os
from typing import Optional, Dict, Any

from fastapi import Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from backend.security.jwt_tokens import decode_access_token
from backend.system.error_codes import DomainError

# 환경변수 AUTH_REQUIRED=true 이면 토큰 필수, 아니면 개발편의상 통과
AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").lower() in ("1", "true", "yes")

_bearer = HTTPBearer(auto_error=False)


def guard(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(_bearer),
) -> Optional[Dict[str, Any]]:
    """
    공통 인증 가드.

    개발 모드(AUTH_REQUIRED=false):
        - 토큰이 없어도 통과
        - 호출 측에서는 user가 None일 수 있음을 전제로 사용

    운영 모드(AUTH_REQUIRED=true):
        - Authorization 헤더 필수 (Bearer 토큰)
        - access_token 디코딩 및 검증
        - 실패 시 DomainError(AUTH-TOKEN-XXX) 발생
        - 성공 시 JWT payload(dict)를 반환
    """

    # 1) 개발 모드: 인증 스킵
    if not AUTH_REQUIRED:
        return None

    # 2) 운영 모드: 토큰 없으면 401 성격의 도메인 에러
    if credentials is None or not credentials.credentials:
        raise DomainError(
            "AUTH-TOKEN-001",
            detail="인증 토큰이 필요합니다.",
            ctx={"location": "header.Authorization"},
        )

    token = credentials.credentials

    # 3) 토큰 디코딩 및 검증
    try:
        payload = decode_access_token(token)
    except DomainError:
        # jwt_tokens.decode_access_token 에서 이미 AUTH-TOKEN-XXX 로 래핑됨
        raise
    except Exception as e:
        # 예기치 못한 에러 방지용
        raise DomainError(
            "SYSTEM-UNKNOWN-999",
            detail="토큰 검증 중 오류가 발생했습니다.",
            ctx={"error": str(e)},
        )

    # 4) 검증된 JWT payload 반환
    #    예: {"sub": "3", "username": "admin", "role": "admin", ...}
    return payload
