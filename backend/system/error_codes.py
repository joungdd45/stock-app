# 📄 backend/system/error_codes.py
# 목적: 프로젝트 공통 에러 코드·메시지·HTTP 상태 정규화 + 전역 핸들링
# 규칙: <DOMAIN>-<TYPE>-<NNN>
#   - DOMAIN: AUTH, INBOUND, OUTBOUND, PRODUCT, STOCK, REPORTS, SYSTEM
#   - TYPE:   VALID, NOTFOUND, CONFLICT, DENY, DISABLED, STATE, DB, UNKNOWN
#   - NNN 대역: VALID 001-099, NOTFOUND 100-199, CONFLICT 200-299,
#               DENY 300-399, DISABLED 400-450, STATE 451-499,
#               DB 900-949, UNKNOWN 950-999
# 사용:
#   - 서비스: raise DomainError(code, detail=..., ctx=...)  → 전역핸들러가 HTTP 변환
#   - 라우터: 필요 시 raise_http_exception(code, ...)로 즉시 HTTP 변환 가능
#   - 앱 시작 시: register_global_handlers(app) 한 줄로 전역 핸들러 장착
# 상태: v2.2

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Literal, Optional, Tuple, Any
from datetime import datetime, timezone
from uuid import uuid4
import re

try:
    # FastAPI 비존재 환경에서도 안전하게 동작하도록 선택적 임포트
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.responses import JSONResponse
except Exception:  # pragma: no cover
    FastAPI = None  # type: ignore
    HTTPException = None  # type: ignore
    Request = None  # type: ignore
    JSONResponse = None  # type: ignore

# ─────────────────────────────────────────────────────────
# 타입 정의
# ─────────────────────────────────────────────────────────
ErrorStage = Literal["router", "service"]
Domain = Literal["AUTH", "INBOUND", "OUTBOUND", "PRODUCT", "STOCK", "REPORTS", "SYSTEM"]
Type = Literal["VALID", "NOTFOUND", "CONFLICT", "DENY", "DISABLED", "STATE", "DB", "UNKNOWN"]

ERROR_SPEC_VERSION = "v2.2"
_CODE_PATTERN = re.compile(r"^(AUTH|INBOUND|OUTBOUND|PRODUCT|STOCK|REPORTS|SYSTEM)-(VALID|NOTFOUND|CONFLICT|DENY|DISABLED|STATE|DB|UNKNOWN)-\d{3}$")

@dataclass(frozen=True)
class ErrorSpec:
    http: int
    message: str
    hint: str

# ─────────────────────────────────────────────────────────
# 레지스트리 — 공통 기본 세트
# ─────────────────────────────────────────────────────────
REGISTRY: Dict[str, ErrorSpec] = {
    # SYSTEM
    "SYSTEM-UNKNOWN-999": ErrorSpec(500, "처리 중 오류가 발생했습니다", "잠시 후 다시 시도하세요"),
    "SYSTEM-DB-901":      ErrorSpec(500, "데이터 처리 중 오류가 발생했습니다", "관리자에게 문의하세요"),

    # AUTH
    "AUTH-DENY-001": ErrorSpec(401, "인증이 필요합니다", "다시 로그인하세요."),
    "AUTH-DENY-002": ErrorSpec(401, "아이디 또는 비밀번호를 확인해 주세요.", "아이디와 비밀번호를 다시 입력해 주세요."),
    "AUTH-DENY-003": ErrorSpec(403, "권한이 없습니다", "권한이 있는 계정으로 시도하세요."),

    # INBOUND
    "INBOUND-VALID-001":     ErrorSpec(422, "요청 값이 유효하지 않습니다", "입력값을 확인하세요."),
    "INBOUND-NOTFOUND-101":  ErrorSpec(404, "대상을 찾을 수 없습니다", "식별자를 확인하세요."),
    "INBOUND-CONFLICT-201":  ErrorSpec(409, "현재 상태에서 처리할 수 없습니다", "상태를 확인하세요."),
    "INBOUND-STATE-451":     ErrorSpec(409, "현재 상태에서는 허용되지 않습니다", "상태를 확인하세요."),
    "INBOUND-DISABLED-401":  ErrorSpec(501, "기능이 비활성화되어 있습니다", "관리자에게 기능 활성화를 요청하세요."),

    # OUTBOUND
    "OUTBOUND-VALID-001":     ErrorSpec(422, "요청 값이 유효하지 않습니다", "입력값을 확인하세요."),
    "OUTBOUND-NOTFOUND-101":  ErrorSpec(404, "대상을 찾을 수 없습니다", "식별자를 확인하세요."),
    "OUTBOUND-CONFLICT-201":  ErrorSpec(409, "현재 상태에서 처리할 수 없습니다", "상태를 확인하세요."),
    "OUTBOUND-STATE-451":     ErrorSpec(409, "현재 상태에서는 허용되지 않습니다", "상태를 확인하세요."),
    "OUTBOUND-DISABLED-401":  ErrorSpec(501, "기능이 비활성화되어 있습니다", "관리자에게 기능 활성화를 요청하세요."),

    # PRODUCT
    "PRODUCT-VALID-001":     ErrorSpec(422, "요청 값이 유효하지 않습니다", "입력값을 확인하세요."),
    "PRODUCT-NOTFOUND-101":  ErrorSpec(404, "대상을 찾을 수 없습니다", "식별자를 확인하세요."),
    "PRODUCT-CONFLICT-201":  ErrorSpec(409, "현재 상태에서 처리할 수 없습니다", "상태를 확인하세요."),

    # STOCK
    "STOCK-VALID-001":     ErrorSpec(422, "요청 값이 유효하지 않습니다", "입력값을 확인하세요."),
    "STOCK-NOTFOUND-101":  ErrorSpec(404, "대상을 찾을 수 없습니다", "식별자를 확인하세요."),
    "STOCK-CONFLICT-201":  ErrorSpec(409, "현재 상태에서 처리할 수 없습니다", "상태를 확인하세요."),
    "STOCK-STATE-451":     ErrorSpec(409, "현재 상태에서는 허용되지 않습니다", "상태를 확인하세요."),

    # REPORTS
    "REPORTS-VALID-001":    ErrorSpec(422, "요청 값이 유효하지 않습니다", "입력값을 확인하세요."),
    "REPORTS-NOTFOUND-101": ErrorSpec(404, "대상을 찾을 수 없습니다", "조건을 확인하세요."),
    "REPORTS-UNKNOWN-999":  ErrorSpec(500, "처리 중 오류가 발생했습니다", "잠시 후 다시 시도하세요."),
}

# ─────────────────────────────────────────────────────────
# 유틸
# ─────────────────────────────────────────────────────────

def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

def _normalize_code(code: str) -> str:
    # 공백 제거, 대문자 변환
    c = (code or "").strip().upper()
    if not _CODE_PATTERN.match(c):
        return "SYSTEM-UNKNOWN-999"
    return c

def _lookup(code: str) -> Tuple[str, ErrorSpec]:
    c = _normalize_code(code)
    return c, REGISTRY.get(c, REGISTRY["SYSTEM-UNKNOWN-999"])

def add_registry(overrides: Dict[str, ErrorSpec]) -> None:
    """
    레지스트리를 런타임에 확장하거나 덮어쓴다.
    사용 예: add_registry({"INBOUND-NOTFOUND-102": ErrorSpec(404, "입고 전표가 없습니다", "전표번호를 확인하세요")})
    """
    for k, v in overrides.items():
        REGISTRY[_normalize_code(k)] = v

# ─────────────────────────────────────────────────────────
# 도메인 예외 — 서비스는 이 예외만 던진다
# ─────────────────────────────────────────────────────────
class DomainError(Exception):
    """
    서비스 계층 전용 도메인 예외.
    메시지 조립, HTTP 상태 결정은 하지 않는다.
    """
    def __init__(
        self,
        code: str,
        *,
        detail: str = "",
        ctx: Optional[dict] = None,
        stage: ErrorStage = "service",
        domain: Optional[str] = None,
        trace_id: Optional[str] = None,
    ) -> None:
        self.code = _normalize_code(code)
        self.detail = detail
        self.ctx = ctx or {}
        self.stage = stage
        self.domain = domain
        self.trace_id = trace_id  # 없으면 핸들러에서 생성
        super().__init__(self.code)

# ─────────────────────────────────────────────────────────
# 에러 바디 빌더
# ─────────────────────────────────────────────────────────
def build_error(
    code: str,
    *,
    detail: str = "",
    ctx: Optional[dict] = None,
    stage: ErrorStage = "service",
    domain: Optional[str] = None,
    trace_id: Optional[str] = None,
) -> Tuple[int, dict]:
    """
    반환값: (http_status, body)
    body:
    {
      "ok": False,
      "error": {
        "code": "...",
        "message": "...",
        "hint": "...",
        "detail": "...",
        "ctx": {...},
        "stage": "router" | "service",
        "domain": "inbound.process",
        "trace_id": "req-...",
        "timestamp": "UTC ISO8601Z"
      },
      "meta": {"spec_version": "v2.2"}
    }
    """
    code_norm, spec = _lookup(code)
    body = {
        "ok": False,
        "error": {
            "code": code_norm,
            "message": spec.message,
            "hint": spec.hint,
            "detail": detail,
            "ctx": ctx or {},
            "stage": stage,
            "domain": domain,
            "trace_id": trace_id or f"req-{uuid4().hex}",
            "timestamp": _utc_now_iso(),
        },
        "meta": {"spec_version": ERROR_SPEC_VERSION},
    }
    return spec.http, body

def raise_http_exception(
    code: str,
    *,
    detail: str = "",
    ctx: Optional[dict] = None,
    stage: ErrorStage = "service",
    domain: Optional[str] = None,
    trace_id: Optional[str] = None,
):
    """
    FastAPI 사용 시: 즉시 HTTPException을 던진다.
    FastAPI 미사용 시: (status, body)를 반환한다.
    """
    status, body = build_error(
        code, detail=detail, ctx=ctx, stage=stage, domain=domain, trace_id=trace_id
    )
    if HTTPException is None:  # pragma: no cover
        return status, body
    raise HTTPException(status_code=status, detail=body)

# ─────────────────────────────────────────────────────────
# 예외 → 표준 에러로 매핑
# ─────────────────────────────────────────────────────────
def map_exception(exc: Exception) -> Tuple[int, dict]:
    """
    임의의 예외를 표준 에러 바디로 변환한다.
    - DomainError: 선언된 코드 사용
    - ValueError, KeyError: VALID 422
    - FileNotFoundError: NOTFOUND 404
    - PermissionError: AUTH DENY 403
    - IntegrityError(문자열로 탐지): SYSTEM DB 500
    - 그 외: SYSTEM UNKNOWN 500
    """
    if isinstance(exc, DomainError):
        return build_error(
            exc.code,
            detail=exc.detail,
            ctx=exc.ctx,
            stage=exc.stage,
            domain=exc.domain,
            trace_id=exc.trace_id,
        )

    name = exc.__class__.__name__
    msg = str(exc)

    # 가벼운 휴리스틱 매핑
    if name in ("ValueError", "TypeError", "AssertionError", "KeyError"):
        return build_error("SYSTEM-VALID-001", detail=msg, ctx={"exc": name})
    if name in ("FileNotFoundError",):
        return build_error("SYSTEM-NOTFOUND-101", detail=msg, ctx={"exc": name})
    if name in ("PermissionError",):
        return build_error("AUTH-DENY-003", detail=msg, ctx={"exc": name})

    # SQLAlchemy IntegrityError 탐지(직접 임포트 없이 문자열로)
    if "IntegrityError" in name or "IntegrityError" in msg:
        return build_error("SYSTEM-DB-901", detail=msg, ctx={"exc": name})

    return build_error("SYSTEM-UNKNOWN-999", detail=msg, ctx={"exc": name})

# ─────────────────────────────────────────────────────────
# FastAPI 전역 핸들러 등록
# ─────────────────────────────────────────────────────────
def register_global_handlers(app: Any) -> None:
    """
    앱 부팅 시 1회 호출:
        from backend.system.error_codes import register_global_handlers
        register_global_handlers(app)
    """
    if FastAPI is None or JSONResponse is None:
        return  # FastAPI 미사용 환경

    @app.exception_handler(DomainError)
    async def _domain_error_handler(request: Request, exc: DomainError):
        status, body = map_exception(exc)
        return JSONResponse(status_code=status, content=body)

    @app.exception_handler(HTTPException)  # 라우터에서 직접 raise한 경우
    async def _http_exception_handler(request: Request, exc: HTTPException):
        # detail이 우리가 만든 포맷이면 그대로 사용, 아니면 표준 바디로 감싼다
        if isinstance(exc.detail, dict) and "error" in exc.detail and "ok" in exc.detail:
            return JSONResponse(status_code=exc.status_code, content=exc.detail)
        # 외부 라이브러리에서 올린 HTTPException 등
        status, body = build_error(
            "SYSTEM-UNKNOWN-999",
            detail=str(exc.detail),
            ctx={"status_code": exc.status_code},
            stage="router",
        )
        return JSONResponse(status_code=status, content=body)

    @app.exception_handler(Exception)  # 최후의 보루
    async def _unhandled_exception_handler(request: Request, exc: Exception):
        status, body = map_exception(exc)
        return JSONResponse(status_code=status, content=body)

# ─────────────────────────────────────────────────────────
# 스키마 미리보기용 샘플(개발 중 임시 확인)
# ─────────────────────────────────────────────────────────
def preview_error(code: str, *, detail: str = "", ctx: Optional[dict] = None) -> dict:
    """
    개발 단계에서 포맷 확인용. HTTP 상태는 포함하지 않는다.
    """
    _, body = build_error(code, detail=detail, ctx=ctx or {})
    return body
