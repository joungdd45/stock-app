# 📄 backend/routers/outbound/outbound_register.py
# 페이지: 출고 등록(OutboundRegisterPage) - 조회 탭
# 역할: 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v2.2 (조회 탭 + xlsx 다운로드 구현) / 헌법 v1.0 + 코딩 규약 v1.0 적용
# 파일명=라우터명=tags 통일: outbound-register
#
# PAGE_ID: outbound.register.query

from __future__ import annotations
from typing import Optional, Dict, Any, List

from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.system.error_codes import DomainError
from backend.db.session import get_sync_session
from backend.services.outbound.outbound_register_service import OutboundRegisterService
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.register.query"
PAGE_VERSION = "v2.2"

ROUTE_PREFIX = "/api/outbound/register"
ROUTE_TAGS = ["outbound-register"]

outbound_register = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["outbound_register"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 세션, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session=Depends(get_sync_session),
) -> OutboundRegisterService:
    """Sync DB 세션 + 인증 유저 DI."""
    return OutboundRegisterService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 스키마
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
# [system] ping
# ─────────────────────────────────────────────────────────
@outbound_register.get(
    "/ping",
    response_model=PingResponse,
    summary="[system] 페이지 헬스 체크",
)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="router+service+xlsx",
    )

# ─────────────────────────────────────────────────────────
# 1) 목록 조회 — list_items
# ─────────────────────────────────────────────────────────
@outbound_register.get(
    "/list",
    response_model=ActionResponse,
    summary="[read] 출고등록 목록 조회",
    responses={422: {"description": "VALID"}},
)
async def list_items(
    keyword: Optional[str] = None,
    page: int = 1,
    size: int = 20,
    sort_by: Optional[str] = None,
    sort_dir: Optional[str] = "asc",
    svc: OutboundRegisterService = Depends(get_service),
):
    """
    출고등록 조회 탭 하단 표 데이터 조회.
    - keyword: 국가 / 주문번호 / 트래킹번호 / SKU / 상품명 통합 검색
    - page, size: 페이징
    - sort_by, sort_dir: 정렬 옵션
    """
    try:
        result = await svc.list_items(
            keyword=keyword,
            page=page,
            size=size,
            sort_by=sort_by,
            sort_dir=sort_dir,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 2) 액션 — 수정 / 삭제 / 선택 엑셀(xlsx) 다운로드
# ─────────────────────────────────────────────────────────
class ActionRequest(BaseModel):
    action: str = Field(..., description="'update' | 'delete' | 'export'")
    ids: List[int] = Field(default_factory=list, description="대상 outbound_item.id 목록")
    payload: Optional[Dict[str, Any]] = Field(
        default=None,
        description="수정(update) 시 변경할 필드들",
    )


@outbound_register.post(
    "/action",
    response_model=ActionResponse,
    summary="[write] 수정 · 삭제 · 선택 엑셀(xlsx)",
    responses={
        200: {
            "description": "성공 (update/delete: JSON, export: xlsx 파일)",
            "content": {
                "application/json": {},
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
            },
        },
        404: {"description": "NOTFOUND"},
        409: {"description": "CONFLICT/STATE"},
        422: {"description": "VALID"},
    },
)
async def do_action(
    payload: ActionRequest,
    svc: OutboundRegisterService = Depends(get_service),
):
    """
    조회 탭에서 체크박스로 선택한 행에 대한 액션 엔드포인트.

    - action == 'update'
      - ids: 정확히 1개
      - payload: country / order_number / tracking_number / sku / qty / total_price 중 일부
      - 응답: JSON (ActionResponse)

    - action == 'delete'
      - ids: 1개 이상
      - 응답: JSON (ActionResponse)

    - action == 'export'
      - ids: 1개 이상
      - 응답: xlsx 파일 (StreamingResponse, 첨부 다운로드)
    """
    try:
        if payload.action == "update":
            if not payload.ids:
                raise DomainError(
                    "SYSTEM-VALID-001",
                    detail="수정할 ID가 필요합니다.",
                    ctx={"page_id": PAGE_ID},
                )
            item_id = payload.ids[0]
            data = payload.payload or {}
            result = await svc.update_item(item_id=item_id, data=data)
            return ActionResponse(ok=True, data=ActionData(result=result))

        elif payload.action == "delete":
            result = await svc.delete_items(ids=payload.ids)
            return ActionResponse(ok=True, data=ActionData(result=result))

        elif payload.action == "export":
            # 1) 서비스에서 선택된 행 데이터 조회
            export_data = await svc.export_items_xlsx(ids=payload.ids)
            rows = export_data.get("rows", [])

            if not rows:
                raise DomainError(
                    "OUTBOUND-NOTFOUND-004",
                    detail="엑셀로 내보낼 데이터가 없습니다.",
                    ctx={"page_id": PAGE_ID, "ids": payload.ids},
                    stage="router",
                    domain=PAGE_ID,
                )

            # 2) xlsx 생성 (openpyxl 사용)
            try:
                from openpyxl import Workbook  # type: ignore
            except Exception as exc:
                # 모듈이 없으면 시스템 에러로 래핑
                raise DomainError(
                    "SYSTEM-UNKNOWN-999",
                    detail="엑셀(xlsx) 생성 모듈을 사용할 수 없습니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "reason": "OPENPYXL_IMPORT_FAILED",
                        "exc": str(exc),
                    },
                    stage="router",
                    domain=PAGE_ID,
                )

            wb = Workbook()
            ws = wb.active
            ws.title = "OutboundRegister"

            # 헤더: GUI 하단 표와 동일 순서
            headers = ["국가", "주문번호", "트래킹번호", "SKU", "상품명", "출고수량", "총 가격"]
            ws.append(headers)

            # 데이터 행
            for r in rows:
                ws.append(
                    [
                        r.get("country"),
                        r.get("order_number"),
                        r.get("tracking_number"),
                        r.get("sku"),
                        r.get("product_name"),
                        r.get("qty"),
                        r.get("total_price"),
                    ]
                )

            # 3) 메모리 버퍼에 저장
            buffer = BytesIO()
            wb.save(buffer)
            buffer.seek(0)

            # 4) 파일 응답
            ts = datetime.now().strftime("%Y%m%d-%H%M%S")
            filename = f"outbound-register-{ts}.xlsx"

            return StreamingResponse(
                buffer,
                media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                headers={
                    "Content-Disposition": f'attachment; filename="{filename}"'
                },
            )

        else:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="지원하지 않는 action 입니다.",
                ctx={"page_id": PAGE_ID, "action": payload.action},
            )

    except DomainError as exc:
        raise exc
