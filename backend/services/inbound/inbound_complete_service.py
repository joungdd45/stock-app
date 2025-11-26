# 📄 backend/services/inbound/inbound_complete_service.py
# 페이지: 입고 완료(InboundCompletePage)
# 역할: 입고완료(확정) 품목 단위 목록 조회 / 수정 / 삭제 / xlsx 다운로드 비즈니스 로직
# 단계: v3.2 (조회 + 단건 수정 + 다건 삭제 + xlsx 생성)
#
# PAGE_ID: inbound.complete
# 규칙:
#   - 판단/조회/계산/검증/상태변경/트랜잭션/도메인 예외만 담당
#   - HTTP 상태코드, 응답 포맷, Swagger 문서는 라우터에서 담당
#   - 문제 발생 시 DomainError(code, detail, ctx, ...)만 던진다.

from __future__ import annotations

from datetime import datetime, date
from decimal import Decimal, InvalidOperation
from io import BytesIO
from typing import Optional, Dict, Any, List, Tuple

from sqlalchemy import select, func, or_
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────────────────────
PAGE_ID = "inbound.complete"
PAGE_VERSION = "v3.2"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    실제 프로젝트 모델을 반환하도록 연결.

    사용 모델:
      - InboundHeader
      - InboundItem
      - Product
    """
    try:
        from backend.models import InboundHeader, InboundItem, Product  # type: ignore
    except Exception as exc:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="입고완료 서비스에서 모델을 불러오지 못했습니다.",
            ctx={"page_id": PAGE_ID, "exc": repr(exc)},
        )

    return {
        "InboundHeader": InboundHeader,
        "InboundItem": InboundItem,
        "Product": Product,
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


def _parse_date(label: str, value: Optional[str]) -> Optional[date]:
    """
    YYYY-MM-DD 형식의 문자열을 date로 파싱.
    - value가 None이면 그대로 None
    - 형식이 잘못되면 DomainError(INBOUND-VALID-001)
    """
    if value is None:
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{label} 형식이 올바르지 않습니다. YYYY-MM-DD 형식이어야 합니다.",
            ctx={"page_id": PAGE_ID, "value": value, "field": label},
        )


def _normalize_id(raw: Any, *, field: str) -> int:
    try:
        value = int(raw)
    except Exception:
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field}는 정수여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": field, "reason": "NOT_INT"},
        )
    if value <= 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field}는 1 이상이어야 합니다.",
            ctx={"page_id": PAGE_ID, "field": field, "reason": "NOT_POSITIVE"},
        )
    return value


def _normalize_qty(raw: Any) -> int:
    """
    수정용 수량 검증.
    - 정수
    - 1 이상
    """
    try:
        qty = int(raw)
    except Exception:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="수량(qty)은 정수여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "qty", "reason": "NOT_INT"},
        )

    if qty <= 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="입고 수량은 1 이상이어야 합니다.",
            ctx={"page_id": PAGE_ID, "field": "qty", "reason": "NOT_POSITIVE"},
        )

    return qty


def _normalize_price(raw: Any, *, field: str) -> Decimal:
    """
    단가/금액 숫자 검증.
    - Decimal로 변환
    - 0 이상
    """
    try:
        value = Decimal(str(raw))
    except (InvalidOperation, ValueError):
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field}는 숫자여야 합니다.",
            ctx={"page_id": PAGE_ID, "field": field, "reason": "NOT_NUMBER"},
        )

    if value < 0:
        raise DomainError(
            "INBOUND-VALID-001",
            detail=f"{field}는 0 이상이어야 합니다.",
            ctx={"page_id": PAGE_ID, "field": field, "reason": "NEGATIVE"},
        )

    return value


def _normalize_supplier_name(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    name = raw.strip()
    if not name:
        return None
    if len(name) > 100:
        raise DomainError(
            "INBOUND-VALID-001",
            detail="입고처는 100자 이하만 허용됩니다.",
            ctx={"page_id": PAGE_ID, "field": "supplier_name", "reason": "TOO_LONG"},
        )
    return name


# ─────────────────────────────────────────────────────────
# 서비스 클래스 — 라우터에서 DI로 주입
# ─────────────────────────────────────────────────────────
class InboundCompleteService:
    """
    입고 완료(InboundCompletePage) 서비스 구현체.

    기능:
      - list_items: 입고완료 품목 목록 조회
      - update_item: 단건 수정 (입고일/수량/단가/입고처)
      - delete_items: 품목 단위 soft delete
      - export_xlsx: 선택 품목 xlsx 생성
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user
        self.models = _get_models()

    # -----------------------------------------------------
    # 내부 공통 유틸: sync / async 통합 execute/commit
    # -----------------------------------------------------
    async def _execute(self, stmt):
        if isinstance(self.session, AsyncSession):
            return await self.session.execute(stmt)
        return self.session.execute(stmt)

    async def _commit(self) -> None:
        if isinstance(self.session, AsyncSession):
            await self.session.commit()
        else:
            self.session.commit()

    # -----------------------------------------------------
    # 1) 입고완료 목록 조회 — list_items
    # -----------------------------------------------------
    async def list_items(
        self,
        *,
        start_date: Optional[str],
        end_date: Optional[str],
        keyword: Optional[str],
        page: int,
        size: int,
    ) -> Dict[str, Any]:
        """
        입고완료 목록 조회.

        대상:
            - inbound_header.status = 'committed'
            - inbound_header.deleted_at IS NULL
            - inbound_item.deleted_at IS NULL
            - product.deleted_at IS NULL
        """

        # 페이지/사이즈 검증
        if page <= 0:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="페이지 번호는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "page": page},
            )
        if size <= 0 or size > 200:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="페이지 크기는 1 이상 200 이하이어야 합니다.",
                ctx={"page_id": PAGE_ID, "size": size},
            )

        # 검색어 길이 검증
        if keyword is not None and len(keyword) > 200:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="검색어 길이가 너무 깁니다.",
                ctx={"page_id": PAGE_ID, "max_len": 200},
            )

        # 날짜 파싱 및 범위 검증
        start_dt = _parse_date("start_date", start_date) if start_date else None
        end_dt = _parse_date("end_date", end_date) if end_date else None

        if start_dt and end_dt and start_dt > end_dt:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="시작일은 종료일보다 이후일 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "start_date": start_dt.isoformat(),
                    "end_date": end_dt.isoformat(),
                },
            )

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]
        Product = self.models["Product"]

        # 기본 필터: 상태 + soft delete
        filters = [
            InboundHeader.status == "committed",
            InboundHeader.deleted_at.is_(None),
            InboundItem.deleted_at.is_(None),
            Product.deleted_at.is_(None),
        ]

        # 날짜 필터
        if start_dt is not None:
            filters.append(InboundHeader.inbound_date >= start_dt)
        if end_dt is not None:
            filters.append(InboundHeader.inbound_date <= end_dt)

        # 키워드 필터 (SKU 또는 상품명)
        if keyword:
            kw = f"%{keyword.strip()}%"
            filters.append(
                or_(
                    InboundItem.sku.ilike(kw),
                    Product.name.ilike(kw),
                )
            )

        # 카운트 쿼리
        count_stmt = (
            select(func.count())
            .select_from(InboundItem)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .where(*filters)
        )
        count_result = await self._execute(count_stmt)
        total_count = count_result.scalar_one() or 0

        # 목록 쿼리
        stmt = (
            select(
                InboundItem.id,
                InboundHeader.inbound_date,
                InboundItem.sku,
                Product.name,
                InboundItem.qty,
                InboundItem.total_price,
                InboundItem.unit_price,
                InboundHeader.supplier_name,
            )
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .where(*filters)
            .order_by(
                InboundHeader.inbound_date.desc(),
                InboundItem.sku.asc(),
                Product.name.asc(),
            )
            .offset((page - 1) * size)
            .limit(size)
        )

        result = await self._execute(stmt)
        rows: List[Dict[str, Any]] = []

        for (
            item_id,
            inbound_date_value,
            sku,
            product_name,
            qty,
            total_price,
            unit_price,
            supplier_name,
        ) in result.all():
            # inbound_date_value가 date 또는 datetime 일 수 있으므로 통일
            if isinstance(inbound_date_value, datetime):
                inbound_date_str = inbound_date_value.date().isoformat()
            elif isinstance(inbound_date_value, date):
                inbound_date_str = inbound_date_value.isoformat()
            else:
                inbound_date_str = (
                    str(inbound_date_value) if inbound_date_value is not None else None
                )

            rows.append(
                {
                    "item_id": item_id,
                    "inbound_date": inbound_date_str,
                    "sku": sku,
                    "product_name": product_name,
                    "qty": qty,
                    "total_price": total_price,
                    "unit_price": unit_price,
                    "supplier_name": supplier_name,
                }
            )

        return {
            "items": rows,
            "count": total_count,
            "page": page,
            "size": size,
        }

    # -----------------------------------------------------
    # 2) 단건 수정 — update_item
    # -----------------------------------------------------
    async def update_item(
        self,
        *,
        item_id: int,
        qty: Optional[Any],
        total_price: Optional[Any],
        unit_price: Optional[Any],  # 요청에는 있으나, 실제로는 재계산용
        inbound_date: Optional[str],
        supplier_name: Optional[str],
    ) -> Dict[str, Any]:
        """
        입고완료 품목 단건 수정.

        - 대상: inbound_header.status = 'committed' 이고 soft delete 되지 않은 품목
        - 수정 가능 항목:
            * inbound_date (입고일, header)
            * qty (입고 수량, item)
            * total_price (총 단가, item)
            * unit_price (개당 단가, item) → 서버에서 total_price / qty 로 재계산
            * supplier_name (입고처, header)
        - total_price는 프론트에서 항상 보내는 것으로 전제,
          누락 시 에러 처리 (방어적 fallback 없음)
        """
        norm_id = _normalize_id(item_id, field="item_id")

        # 수정할 값이 아무것도 없으면 에러
        if (
            qty is None
            and total_price is None
            and inbound_date is None
            and supplier_name is None
        ):
            raise DomainError(
                "INBOUND-VALID-001",
                detail="수정할 값이 없습니다.",
                ctx={"page_id": PAGE_ID, "item_id": norm_id},
            )

        # total_price는 무조건 들어온다는 전제를 그대로 반영
        if total_price is None:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="총 단가(total_price)는 필수입니다.",
                ctx={"page_id": PAGE_ID, "item_id": norm_id, "field": "total_price"},
            )

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]

        # 대상 품목 + 헤더 조회
        stmt = (
            select(InboundItem, InboundHeader)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .where(
                InboundItem.id == norm_id,
                InboundItem.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
                InboundHeader.status == "committed",
            )
        )
        result = await self._execute(stmt)
        row = result.first()

        if row is None:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="수정 대상 입고완료 품목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "item_id": norm_id},
            )

        item: Any = row[0]
        header: Any = row[1]

        # 현재 값
        current_qty = item.qty
        current_inbound_date = header.inbound_date
        current_supplier_name = header.supplier_name

        # 새 값 계산
        new_qty = _normalize_qty(qty) if qty is not None else current_qty
        new_total_price = _normalize_price(total_price, field="total_price")
        # 개당 단가는 총단가 / 수량으로 재계산
        if new_qty <= 0:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="입고 수량은 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "item_id": norm_id, "qty": new_qty},
            )
        new_unit_price = new_total_price / new_qty

        new_inbound_date = (
            _parse_date("inbound_date", inbound_date)
            if inbound_date is not None
            else current_inbound_date
        )
        new_supplier_name = (
            _normalize_supplier_name(supplier_name) or current_supplier_name
        )

        # 실제 반영
        item.qty = new_qty
        item.total_price = new_total_price
        item.unit_price = new_unit_price
        header.inbound_date = new_inbound_date
        header.supplier_name = new_supplier_name

        # TODO: updated_by 등 감사로그 필드가 있으면 여기서 기록
        await self._commit()

        # 응답용 inbound_date 문자열 변환
        if isinstance(header.inbound_date, datetime):
            inbound_date_str = header.inbound_date.date().isoformat()
        elif isinstance(header.inbound_date, date):
            inbound_date_str = header.inbound_date.isoformat()
        else:
            inbound_date_str = (
                str(header.inbound_date) if header.inbound_date is not None else None
            )

        return {
            "item_id": item.id,
            "inbound_date": inbound_date_str,
            "qty": item.qty,
            "total_price": item.total_price,
            "unit_price": item.unit_price,
            "supplier_name": header.supplier_name,
        }

    # -----------------------------------------------------
    # 3) 다건 삭제 — delete_items (soft delete)
    # -----------------------------------------------------
    async def delete_items(self, *, item_ids: List[int]) -> Dict[str, Any]:
        """
        입고완료 품목 다건 삭제 (soft delete).
        - 대상: inbound_header.status = 'committed' 이고 아직 삭제되지 않은 품목
        - 처리: inbound_item.deleted_at = 현재 UTC 시각
        - ledger/stock_current 롤백은 아직 담당하지 않음 (TODO)
        """
        if not item_ids:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="삭제할 대상이 없습니다.",
                ctx={"page_id": PAGE_ID},
            )

        norm_ids = [_normalize_id(i, field="item_id") for i in item_ids]

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]

        stmt = (
            select(InboundItem, InboundHeader)
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .where(
                InboundItem.id.in_(norm_ids),
                InboundItem.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
                InboundHeader.status == "committed",
            )
        )

        result = await self._execute(stmt)
        rows = result.all()

        if not rows:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="삭제 대상 입고완료 품목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "item_ids": norm_ids},
            )

        now = datetime.utcnow()
        deleted_ids: List[int] = []

        for item, _header in rows:
            item.deleted_at = now
            deleted_ids.append(item.id)

        await self._commit()

        return {
            "deleted_count": len(deleted_ids),
            "deleted_ids": deleted_ids,
        }

    # -----------------------------------------------------
    # 4) xlsx 다운로드 — export_xlsx
    # -----------------------------------------------------
    async def export_xlsx(self, *, item_ids: List[int]) -> Tuple[BytesIO, str]:
        """
        입고완료 품목 선택 xlsx 생성.
        - 대상: 전달받은 inbound_item.id 목록
        - 필터: status=committed, soft delete 아닌 것만
        - 컬럼:
            입고일 / SKU / 상품명 / 입고 수량 / 총 단가 / 개당 단가 / 입고처
        """
        if not item_ids:
            raise DomainError(
                "INBOUND-VALID-001",
                detail="엑셀로 내보낼 대상이 없습니다.",
                ctx={"page_id": PAGE_ID},
            )

        norm_ids = [_normalize_id(i, field="item_id") for i in item_ids]

        InboundHeader = self.models["InboundHeader"]
        InboundItem = self.models["InboundItem"]
        Product = self.models["Product"]

        stmt = (
            select(
                InboundItem.id,
                InboundHeader.inbound_date,
                InboundItem.sku,
                Product.name,
                InboundItem.qty,
                InboundItem.total_price,
                InboundItem.unit_price,
                InboundHeader.supplier_name,
            )
            .join(InboundHeader, InboundItem.header_id == InboundHeader.id)
            .join(Product, InboundItem.sku == Product.sku)
            .where(
                InboundItem.id.in_(norm_ids),
                InboundItem.deleted_at.is_(None),
                InboundHeader.deleted_at.is_(None),
                Product.deleted_at.is_(None),
                InboundHeader.status == "committed",
            )
            .order_by(
                InboundHeader.inbound_date.desc(),
                InboundItem.sku.asc(),
                Product.name.asc(),
            )
        )

        result = await self._execute(stmt)
        rows = result.all()

        if not rows:
            raise DomainError(
                "INBOUND-NOTFOUND-101",
                detail="엑셀로 내보낼 입고완료 품목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "item_ids": norm_ids},
            )

        # openpyxl 로드
        try:
            from openpyxl import Workbook  # type: ignore
        except Exception as exc:
            raise DomainError(
                "SYSTEM-EXPORT-901",
                detail="엑셀(xlsx) 생성 모듈을 사용할 수 없습니다.",
                ctx={"page_id": PAGE_ID, "exc": repr(exc)},
            )

        wb = Workbook()
        ws = wb.active
        ws.title = "입고완료"

        # 헤더 행
        headers = [
            "입고일",
            "SKU",
            "상품명",
            "입고 수량",
            "총 단가",
            "개당 단가",
            "입고처",
        ]
        ws.append(headers)

        # 데이터 행
        for (
            _item_id,
            inbound_date_value,
            sku,
            product_name,
            qty,
            total_price,
            unit_price,
            supplier_name,
        ) in rows:
            if isinstance(inbound_date_value, datetime):
                inbound_date_str = inbound_date_value.date().isoformat()
            elif isinstance(inbound_date_value, date):
                inbound_date_str = inbound_date_value.isoformat()
            else:
                inbound_date_str = (
                    str(inbound_date_value) if inbound_date_value is not None else ""
                )

            def to_number(val: Any) -> Any:
                if isinstance(val, Decimal):
                    return float(val)
                return val

            ws.append(
                [
                    inbound_date_str,
                    sku,
                    product_name,
                    qty,
                    to_number(total_price),
                    to_number(unit_price),
                    supplier_name,
                ]
            )

        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)

        today_str = datetime.utcnow().strftime("%Y%m%d")
        filename = f"inbound-complete-{today_str}.xlsx"

        return buf, filename
