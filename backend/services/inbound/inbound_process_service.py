# 📄 backend/services/inbound/inbound_process_service.py
# 페이지: 입고 처리 — 바코드 스캔·상품확인·수량검증·바코드등록·입고확정
# 역할: 비즈니스 로직 전담 (조회, 검증, 도메인 예외, 입고확정에 따른 재고 반영)
# 단계: v5.0 (서비스 구현 / DB 스펙 v1.6-r1 기준)
#
# ✅ 이 파일이 담당하는 것
# - 바코드 스캔 → product 테이블에서 상품 찾기
# - SKU·수량 입력값 검증
# - 비활성/삭제 상품에 대한 상태 체크
# - SKU 기준 바코드 등록(매핑)
# - 입고확정(confirm) 시:
#   - inbound_header / inbound_item 상태를 draft to committed 로 변경(필드 존재 시)
#   - inventory_ledger 에 입고 이력 추가
#   - stock_current 에 재고 반영(qty_on_hand 증가)
#
# ✅ 이 파일이 절대 하지 않는 것
# - 입고전표 신규 생성(등록 탭에서의 생성)
# - 단가(unit_price)·총액(total_price) 계산
# - supplier_name(입고처) 처리
#
# 👉 전표 생성·단가·입고처·가격 관련 계산은
#    "입고 등록 / 입고 완료" 도메인 서비스에서 담당한다.

from __future__ import annotations

from typing import Any, Dict, Optional, List, Iterable, Set

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.process"
PAGE_VERSION = "v5.0"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    실제 프로젝트 모델을 반환하도록 연결.

    v5.0:
        - backend.models 에서 아래 모델들을 지연 임포트해서 사용.
          Product, InboundHeader, InboundItem, InventoryLedger, StockCurrent
    """
    try:
        from backend.models import (  # type: ignore
            Product,
            InboundHeader,
            InboundItem,
            InventoryLedger,
            StockCurrent,
        )
    except Exception as exc:  # 모델 import 자체 실패
        raise DomainError(
            "SYSTEM-DB-901",
            detail="입고 처리 서비스에서 모델을 불러오지 못했습니다.",
            ctx={"page_id": PAGE_ID, "exc": repr(exc)},
        )

    return {
        "Product": Product,
        "InboundHeader": InboundHeader,
        "InboundItem": InboundItem,
        "InventoryLedger": InventoryLedger,
        "StockCurrent": StockCurrent,
    }


def _get_session_adapter(session: Any) -> Any:
    """
    동기/비동기 세션 차이를 흡수하기 위한 어댑터.
    - 현재는 Session, AsyncSession만 허용
    """
    if isinstance(session, (Session, AsyncSession)):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


# ─────────────────────────────────────────────────────────
# 입력 검증 유틸
# ─────────────────────────────────────────────────────────
def _normalize_barcode(raw: Optional[str]) -> str:
    if raw is None:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="바코드는 필수입니다.",
            ctx={"page_id": PAGE_ID, "field": "barcode", "reason": "REQUIRED"},
        )
    barcode = raw.strip()
    if not barcode:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="바코드는 공백일 수 없습니다.",
            ctx={"page_id": PAGE_ID, "field": "barcode", "reason": "EMPTY"},
        )
    if len(barcode) > 50:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="바코드는 50자 이하만 허용됩니다.",
            ctx={"page_id": PAGE_ID, "field": "barcode", "reason": "TOO_LONG"},
        )
    return barcode


def _normalize_sku(raw: Optional[str]) -> str:
    if raw is None:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="SKU는 필수입니다.",
            ctx={"page_id": PAGE_ID, "field": "sku", "reason": "REQUIRED"},
        )
    sku = raw.strip()
    if not sku:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="SKU는 공백일 수 없습니다.",
            ctx={"page_id": PAGE_ID, "field": "sku", "reason": "EMPTY"},
        )
    if len(sku) > 50:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="SKU는 50자 이하만 허용됩니다.",
            ctx={"page_id": PAGE_ID, "field": "sku", "reason": "TOO_LONG"},
        )
    return sku


def _normalize_qty(raw: Any, *, allow_zero: bool = True) -> int:
    """
    qty 입력 검증.
    - 정수 변환 가능해야 함
    - allow_zero=False 인 경우 1 이상이어야 함
    - 수량 미입력 케이스는 UX 메시지를 위해 분리
    """
    if raw is None or (isinstance(raw, str) and raw.strip() == ""):
        raise DomainError(
            "INBOUND-VALID-001",
            detail="수량을 기입하세요.",
            ctx={"page_id": PAGE_ID, "field": "qty", "reason": "REQUIRED"},
        )

    try:
        qty = int(raw)
    except Exception:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="수량(qty)은 정수여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "qty", "reason": "NOT_INT"},
        )

    if not allow_zero and qty <= 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="입고 수량은 1 이상이어야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "qty", "reason": "NOT_POSITIVE"},
        )

    if qty < 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="수량은 음수일 수 없습니다.",
            ctx={"page_id": PAGE_ID, "field": "qty", "reason": "NEGATIVE"},
        )

    return qty


def _normalize_header_id(raw: Any) -> int:
    if raw is None:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="header_id는 필수입니다.",
            ctx={"page_id": PAGE_ID, "field": "header_id", "reason": "REQUIRED"},
        )
    try:
        header_id = int(raw)
    except Exception:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="header_id는 정수여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "header_id", "reason": "NOT_INT"},
        )
    if header_id <= 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="header_id는 1 이상이어야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "header_id", "reason": "NOT_POSITIVE"},
        )
    return header_id


def _normalize_operator(raw: Optional[str]) -> str:
    if raw is None:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="operator는 필수입니다.",
            ctx={"page_id": PAGE_ID, "field": "operator", "reason": "REQUIRED"},
        )
    op = raw.strip()
    if not op:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="operator는 공백일 수 없습니다.",
            ctx={"page_id": PAGE_ID, "field": "operator", "reason": "EMPTY"},
        )
    if len(op) > 50:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="operator는 50자 이하만 허용됩니다.",
            ctx={"page_id": PAGE_ID, "field": "operator", "reason": "TOO_LONG"},
        )
    return op


def _normalize_confirm_items(raw_items: Any) -> List[Dict[str, Any]]:
    if raw_items is None:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="items는 필수입니다.",
            ctx={"page_id": PAGE_ID, "field": "items", "reason": "REQUIRED"},
        )
    if not isinstance(raw_items, Iterable) or isinstance(raw_items, (str, bytes)):
        raise DomainError(
            "INBOUND-VALID-001",
            detail="items 형식이 올바르지 않습니다.",
            ctx={"page_id": PAGE_ID, "field": "items", "reason": "NOT_LIST"},
        )

    items: List[Dict[str, Any]] = []
    for idx, row in enumerate(raw_items):
        if not isinstance(row, dict):
            raise DomainError(
                "INBOUND-VALID-001",
                detail="items 요소는 객체 형태여야 합니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "field": "items",
                    "reason": "ITEM_NOT_OBJECT",
                    "index": idx,
                },
            )
        if "item_id" not in row:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="각 items에는 item_id가 필요합니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "field": "items.item_id",
                    "reason": "REQUIRED",
                    "index": idx,
                },
            )
        items.append(row)

    if not items:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="확정할 items가 없습니다.",
            ctx={"page_id": PAGE_ID, "field": "items", "reason": "EMPTY_LIST"},
        )

    return items


# ─────────────────────────────────────────────────────────
# 서비스 클래스 — 라우터에서 DI로 사용
# ─────────────────────────────────────────────────────────
class InboundProcessService:
    """
    입고 처리 서비스 구현체.
    - 바코드 스캔 → 상품 확인
    - SKU·수량 검증
    - SKU 기준 바코드 등록
    - 입고 확정(confirm) 시 전표 상태 변경, ledger 기록, 재고 반영
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user
        self.models = _get_models()

    # -----------------------------------------------------
    # 내부 공통 유틸: sync / async 통합
    # -----------------------------------------------------
    async def _execute(self, stmt):
        """Session/AsyncSession에 따라 execute 호출 통합."""
        if isinstance(self.session, AsyncSession):
            return await self.session.execute(stmt)
        else:
            return self.session.execute(stmt)

    async def _fetch_one(self, stmt):
        """select(...) 문장을 실행해서 scalar_one_or_none 결과를 반환."""
        result = await self._execute(stmt)
        return result.scalar_one_or_none()

    async def _commit(self) -> None:
        """세션 커밋을 sync/async 구분 없이 수행."""
        if isinstance(self.session, AsyncSession):
            await self.session.commit()
        else:
            self.session.commit()

    # -----------------------------------------------------
    # 1) 바코드 스캔
    # -----------------------------------------------------
    async def scan_barcode(self, *, barcode: str) -> Dict[str, Any]:
        """
        바코드 스캔 후 상품 식별 서비스.
        - 입력 검증
        - product 테이블 조회
        - 삭제/비활성 여부 검증
        - 화면에 표시할 상품 요약정보 반환
        """
        code = _normalize_barcode(barcode)
        Product = self.models["Product"]

        stmt = select(Product).where(Product.barcode == code)
        product = await self._fetch_one(stmt)

        if product is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="등록된 바코드를 찾을 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "barcode": code,
                    "reason": "BARCODE_NOT_FOUND",
                },
            )

        is_active = getattr(product, "is_active", True)
        deleted_at = getattr(product, "deleted_at", None)
        if not is_active or deleted_at is not None:
            raise DomainError(
                "INBOUND-STATE-451",
                detail="비활성화되었거나 삭제된 상품은 입고 처리할 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "barcode": code,
                    "sku": getattr(product, "sku", None),
                    "reason": "INACTIVE_OR_DELETED_PRODUCT",
                },
            )

        return {
            "sku": getattr(product, "sku", None),
            "barcode": getattr(product, "barcode", None),
            "name": getattr(product, "name", None),
            "brand": getattr(product, "brand", None),
            "category": getattr(product, "category", None),
            "last_inbound_unit_price": getattr(
                product, "last_inbound_unit_price", None
            ),
            "last_inbound_date": getattr(product, "last_inbound_date", None),
            "is_active": is_active,
        }

    # -----------------------------------------------------
    # 2) 바코드 등록 (SKU 기준)
    # -----------------------------------------------------
    async def register_barcode(
        self,
        *,
        barcode: str,
        sku: str,
    ) -> Dict[str, Any]:
        """
        바코드 등록 서비스.
        - 바코드/sku 검증
        - sku로 상품 조회
        - 다른 상품이 이미 사용 중인 바코드인지 검증
        - 대상 상품에 바코드 세팅 후 커밋
        """
        code = _normalize_barcode(barcode)
        norm_sku = _normalize_sku(sku)
        Product = self.models["Product"]

        stmt_sku = select(Product).where(Product.sku == norm_sku)
        product = await self._fetch_one(stmt_sku)

        if product is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="바코드를 등록할 상품(SKU)를 찾을 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "sku": norm_sku,
                    "reason": "SKU_NOT_FOUND",
                },
            )

        is_active = getattr(product, "is_active", True)
        deleted_at = getattr(product, "deleted_at", None)
        if not is_active or deleted_at is not None:
            raise DomainError(
                "INBOUND-STATE-451",
                detail="비활성화되었거나 삭제된 상품에는 바코드를 등록할 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "sku": norm_sku,
                    "reason": "INACTIVE_OR_DELETED_PRODUCT",
                },
            )

        stmt_barcode = select(Product).where(
            Product.barcode == code,
            Product.sku != norm_sku,
        )
        other = await self._fetch_one(stmt_barcode)
        if other is not None:
            raise DomainError(
                "INBOUND-STATE-452",
                detail="이미 다른 상품에 등록된 바코드입니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "barcode": code,
                    "conflict_sku": getattr(other, "sku", None),
                    "reason": "BARCODE_ALREADY_USED",
                },
            )

        current_barcode = getattr(product, "barcode", None)
        if current_barcode and current_barcode != code:
            raise DomainError(
                "INBOUND-STATE-453",
                detail="이 상품에는 이미 다른 바코드가 등록되어 있습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "sku": norm_sku,
                    "current_barcode": current_barcode,
                    "new_barcode": code,
                    "reason": "PRODUCT_ALREADY_HAS_BARCODE",
                },
            )

        if current_barcode == code:
            return {
                "sku": getattr(product, "sku", None),
                "barcode": current_barcode,
                "name": getattr(product, "name", None),
            }

        product.barcode = code
        await self._commit()

        return {
            "sku": getattr(product, "sku", None),
            "barcode": getattr(product, "barcode", None),
            "name": getattr(product, "name", None),
        }

    # -----------------------------------------------------
    # 3) 수량 설정/검증
    # -----------------------------------------------------
    async def set_qty(
        self,
        *,
        sku: str,
        qty: Any,
    ) -> Dict[str, Any]:
        """
        수량 설정용 검증 서비스.
        - SKU 유효성/존재 여부 검증
        - 수량 규칙 검증
        - DB에 수량을 반영하지 않고, 화면 상태 조정을 위한 정보만 반환
        """
        norm_sku = _normalize_sku(sku)
        norm_qty = _normalize_qty(qty, allow_zero=True)

        Product = self.models["Product"]

        stmt = select(Product).where(Product.sku == norm_sku)
        product = await self._fetch_one(stmt)

        if product is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="수량 설정 대상 SKU를 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "sku": norm_sku, "reason": "SKU_NOT_FOUND"},
            )

        is_active = getattr(product, "is_active", True)
        deleted_at = getattr(product, "deleted_at", None)
        if not is_active or deleted_at is not None:
            raise DomainError(
                "INBOUND-STATE-451",
                detail="비활성화되었거나 삭제된 상품은 입고 처리할 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "sku": norm_sku,
                    "reason": "INACTIVE_OR_DELETED_PRODUCT",
                },
            )

        return {
            "sku": getattr(product, "sku", None),
            "name": getattr(product, "name", None),
            "qty": norm_qty,
        }

    # -----------------------------------------------------
    # 4) 입고 확정(confirm)
    # -----------------------------------------------------
    async def confirm(
        self,
        *,
        header_id: Any,
        items: Any,
        operator: Optional[str],
    ) -> Dict[str, Any]:
        """
        입고 확정 서비스.

        입력:
        {
          "header_id": 1,
          "items": [
            { "item_id": 3, "sku": "EXIST-BULK-001", "qty": 3 }
          ],
          "operator": "DJ"
        }

        처리:
        1) header_id, items, operator 검증
        2) inbound_header(draft) 조회, 상태 검사
        3) items.item_id 기준으로 inbound_item 조회
        4) 상태/sku/qty 검증 후 최종 수량 사용
        5) header / item 상태 draft to committed (필드 존재 시)
        6) inventory_ledger 에 SKU별 입고 이력 기록
        7) stock_current 에 SKU별 qty_on_hand 증가
        """
        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]
        InventoryLedger = self.models["InventoryLedger"]
        StockCurrent = self.models["StockCurrent"]

        norm_header_id = _normalize_header_id(header_id)
        norm_items = _normalize_confirm_items(items)
        norm_operator = _normalize_operator(operator)

        # 1) 헤더 조회 (deleted_at NULL)
        stmt_header = select(InboundHeader).where(
            InboundHeader.id == norm_header_id,
            getattr(InboundHeader, "deleted_at", None).is_(None)
            if hasattr(InboundHeader, "deleted_at")
            else True,
        )
        header_obj = await self._fetch_one(stmt_header)

        if header_obj is None:
            raise DomainError(
                "INBOUND-CONFIRM-001",
                detail="입고전표를 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "header_id": norm_header_id},
            )

        header_status = getattr(header_obj, "status", None)
        if header_status == "committed":
            raise DomainError(
                "INBOUND-CONFIRM-002",
                detail="이미 확정된 입고전표입니다.",
                ctx={"page_id": PAGE_ID, "header_id": norm_header_id},
            )

        # 2) item_id 목록 추출
        item_ids: List[int] = []
        for row in norm_items:
            try:
                item_id = int(row.get("item_id"))
            except Exception:
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="item_id는 정수여야 합니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "field": "items.item_id",
                        "value": row.get("item_id"),
                    },
                )
            if item_id <= 0:
                raise DomainError(
                    "INBOUND-VALID-001",
                    detail="item_id는 1 이상이어야 합니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "field": "items.item_id",
                        "value": item_id,
                    },
                )
            item_ids.append(item_id)

        # 3) inbound_item 조회 (deleted_at NULL)
        stmt_items = select(InboundItem).where(
            InboundItem.id.in_(item_ids),
            getattr(InboundItem, "deleted_at", None).is_(None)
            if hasattr(InboundItem, "deleted_at")
            else True,
        )
        result_items = await self._execute(stmt_items)
        db_items: List[Any] = result_items.scalars().all()

        if len(db_items) != len(item_ids):
            found_ids: Set[int] = {getattr(x, "id") for x in db_items}
            missing = [iid for iid in item_ids if iid not in found_ids]
            raise DomainError(
                "INBOUND-CONFIRM-003",
                detail="일부 입고 아이템을 찾을 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "header_id": norm_header_id,
                    "missing_item_ids": missing,
                },
            )

        db_item_map: Dict[int, Any] = {getattr(x, "id"): x for x in db_items}

        # header_id / status 검사
        for db_item in db_items:
            item_header_id = getattr(db_item, "header_id", None)
            if item_header_id != norm_header_id:
                raise DomainError(
                    "INBOUND-CONFIRM-004",
                    detail="입고전표와 아이템의 header_id가 일치하지 않습니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "header_id": norm_header_id,
                        "item_id": getattr(db_item, "id", None),
                        "item_header_id": item_header_id,
                    },
                )
            item_status = getattr(db_item, "status", None)
            if item_status == "committed":
                raise DomainError(
                    "INBOUND-CONFIRM-005",
                    detail="이미 확정된 입고 아이템이 포함되어 있습니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "header_id": norm_header_id,
                        "item_id": getattr(db_item, "id", None),
                    },
                )

        # 4) 요청 기준 sku / qty 검증 및 집계
        total_qty = 0
        qty_by_sku: Dict[str, int] = {}

        for row in norm_items:
            item_id = int(row["item_id"])
            req_sku_raw = row.get("sku")
            req_qty_raw = row.get("qty")

            db_item = db_item_map[item_id]

            db_sku = getattr(db_item, "sku", None)
            if req_sku_raw is not None:
                norm_req_sku = _normalize_sku(str(req_sku_raw))
                if db_sku is not None and norm_req_sku != str(db_sku):
                    raise DomainError(
                        "INBOUND-CONFIRM-006",
                        detail="요청한 SKU와 전표의 SKU가 일치하지 않습니다.",
                        ctx={
                            "page_id": PAGE_ID,
                            "header_id": norm_header_id,
                            "item_id": item_id,
                            "req_sku": norm_req_sku,
                            "db_sku": db_sku,
                        },
                    )

            norm_qty = _normalize_qty(req_qty_raw, allow_zero=False)

            if hasattr(db_item, "qty"):
                db_item.qty = norm_qty

            total_qty += norm_qty

            sku_key = str(db_sku) if db_sku is not None else ""
            if not sku_key:
                raise DomainError(
                    "INBOUND-CONFIRM-007",
                    detail="입고 아이템에 SKU가 없습니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "header_id": norm_header_id,
                        "item_id": item_id,
                    },
                )
            qty_by_sku[sku_key] = qty_by_sku.get(sku_key, 0) + norm_qty

        # 5) header / item 상태를 committed 로 변경 (필드 존재 시)
        if hasattr(header_obj, "status"):
            header_obj.status = "committed"
        if hasattr(header_obj, "updated_by"):
            header_obj.updated_by = norm_operator

        for db_item in db_items:
            if hasattr(db_item, "status"):
                db_item.status = "committed"
            if hasattr(db_item, "updated_by"):
                db_item.updated_by = norm_operator

        # 6) inventory_ledger 기록 추가 (v1.6-r1 스펙)
        #    - event_type, ref_type, ref_id, qty_in, qty_out 사용
        for sku_key, qty in qty_by_sku.items():
            ledger = InventoryLedger(
                sku=sku_key,
                event_type="INBOUND",
                ref_type="INBOUND",
                ref_id=norm_header_id,
                qty_in=qty,
                qty_out=0,
            )
            if hasattr(ledger, "created_by"):
                ledger.created_by = norm_operator
            if hasattr(ledger, "updated_by"):
                ledger.updated_by = norm_operator
            self.session.add(ledger)

        # 7) stock_current 갱신 (qty_on_hand 기준)
        sku_list = list(qty_by_sku.keys())
        if sku_list:
            stmt_stock = select(StockCurrent).where(StockCurrent.sku.in_(sku_list))
            result_stock = await self._execute(stmt_stock)
            db_stock_list: List[Any] = result_stock.scalars().all()
            stock_map: Dict[str, Any] = {
                str(getattr(x, "sku")): x for x in db_stock_list
            }

            for sku_key, qty in qty_by_sku.items():
                stock_row = stock_map.get(sku_key)
                if stock_row is None:
                    stock_row = StockCurrent(
                        sku=sku_key,
                        qty_on_hand=qty,
                        qty_reserved=0,
                        qty_pending_out=0,
                    )
                    if hasattr(stock_row, "updated_by"):
                        stock_row.updated_by = norm_operator
                    self.session.add(stock_row)
                else:
                    current_qty = getattr(stock_row, "qty_on_hand", 0) or 0
                    new_qty = int(current_qty) + int(qty)
                    stock_row.qty_on_hand = new_qty
                    if hasattr(stock_row, "updated_by"):
                        stock_row.updated_by = norm_operator

        # 8) 커밋
        await self._commit()

        return {
            "header_id": norm_header_id,
            "confirmed_count": len(norm_items),
            "total_qty": total_qty,
            "operator": norm_operator,
        }
