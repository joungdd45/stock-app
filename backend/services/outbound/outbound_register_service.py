# 📄 backend/services/outbound/outbound_register_service.py
# 페이지: 출고 등록(OutboundRegisterPage) - 조회 탭
# 역할: 출고등록 목록 조회 / 선택 수정 / 선택 삭제 / 선택 엑셀(xlsx) 데이터 조회
# 단계: v2.1 (쿼리 구현, DB 스펙 v1.6-r2 반영 + header.status 필드 추가, completed 제외 필터)
#
# ✅ 서비스 원칙
# - 판단/조회/계산/검증/상태변경/트랜잭션/도메인 예외만 담당
# - HTTP 상태코드, 메시지/문구, JSON 응답 포맷, Swagger 문서화는 담당하지 않음
# - 문제 발생 시 DomainError(code, detail, ctx, stage, domain)만 던진다.

from __future__ import annotations
from typing import Optional, Dict, Any, List

from datetime import datetime

from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.register.query"
PAGE_VERSION = "v2.1"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    실제 프로젝트 모델을 반환.

    사용 모델:
    - OutboundHeader
    - OutboundItem
    - Product
    """
    try:
        from backend.models import OutboundHeader, OutboundItem, Product  # type: ignore
    except Exception as exc:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="출고등록 조회 탭 모델을 불러오지 못했습니다.",
            ctx={"page_id": PAGE_ID, "reason": "MODEL_IMPORT_FAILED", "exc": str(exc)},
            stage="service",
            domain=PAGE_ID,
        )

    return {
        "OutboundHeader": OutboundHeader,
        "OutboundItem": OutboundItem,
        "Product": Product,
    }


def _get_session_adapter(session: Any) -> Session:
    """
    Sync 세션(Session) 전용 어댑터.
    - sqlalchemy.orm.Session 타입만 허용한다.
    """
    if isinstance(session, Session):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
        stage="service",
        domain=PAGE_ID,
    )


async def _execute(session: Session, stmt):
    """
    async 서비스 메서드에서 sync Session을 공통으로 실행하기 위한 유틸.
    """
    return session.execute(stmt)


async def _commit(session: Session):
    session.commit()


# ─────────────────────────────────────────────────────────
# 서비스 클래스 — 라우터에서 DI로 주입
# ─────────────────────────────────────────────────────────
class OutboundRegisterService:
    """
    출고 등록(OutboundRegisterPage) - 조회 탭 서비스 구현체.

    라우터에서는 이 클래스를 의존성으로 주입받아 사용한다.

    예)
        svc: OutboundRegisterService = Depends(get_service)
        result = await svc.list_items(...)
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session: Session = _get_session_adapter(session)
        self.user = user or {}
        self.user_id: int = int(self.user.get("user_id", 0))

        self.models = _get_models()
        self.OutboundHeader = self.models["OutboundHeader"]
        self.OutboundItem = self.models["OutboundItem"]
        self.Product = self.models["Product"]

    # -----------------------------------------------------
    # 1) 목록 조회 — 출고등록 조회 탭 테이블 데이터
    # -----------------------------------------------------
    async def list_items(
        self,
        *,
        keyword: Optional[str],
        page: int,
        size: int,
        sort_by: Optional[str],
        sort_dir: Optional[str],
    ) -> Dict[str, Any]:
        """
        출고등록 목록 조회.

        - keyword: 국가 / 주문번호 / 트래킹번호 / SKU / 상품명 통합 검색
        - 한 행 구조:
          header_id / item_id / country / order_number / tracking_number /
          sku / product_name / qty / total_price / status
        - 페이징: page, size
        - 기본 정렬: item.id DESC (최신순)
        - completed 상태의 헤더는 목록에서 제외
        """

        # 기본 검증
        if size <= 0:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="페이지 크기는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "size": size},
                stage="service",
                domain=PAGE_ID,
            )
        if page <= 0:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="페이지 번호는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "page": page},
                stage="service",
                domain=PAGE_ID,
            )
        if keyword is not None and len(keyword) > 200:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="검색어 길이가 너무 깁니다.",
                ctx={"page_id": PAGE_ID, "max_len": 200},
                stage="service",
                domain=PAGE_ID,
            )

        OutboundHeader = self.OutboundHeader
        OutboundItem = self.OutboundItem
        Product = self.Product

        # 정렬 허용 컬럼
        allowed_sort_by = {
            "id",             # OutboundItem.id
            "country",
            "order_number",
            "tracking_number",
            "sku",
            "product_name",
            "qty",
            "total_price",    # 실제 컬럼은 sales_total
        }
        if sort_by is not None and sort_by not in allowed_sort_by:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="지원하지 않는 정렬 기준입니다.",
                ctx={"page_id": PAGE_ID, "sort_by": sort_by},
                stage="service",
                domain=PAGE_ID,
            )

        if sort_dir is not None and sort_dir not in {"asc", "desc"}:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="정렬 방향은 asc 또는 desc만 허용됩니다.",
                ctx={"page_id": PAGE_ID, "sort_dir": sort_dir},
                stage="service",
                domain=PAGE_ID,
            )

        effective_sort_by = sort_by or "id"
        effective_sort_dir = sort_dir or "desc"

        # 정렬 컬럼 매핑 (DB 컬럼 기준)
        sort_column_map = {
            "id": OutboundItem.id,
            "country": OutboundHeader.country,
            "order_number": OutboundHeader.order_number,
            "tracking_number": OutboundHeader.tracking_number,
            "sku": OutboundItem.sku,
            "product_name": Product.name,
            "qty": OutboundItem.qty,
            "total_price": OutboundItem.sales_total,
        }
        sort_col = sort_column_map[effective_sort_by]
        sort_col = sort_col.desc() if effective_sort_dir == "desc" else sort_col.asc()

        # 기본 where 조건: soft delete 제외 + completed 제외
        conditions = [
            OutboundHeader.deleted_at.is_(None),
            OutboundItem.deleted_at.is_(None),
            OutboundHeader.status != "completed",  # completed 헤더는 조회에서 제외
        ]

        # keyword 검색 — 국가 / 주문번호 / 트래킹번호 / SKU / 상품명
        if keyword:
            like_expr = f"%{keyword}%"
            conditions.append(
                or_(
                    OutboundHeader.country.ilike(like_expr),
                    OutboundHeader.order_number.ilike(like_expr),
                    OutboundHeader.tracking_number.ilike(like_expr),
                    OutboundItem.sku.ilike(like_expr),
                    Product.name.ilike(like_expr),
                )
            )

        # 총 건수 조회 (OutboundItem 기준)
        count_stmt = (
            select(func.count(OutboundItem.id))
            .join(OutboundHeader, OutboundItem.header_id == OutboundHeader.id)
            .join(Product, OutboundItem.sku == Product.sku)
            .where(*conditions)
        )
        count_result = await _execute(self.session, count_stmt)
        total_count = count_result.scalar_one()

        # 목록 조회
        stmt = (
            select(
                OutboundHeader.id.label("header_id"),
                OutboundItem.id.label("item_id"),
                OutboundHeader.country.label("country"),
                OutboundHeader.order_number.label("order_number"),
                OutboundHeader.tracking_number.label("tracking_number"),
                OutboundItem.sku.label("sku"),
                Product.name.label("product_name"),
                OutboundItem.qty.label("qty"),
                OutboundItem.sales_total.label("total_price"),
                OutboundHeader.status.label("status"),
            )
            .join(OutboundHeader, OutboundItem.header_id == OutboundHeader.id)
            .join(Product, OutboundItem.sku == Product.sku)
            .where(*conditions)
            .order_by(sort_col)
            .offset((page - 1) * size)
            .limit(size)
        )

        result = await _execute(self.session, stmt)
        rows = result.all()

        items: List[Dict[str, Any]] = []
        for row in rows:
            items.append(
                {
                    "header_id": row.header_id,
                    "item_id": row.item_id,
                    "country": row.country,
                    "order_number": row.order_number,
                    "tracking_number": row.tracking_number,
                    "sku": row.sku,
                    "product_name": row.product_name,
                    "qty": row.qty,
                    "total_price": row.total_price,
                    "status": row.status,
                }
            )

        return {
            "items": items,
            "total_count": total_count,
            "page": page,
            "size": size,
            "sort_by": effective_sort_by,
            "sort_dir": effective_sort_dir,
        }

    # -----------------------------------------------------
    # 2) 단건 수정 — 체크된 1개의 상품만 수정
    # -----------------------------------------------------
    async def update_item(
        self,
        *,
        item_id: int,
        data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        출고등록 조회 탭에서 선택한 1건에 대한 수정.

        수정 가능 필드:
        - 국가(country)             → OutboundHeader.country
        - 주문번호(order_number)    → OutboundHeader.order_number
        - 트래킹번호(tracking_number) → OutboundHeader.tracking_number
        - SKU(sku)                  → OutboundItem.sku
        - 출고수량(qty)             → OutboundItem.qty
        - 총 가격(total_price)      → OutboundItem.sales_total
        """

        if item_id <= 0:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="item_id는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "item_id": item_id},
                stage="service",
                domain=PAGE_ID,
            )

        if not isinstance(data, dict):
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="수정 데이터 형식이 올바르지 않습니다.",
                ctx={"page_id": PAGE_ID, "data_type": str(type(data))},
                stage="service",
                domain=PAGE_ID,
            )

        allowed_fields = {
            "country",
            "order_number",
            "tracking_number",
            "sku",
            "qty",
            "total_price",
        }

        unknown_fields = [k for k in data.keys() if k not in allowed_fields]
        if unknown_fields:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="지원하지 않는 수정 필드가 포함되어 있습니다.",
                ctx={"page_id": PAGE_ID, "unknown_fields": unknown_fields},
                stage="service",
                domain=PAGE_ID,
            )

        if not data:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="수정할 필드가 최소 1개 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        OutboundHeader = self.OutboundHeader
        OutboundItem = self.OutboundItem
        Product = self.Product

        # 대상 item 조회 (soft delete 제외)
        item = self.session.get(OutboundItem, item_id)
        if item is None or getattr(item, "deleted_at", None) is not None:
            raise DomainError(
                "OUTBOUND-NOTFOUND-001",
                detail="수정 대상 출고 항목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "item_id": item_id},
                stage="service",
                domain=PAGE_ID,
            )

        header_id = getattr(item, "header_id", None)
        header = self.session.get(OutboundHeader, header_id) if header_id else None
        if header is None or getattr(header, "deleted_at", None) is not None:
            raise DomainError(
                "OUTBOUND-NOTFOUND-002",
                detail="출고 헤더 정보를 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "header_id": header_id},
                stage="service",
                domain=PAGE_ID,
            )

        cleaned_data = {k: data[k] for k in allowed_fields if k in data}

        # SKU 변경 시 product 존재 여부 검증
        new_sku = cleaned_data.get("sku")
        if new_sku:
            stmt_sku = select(Product).where(Product.sku == new_sku)
            sku_result = await _execute(self.session, stmt_sku)
            product_obj = sku_result.scalar_one_or_none()
            if product_obj is None:
                raise DomainError(
                    "OUTBOUND-VALID-002",
                    detail="해당 SKU에 매핑된 상품을 찾을 수 없습니다.",
                    ctx={"page_id": PAGE_ID, "sku": new_sku},
                    stage="service",
                    domain=PAGE_ID,
                )

        # header 필드 업데이트
        if "country" in cleaned_data:
            header.country = cleaned_data["country"]  # type: ignore[attr-defined]
        if "order_number" in cleaned_data:
            header.order_number = cleaned_data["order_number"]  # type: ignore[attr-defined]
        if "tracking_number" in cleaned_data:
            header.tracking_number = cleaned_data["tracking_number"]  # type: ignore[attr-defined]

        # item 필드 업데이트
        if "sku" in cleaned_data:
            item.sku = cleaned_data["sku"]  # type: ignore[attr-defined]
        if "qty" in cleaned_data:
            item.qty = cleaned_data["qty"]  # type: ignore[attr-defined]
        if "total_price" in cleaned_data:
            # DB 컬럼은 sales_total
            item.sales_total = cleaned_data["total_price"]  # type: ignore[attr-defined]

        await _commit(self.session)

        return {
            "item_id": item_id,
            "header_id": header_id,
            "updated_fields": cleaned_data,
        }

    # -----------------------------------------------------
    # 3) 다건 삭제 — 체크된 여러 상품 논리 삭제
    # -----------------------------------------------------
    async def delete_items(
        self,
        *,
        ids: List[int],
    ) -> Dict[str, Any]:
        """
        출고등록 조회 탭에서 선택한 다건 삭제.

        - ids: outbound_item.id 리스트
        - 삭제 방식: 논리 삭제(soft delete), 물리 삭제 금지
        """

        if not isinstance(ids, list):
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="ids는 리스트여야 합니다.",
                ctx={"page_id": PAGE_ID, "ids_type": str(type(ids))},
                stage="service",
                domain=PAGE_ID,
            )

        if len(ids) == 0:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="삭제할 ID가 최소 1개 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        if not all(isinstance(x, int) and x > 0 for x in ids):
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="ids에는 1 이상 정수만 포함되어야 합니다.",
                ctx={"page_id": PAGE_ID, "ids": ids},
                stage="service",
                domain=PAGE_ID,
            )

        OutboundItem = self.OutboundItem

        stmt = select(OutboundItem).where(
            OutboundItem.id.in_(ids),
            OutboundItem.deleted_at.is_(None),
        )
        result = await _execute(self.session, stmt)
        items = result.scalars().all()

        if not items:
            raise DomainError(
                "OUTBOUND-NOTFOUND-003",
                detail="삭제할 출고 항목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "ids": ids},
                stage="service",
                domain=PAGE_ID,
            )

        deleted_ids: List[int] = []
        now = datetime.utcnow()

        for item in items:
            item.deleted_at = now  # type: ignore[attr-defined]
            deleted_ids.append(item.id)  # type: ignore[attr-defined]

        await _commit(self.session)

        return {
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
        }

    # -----------------------------------------------------
    # 4) 선택 엑셀(xlsx)용 데이터 조회 — 체크된 행만 대상
    # -----------------------------------------------------
    async def export_items_xlsx(
        self,
        *,
        ids: List[int],
    ) -> Dict[str, Any]:
        """
        출고등록 조회 탭에서 체크된 행만 엑셀(xlsx)로 다운로드하기 위한 데이터 조회.

        - ids: outbound_item.id 리스트
        - 엑셀 컬럼 순서:
          국가 / 주문번호 / 트래킹번호 / SKU / 상품명 / 출고수량 / 총 가격
        - 실제 xlsx 생성은 상위 레이어에서 담당.
        """

        if not isinstance(ids, list):
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="ids는 리스트여야 합니다.",
                ctx={"page_id": PAGE_ID, "ids_type": str(type(ids))},
                stage="service",
                domain=PAGE_ID,
            )

        if len(ids) == 0:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="엑셀로 내려받을 ID가 최소 1개 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        if not all(isinstance(x, int) and x > 0 for x in ids):
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="ids에는 1 이상 정수만 포함되어야 합니다.",
                ctx={"page_id": PAGE_ID, "ids": ids},
                stage="service",
                domain=PAGE_ID,
            )

        OutboundHeader = self.OutboundHeader
        OutboundItem = self.OutboundItem
        Product = self.Product

        stmt = (
            select(
                OutboundHeader.id.label("header_id"),
                OutboundItem.id.label("item_id"),
                OutboundHeader.country.label("country"),
                OutboundHeader.order_number.label("order_number"),
                OutboundHeader.tracking_number.label("tracking_number"),
                OutboundItem.sku.label("sku"),
                Product.name.label("product_name"),
                OutboundItem.qty.label("qty"),
                OutboundItem.sales_total.label("total_price"),
                OutboundHeader.status.label("status"),
            )
            .join(OutboundHeader, OutboundItem.header_id == OutboundHeader.id)
            .join(Product, OutboundItem.sku == Product.sku)
            .where(
                OutboundItem.id.in_(ids),
                OutboundHeader.deleted_at.is_(None),
                OutboundItem.deleted_at.is_(None),
            )
            .order_by(OutboundItem.id.asc())
        )

        result = await _execute(self.session, stmt)
        rows = result.all()

        if not rows:
            raise DomainError(
                "OUTBOUND-NOTFOUND-004",
                detail="엑셀로 내보낼 출고 항목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "ids": ids},
                stage="service",
                domain=PAGE_ID,
            )

        export_rows: List[Dict[str, Any]] = []
        for row in rows:
            export_rows.append(
                {
                    "country": row.country,
                    "order_number": row.order_number,
                    "tracking_number": row.tracking_number,
                    "sku": row.sku,
                    "product_name": row.product_name,
                    "qty": row.qty,
                    "total_price": row.total_price,
                    "status": row.status,
                    "header_id": row.header_id,
                    "item_id": row.item_id,
                }
            )

        return {
            "format": "xlsx",
            "count": len(export_rows),
            "rows": export_rows,
        }
