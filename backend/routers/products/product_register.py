# 📄 backend/routers/products/product_register.py
# 페이지: 상품관리 — 상품 등록(CreatePage.tsx)
# 역할: 요청 → 가드 → DTO파싱 → 서비스 호출 → 응답
# 단계: v1-9 (v1-8 + barcode → sku 조회 엔드포인트 추가 /lookup-by-barcode)
#
# ✅ 라우터 원칙
# - 비즈니스 로직 없음(계산/검증/트랜잭션 금지)
# - 서비스 호출 + 응답래핑 + 문서화만 담당
# - 에러는 DomainError 그대로 던지고 전역 핸들러에서 처리

from __future__ import annotations

from typing import Optional, Dict, Any, List

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError
from backend.services.products.product_register_service import ProductRegisterService
from backend.db.session import get_sync_session
from backend.security.guard import guard

# ──────────────────────────────────────────
# 페이지 메타
# ──────────────────────────────────────────
PAGE_ID = "product.register"
PAGE_VERSION = "v1-9"

ROUTE_PREFIX = "/api/products/register"
ROUTE_TAGS = ["product_register"]

product_register = APIRouter(prefix=ROUTE_PREFIX, tags=ROUTE_TAGS)
__all__ = ["product_register"]


# ──────────────────────────────────────────
# 의존성
# ──────────────────────────────────────────
def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> ProductRegisterService:
    """
    - DB 세션은 backend.db.session.get_sync_session에서 주입
    - 인증 가드를 통해 현재 사용자 정보도 함께 주입
    - 서비스는 sync Session 전용
    """
    return ProductRegisterService(session=session, user=user)


# ──────────────────────────────────────────
# 공통 Response DTO
# ──────────────────────────────────────────
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


# ──────────────────────────────────────────
# DTO 정의 (기본 CRUD)
# ──────────────────────────────────────────
class ProductCreateDTO(BaseModel):
    sku: str
    name: str
    last_inbound_price: float = 0
    weight: Optional[float] = None
    barcode: Optional[str] = None


class ProductUpdateDTO(BaseModel):
    name: Optional[str] = None
    last_inbound_price: Optional[float] = None
    weight: Optional[float] = None
    barcode: Optional[str] = None
    is_active: Optional[bool] = None


class DeleteRequest(BaseModel):
    skus: List[str]


# ──────────────────────────────────────────
# DTO 정의 (묶음 매핑)
# ──────────────────────────────────────────
class BundleItemDTO(BaseModel):
    component_sku: str
    component_qty: int


class BundleMappingDTO(BaseModel):
    bundle_sku: str
    items: List[BundleItemDTO]


# ──────────────────────────────────────────
# DTO 정의 (bulk rows)
# ──────────────────────────────────────────
class BulkRowDTO(BaseModel):
    sku: str
    name: str
    barcode: Optional[str] = None
    weight: Optional[float] = None
    last_inbound_price: Optional[float] = None


class BulkCreateRequest(BaseModel):
    rows: List[BulkRowDTO]


# ──────────────────────────────────────────
# 0) 핑
# ──────────────────────────────────────────
@product_register.get("/ping", response_model=PingResponse)
def ping():
    """
    상태 확인용 핑 엔드포인트
    """
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="router+db+bundle+bulk+lookup_by_sku+lookup_by_barcode+search",
    )


# ──────────────────────────────────────────
# 1) 목록 조회
# ──────────────────────────────────────────
@product_register.get("/list", response_model=ActionResponse)
async def list_items(
    svc: ProductRegisterService = Depends(get_service),
):
    try:
        result = svc.list_items()
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 1-0) 검색 조회
# ──────────────────────────────────────────
@product_register.get("/search", response_model=ActionResponse)
async def search_items(
    q: str = Query(..., description="검색어(상품명/sku 부분일치)"),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=200),
    active_only: bool = Query(default=True),
    svc: ProductRegisterService = Depends(get_service),
):
    try:
        result = svc.search_items(q=q, page=page, size=size, active_only=active_only)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 1-1) SKU 기준 단건 조회
# ──────────────────────────────────────────
@product_register.get("/lookup-by-sku", response_model=ActionResponse)
async def lookup_by_sku(
    sku: str = Query(..., description="조회할 SKU"),
    svc: ProductRegisterService = Depends(get_service),
):
    try:
        result = svc.get_by_sku(sku=sku)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 1-2) (NEW) 바코드 기준 단건 조회
# ──────────────────────────────────────────
@product_register.get("/lookup-by-barcode", response_model=ActionResponse)
async def lookup_by_barcode(
    barcode: str = Query(..., description="조회할 바코드"),
    svc: ProductRegisterService = Depends(get_service),
):
    """
    바코드 기준 상품 단건 조회
    - 예) /api/products/register/lookup-by-barcode?barcode=8809408022131
    """
    try:
        result = svc.get_by_barcode(barcode=barcode)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 2) 단건 등록
# ──────────────────────────────────────────
@product_register.post("/create", response_model=ActionResponse)
async def create_product(
    payload: ProductCreateDTO,
    svc: ProductRegisterService = Depends(get_service),
):
    try:
        result = svc.create(payload=payload.model_dump())
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 3) 단건 수정
# ──────────────────────────────────────────
@product_register.patch("/{sku}", response_model=ActionResponse)
async def update_product(
    sku: str,
    payload: ProductUpdateDTO,
    svc: ProductRegisterService = Depends(get_service),
):
    body = payload.model_dump(exclude_none=True)
    try:
        result = svc.update(sku=sku, payload=body)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 4) 다건 삭제
# ──────────────────────────────────────────
@product_register.delete("/delete", response_model=ActionResponse)
async def delete_products(
    payload: DeleteRequest,
    svc: ProductRegisterService = Depends(get_service),
):
    try:
        result = svc.delete(skus=payload.skus)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 5) 묶음 매핑
# ──────────────────────────────────────────
@product_register.post("/bundle-mapping", response_model=ActionResponse)
async def update_bundle_mapping(
    payload: BundleMappingDTO,
    svc: ProductRegisterService = Depends(get_service),
):
    try:
        result = svc.update_bundle_mapping(payload=payload.model_dump())
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 6) 상품 대량 등록
# ──────────────────────────────────────────
@product_register.post("/bulk", response_model=ActionResponse)
async def bulk_create_products(
    payload: BulkCreateRequest,
    svc: ProductRegisterService = Depends(get_service),
):
    rows = [row.model_dump() for row in payload.rows]
    try:
        result = svc.bulk_create(rows=rows)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))
