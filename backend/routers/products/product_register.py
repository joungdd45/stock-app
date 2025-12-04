# 📄 backend/routers/products/product_register.py
# 페이지: 상품관리 — 상품 등록(CreatePage.tsx)
# 역할: 요청 → 가드 → DTO파싱 → 서비스 호출 → 응답
# 단계: v1-7 (등록/조회/수정/삭제 + 묶음매핑 + bulk rows + DB v1.6-r2 대응 + SKU 단건조회)
#
# ✅ 라우터 원칙
# - 비즈니스 로직 없음(계산/검증/트랜잭션 금지)
# - 서비스 호출 + 응답래핑 + 문서화만 담당
# - 에러는 DomainError 그대로 던지고 전역 핸들러에서 처리
#
# ✅ v1-6 변경 요약 (DB 스펙 v1.6-r2 반영)
# - DB product 테이블에 base_sku / pack_qty 추가
# - 라우터는 스펙을 노출하지 않고, 서비스에서 기본값 처리:
#   - 신규 상품: base_sku = sku, pack_qty = 1, is_bundle = false 로 등록
#
# ✅ v1-7 변경 요약
# - SKU 기준 단건 조회 엔드포인트 추가 (/lookup-by-sku)
#   - 입고/출고/모바일 등에서 SKU만으로 상품명/단가 조회 용도

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
PAGE_VERSION = "v1-7"

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
    - 서비스는 sync Session 전용(v1-6)
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
    """
    상품 단건 등록용 DTO

    - 화면 입력 필드:
      - sku
      - name
      - last_inbound_price (프론트 필드명 기준)
      - weight (옵션)
      - barcode (옵션)

    - DB v1.6-r2 추가 필드(base_sku, pack_qty)는
      서비스(ProductRegisterService)에서 기본값 처리:
      - base_sku = sku
      - pack_qty = 1
    """
    sku: str
    name: str
    # 화면 스펙: last_inbound_price
    # 서비스에서 last_inbound_unit_price 컬럼으로 매핑
    last_inbound_price: float = 0
    weight: Optional[float] = None
    barcode: Optional[str] = None


class ProductUpdateDTO(BaseModel):
    """
    상품 수정용 DTO
    - sku는 path로 고정
    - name / last_inbound_price / weight / barcode 는 선택 수정
    - base_sku / pack_qty / is_bundle 은 v1-6에서는 별도 화면 없이
      서비스 내부 정책으로만 제어
    """
    name: Optional[str] = None
    last_inbound_price: Optional[float] = None
    weight: Optional[float] = None
    barcode: Optional[str] = None


class DeleteRequest(BaseModel):
    """
    상품 다건 삭제 요청 DTO
    - skus: 삭제 대상 SKU 목록
    """
    skus: List[str]


# ──────────────────────────────────────────
# DTO 정의 (묶음 매핑)
# ──────────────────────────────────────────
class BundleItemDTO(BaseModel):
    """
    묶음 구성상품 DTO
    - component_sku: 구성품 SKU
    - component_qty: 포함 개수
    """
    component_sku: str
    component_qty: int


class BundleMappingDTO(BaseModel):
    """
    묶음 매핑 DTO
    - bundle_sku: 묶음 SKU
    - items: 구성상품 목록
    """
    bundle_sku: str
    items: List[BundleItemDTO]


# ──────────────────────────────────────────
# DTO 정의 (bulk rows)
# ──────────────────────────────────────────
class BulkRowDTO(BaseModel):
    """
    대량등록 한 행(row) DTO
    - sku, name: 필수
    - barcode, weight, last_inbound_price: 옵션
    - base_sku / pack_qty는 단건등록과 동일하게
      서비스에서 기본값으로 처리
    """
    sku: str
    name: str
    barcode: Optional[str] = None
    weight: Optional[float] = None
    # 프론트 기준 필드명: last_inbound_price
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
    - stage:
      - router+db+bundle+bulk+base_sku/pack+lookup_by_sku
    """
    return PingResponse(
        ok=True,
        page=PAGE_ID,
        version=PAGE_VERSION,
        stage="router+db+bundle+bulk+base_sku/pack+lookup_by_sku",
    )


# ──────────────────────────────────────────
# 1) 목록 조회  → svc.list_items
# ──────────────────────────────────────────
@product_register.get("/list", response_model=ActionResponse)
async def list_items(
    q: Optional[str] = Query(
        default=None,
        description="상품명 검색어(현재 v1-6에서는 미사용, 시그니처 유지용)",
    ),
    page: int = Query(
        default=1,
        ge=1,
        description="페이지 번호(현재 v1-6에서는 미사용, 시그니처 유지용)",
    ),
    size: int = Query(
        default=100,
        ge=1,
        description="페이지 크기(현재 v1-6에서는 미사용, 시그니처 유지용)",
    ),
    svc: ProductRegisterService = Depends(get_service),
):
    """
    상품 목록 조회
    - v1-6: 전체 리스트 조회만 지원, q/page/size는 시그니처 유지용
    """
    try:
        result = svc.list_items()
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 1-1) SKU 단건 조회  → svc.get_by_sku
# ──────────────────────────────────────────
@product_register.get("/lookup-by-sku", response_model=ActionResponse)
async def lookup_by_sku(
    sku: str = Query(..., description="조회할 SKU"),
    svc: ProductRegisterService = Depends(get_service),
):
    """
    SKU 기준 상품 단건 조회
    - 입고/출고/모바일 등에서 SKU만으로 상품명/단가 조회 용도
    - 예) /api/products/register/lookup-by-sku?sku=NO-BARCODE-001
    """
    try:
        result = svc.get_by_sku(sku=sku)
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 2) 단건 등록  → svc.create
# ──────────────────────────────────────────
@product_register.post("/create", response_model=ActionResponse)
async def create_product(
    payload: ProductCreateDTO,
    svc: ProductRegisterService = Depends(get_service),
):
    """
    상품 단건 등록
    - 입력 필드: sku, name, last_inbound_price, (옵션) weight, barcode
    - DB v1.6-r2:
      - base_sku / pack_qty / is_bundle 는 서비스에서 기본값 처리
    """
    try:
        result = svc.create(payload=payload.model_dump())
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 3) 단건 수정  → svc.update
# ──────────────────────────────────────────
@product_register.patch("/{sku}", response_model=ActionResponse)
async def update_product(
    sku: str,
    payload: ProductUpdateDTO,
    svc: ProductRegisterService = Depends(get_service),
):
    """
    상품 단건 수정
    - sku는 path로 고정
    - body에 들어온 필드만 부분 수정
    - base_sku / pack_qty / is_bundle 은 v1-6 기준 별도 화면 없이
      서비스 내부 정책으로만 변경
    """
    body = payload.model_dump(exclude_none=True)

    try:
        result = svc.update(sku=sku, payload=body)
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 4) 다건 삭제  → svc.delete
# ──────────────────────────────────────────
@product_register.delete("/delete", response_model=ActionResponse)
async def delete_products(
    payload: DeleteRequest,
    svc: ProductRegisterService = Depends(get_service),
):
    """
    상품 다건 삭제
    - skus 배열로 삭제 요청
    """
    try:
        result = svc.delete(skus=payload.skus)
    except DomainError as exc:
        raise exc
    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 5) 묶음 매핑 단건 업데이트  → svc.update_bundle_mapping
# ──────────────────────────────────────────
@product_register.post("/bundle-mapping", response_model=ActionResponse)
async def update_bundle_mapping(
    payload: BundleMappingDTO,
    svc: ProductRegisterService = Depends(get_service),
):
    """
    묶음 매핑 단건 업데이트
    - bundle_sku 기준 기존 매핑 논리삭제 후, 신규 items 전체 재삽입
    - product_bundle_item + product.base_sku / pack_qty 는
      서비스 레벨에서 일관성 유지
    """
    body = payload.model_dump()

    try:
        result = svc.update_bundle_mapping(payload=body)
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))


# ──────────────────────────────────────────
# 6) 상품 대량 등록(bulk rows)  → svc.bulk_create
# ──────────────────────────────────────────
@product_register.post("/bulk", response_model=ActionResponse)
async def bulk_create_products(
    payload: BulkCreateRequest,
    svc: ProductRegisterService = Depends(get_service),
):
    """
    상품 대량 등록
    - 프론트에서 엑셀 파싱 후 rows 배열(JSON) 전달
    - 각 row는 개별 검증, 기존 SKU는 스킵
    - base_sku / pack_qty / is_bundle 은 단건등록과 동일하게
      서비스에서 기본값으로 처리
    """
    rows = [row.model_dump() for row in payload.rows]

    try:
        result = svc.bulk_create(rows=rows)
    except DomainError as exc:
        raise exc

    return ActionResponse(ok=True, data=ActionData(result=result))
