# 📄 backend/routers/stock/statuspage.py
# 페이지: 재고 현황(StatusPage)
# 역할: 프론트 요청 수신 → 가드/의존성 → 서비스 호출 → 응답 포맷 래핑
# 단계: v1.8 (운영용 xlsx 다운로드 엔드포인트 추가)
#
# ✅ 엔드포인트 구분
# - [운영용] GET /list         : 원장 발생 SKU만, SKU 검색
# - [실사용] GET /search       : 상품 기준, 상품명/SKU 검색
# - [다운로드] GET /export-xlsx : 운영용 기준 xlsx 다운로드 (토큰 필요)
# - scan/multi/action은 기존 유지 (action.export는 JSON이라 다운로드용 아님)

from __future__ import annotations

from typing import Optional, Dict, Any, List
from enum import Enum
from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.stock.statuspage_service import StatusPageService
from backend.db.session import get_sync_session
from backend.security.guard import guard

# ─────────────────────────────────────────────────────────
# 페이지 메타
# ─────────────────────────────────────────────────────────
PAGE_ID = "stock.status"
PAGE_VERSION = "v1.8"

ROUTE_PREFIX = "/api/stock/status"
ROUTE_TAGS = ["statuspage"]

statuspage = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["statuspage"]

# ─────────────────────────────────────────────────────────
# 의존성 — 인증/가드, 서비스 DI
# ─────────────────────────────────────────────────────────
def get_service(
    user: Dict[str, Any] = Depends(guard),
    session: Session = Depends(get_sync_session),
) -> StatusPageService:
    return StatusPageService(session=session, user=user)

# ─────────────────────────────────────────────────────────
# 공통 응답 래퍼
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
# DTO
# ─────────────────────────────────────────────────────────
class MultiSearchRequest(BaseModel):
    skus: List[str] = Field(..., description="다건 검색용 SKU 목록")
    page: int = 1
    size: int = 10
    sort_by: Optional[str] = "sku"
    order: Optional[str] = "asc"


class ActionType(str, Enum):
    ADJUST = "adjust"
    EXPORT = "export"


class ActionRequest(BaseModel):
    action: ActionType
    sku: Optional[str] = None
    final_qty: Optional[int] = None
    memo: Optional[str] = None
    selected_skus: Optional[List[str]] = None


class ScanRequest(BaseModel):
    barcode: str = Field(..., description="스캔된 바코드 값")


# ─────────────────────────────────────────────────────────
# [system] ping
# ─────────────────────────────────────────────────────────
@statuspage.get("/ping", response_model=PingResponse)
def ping():
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="implemented",
    )

# ─────────────────────────────────────────────────────────
# 1️⃣ [운영용] 재고현황 목록
#   - 기준: inventory_ledger 발생 SKU만
#   - 검색: SKU (부분검색)
# ─────────────────────────────────────────────────────────
@statuspage.get("/list", response_model=ActionResponse)
async def list_operational(
    sku: Optional[str] = None,
    page: int = 1,
    size: int = 10,
    sort_by: Optional[str] = "sku",
    order: Optional[str] = "asc",
    svc: StatusPageService = Depends(get_service),
):
    try:
        result = await svc.list_operational(
            sku=sku,
            page=page,
            size=size,
            sort_by=sort_by,
            order=order,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 2️⃣ [실사용] 상품 검색 (실사/검색 전용)
#   - 기준: product 전체
#   - 검색: 상품명 OR SKU
# ─────────────────────────────────────────────────────────
@statuspage.get("/search", response_model=ActionResponse)
async def search_products(
    q: Optional[str] = None,
    page: int = 1,
    size: int = 10,
    sort_by: Optional[str] = "sku",
    order: Optional[str] = "asc",
    svc: StatusPageService = Depends(get_service),
):
    try:
        result = await svc.search_products(
            q=q,
            page=page,
            size=size,
            sort_by=sort_by,
            order=order,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 2-1️⃣ [다운로드] 운영용 xlsx 다운로드
#   - 기준: 운영용(원장 발생 SKU만)
#   - 필터: sku(부분검색) + skus(선택 SKU 정확일치 목록)
# ─────────────────────────────────────────────────────────
@statuspage.get("/export-xlsx")
async def export_xlsx(
    sku: Optional[str] = None,
    skus: Optional[List[str]] = Query(default=None, description="선택 SKU 목록(여러개 가능)"),
    svc: StatusPageService = Depends(get_service),
):
    try:
        # 서비스는 (content_bytes, filename) 형태를 반환해야 함
        content, filename = await svc.export_operational_xlsx_bytes(
            sku=sku,
            selected_skus=skus,
        )
    except DomainError as exc:
        raise exc

    headers = {
        "Content-Disposition": f'attachment; filename="{filename}"'
    }
    return StreamingResponse(
        BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )

# ─────────────────────────────────────────────────────────
# 3️⃣ 바코드 스캔 단건 조회 (기존 유지)
# ─────────────────────────────────────────────────────────
@statuspage.post("/scan", response_model=ActionResponse)
async def scan_by_barcode(
    payload: ScanRequest,
    svc: StatusPageService = Depends(get_service),
):
    try:
        result = await svc.scan_by_barcode(barcode=payload.barcode)
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 4️⃣ 다건 SKU 조회 (기존 유지)
# ─────────────────────────────────────────────────────────
@statuspage.post("/multi", response_model=ActionResponse)
async def multi_items(
    payload: MultiSearchRequest,
    svc: StatusPageService = Depends(get_service),
):
    try:
        result = await svc.list_by_skus(
            skus=payload.skus,
            page=payload.page,
            size=payload.size,
            sort_by=payload.sort_by,
            order=payload.order,
        )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))

# ─────────────────────────────────────────────────────────
# 5️⃣ 재고 조정 / (기존) export(JSON) 유지
# ─────────────────────────────────────────────────────────
@statuspage.post("/action", response_model=ActionResponse)
async def do_action(
    payload: ActionRequest,
    svc: StatusPageService = Depends(get_service),
):
    try:
        if payload.action == ActionType.ADJUST:
            result = await svc.adjust(payload=payload.dict())
        elif payload.action == ActionType.EXPORT:
            # ⚠️ JSON 반환(다운로드용 아님). 다운로드는 /export-xlsx 사용.
            skus = payload.selected_skus or []
            result = await svc.export_items(selected_skus=skus)
        else:
            raise DomainError(
                "STOCK-VALID-001",
                detail="지원하지 않는 액션입니다.",
                ctx={"page_id": PAGE_ID, "action": payload.action},
            )
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))
