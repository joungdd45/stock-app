# 📄 backend/services/stock/stock_history_service.py
# 페이지: 재고 이력(HistoryPage)
# 역할: 비즈니스 로직 전담 (조회, 검증, 계산, 엑셀 내보내기)
# 단계: v2.1 (Users 제거 대응)
# PAGE_ID: stock.history
# PAGE_VERSION: v2.1

from __future__ import annotations

import base64
from io import BytesIO
from typing import Optional, Dict, Any, List
from datetime import datetime, date

from sqlalchemy import select, and_, or_, desc, func
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from backend.system.error_codes import DomainError

PAGE_ID = "stock.history"
PAGE_VERSION = "v2.1"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    try:
        from backend.models import (  # type: ignore
            InventoryLedger,
            Product,
            StockCurrent,
        )
    except Exception as exc:
        raise DomainError(
            "SYSTEM-DB-901",
            detail="재고이력 ORM 모델을 로드할 수 없습니다.",
            ctx={"page_id": PAGE_ID, "exc": repr(exc)},
        )

    return {
        "InventoryLedger": InventoryLedger,
        "Product": Product,
        "StockCurrent": StockCurrent,
    }


def _get_session_adapter(session: Any) -> Any:
    if isinstance(session, (Session, AsyncSession)):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


class StockHistoryService:
    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user
        self.models = _get_models()

    @property
    def _is_async(self) -> bool:
        return isinstance(self.session, AsyncSession)

    async def _exec(self, stmt):
        if self._is_async:
            return await self.session.execute(stmt)  # type: ignore
        return self.session.execute(stmt)

    def _parse_date(self, value: Optional[str], field: str) -> Optional[date]:
        if not value:
            return None
        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except Exception:
            raise DomainError(
                "STOCK-VALID-001",
                detail=f"{field} 날짜 형식이 잘못되었습니다.",
                ctx={"value": value},
            )

    # ─────────────────────────────────────
    # 1) 재고 이력 조회
    # ─────────────────────────────────────
    async def list_items(
        self,
        *,
        from_date: Optional[str],
        to_date: Optional[str],
        sku: Optional[str],
        keyword: Optional[str],
        page: int,
        size: int,
    ) -> Dict[str, Any]:

        if page <= 0:
            raise DomainError(
                "STOCK-VALID-001",
                detail="page는 1 이상이어야 합니다.",
                ctx={"page": page},
            )

        if size <= 0:
            raise DomainError(
                "STOCK-VALID-001",
                detail="size는 1 이상이어야 합니다.",
                ctx={"size": size},
            )

        date_from = self._parse_date(from_date, "from_date")
        date_to = self._parse_date(to_date, "to_date")

        L = self.models["InventoryLedger"]
        P = self.models["Product"]
        S = self.models["StockCurrent"]

        # 🔹 묶음 SKU는 재고이력에서 숨긴다
        conditions = [
            or_(P.is_bundle.is_(None), P.is_bundle == False)
        ]

        if date_from:
            conditions.append(L.created_at >= date_from)
        if date_to:
            conditions.append(L.created_at <= date_to)
        if sku:
            conditions.append(L.sku == sku)
        if keyword:
            conditions.append(
                or_(
                    L.sku == keyword,
                    P.name.ilike(f"%{keyword}%"),
                )
            )

        where_clause = and_(*conditions) if conditions else None

        # 총 개수 조회
        count_stmt = select(func.count()).select_from(L).join(P, L.sku == P.sku)
        if where_clause is not None:
            count_stmt = count_stmt.where(where_clause)

        total_count = int((await self._exec(count_stmt)).scalar() or 0)

        if total_count == 0:
            return {
                "items": [],
                "count": 0,
                "page": page,
                "size": size,
            }

        offset = (page - 1) * size

        # 목록 조회
        list_stmt = (
            select(
                L.id.label("ledger_id"),
                func.date(L.created_at).label("process_date"),
                L.event_type,
                L.sku,
                P.name.label("product_name"),
                L.qty_in,
                L.qty_out,
                S.qty_on_hand,
                S.last_unit_price,
                L.memo,
                L.created_by,
            )
            .select_from(L)
            .join(P, L.sku == P.sku)
            .outerjoin(S, S.sku == L.sku)
            .order_by(desc(L.created_at), desc(L.id))
            .offset(offset)
            .limit(size)
        )

        if where_clause is not None:
            list_stmt = list_stmt.where(where_clause)

        rows = (await self._exec(list_stmt)).fetchall()

        items: List[Dict[str, Any]] = []

        for r in rows:
            event_label = {
                "INBOUND": "입고",
                "OUTBOUND": "출고",
                "ADJUST": "조정",
                "OUTBOUND_CANCEL": "조정",
            }.get(r.event_type, r.event_type)

            items.append(
                {
                    "ledger_id": r.ledger_id,
                    "process_date": r.process_date.isoformat() if r.process_date else None,
                    "event_type": r.event_type,
                    "event_label": event_label,
                    "sku": r.sku,
                    "product_name": r.product_name,
                    "qty_in": r.qty_in,
                    "qty_out": r.qty_out,
                    "current_stock": r.qty_on_hand,
                    "last_unit_price": float(r.last_unit_price) if r.last_unit_price else None,
                    "memo": r.memo,
                    "handler": r.created_by,
                }
            )

        return {
            "items": items,
            "count": total_count,
            "page": page,
            "size": size,
        }

    # ─────────────────────────────────────
    # 2) 엑셀 내보내기
    # ─────────────────────────────────────
    async def export_items(
        self,
        *,
        from_date: Optional[str],
        to_date: Optional[str],
        sku: Optional[str],
        keyword: Optional[str],
    ) -> Dict[str, Any]:

        L = self.models["InventoryLedger"]
        P = self.models["Product"]
        S = self.models["StockCurrent"]

        # 🔹 묶음 SKU(is_bundle=True)는 엑셀에서도 제외
        conditions = [
            or_(P.is_bundle.is_(None), P.is_bundle == False)
        ]

        date_from = self._parse_date(from_date, "from_date")
        date_to = self._parse_date(to_date, "to_date")

        if date_from:
            conditions.append(L.created_at >= date_from)
        if date_to:
            conditions.append(L.created_at <= date_to)
        if sku:
            conditions.append(L.sku == sku)
        if keyword:
            conditions.append(
                or_(
                    L.sku == keyword,
                    P.name.ilike(f"%{keyword}%"),
                )
            )

        where_clause = and_(*conditions) if conditions else None

        stmt = (
            select(
                func.date(L.created_at).label("process_date"),
                L.event_type,
                L.sku,
                P.name.label("product_name"),
                L.qty_in,
                L.qty_out,
                S.qty_on_hand,
                S.last_unit_price,
                L.memo,
                L.created_by,
            )
            .select_from(L)
            .join(P, L.sku == P.sku)
            .outerjoin(S, S.sku == L.sku)
            .order_by(desc(L.created_at), desc(L.id))
        )

        if where_clause is not None:
            stmt = stmt.where(where_clause)

        rows = (await self._exec(stmt)).fetchall()

        if not rows:
            raise DomainError(
                "STOCK-NOTFOUND-001",
                detail="엑셀로 내보낼 데이터가 없습니다.",
                ctx={"page_id": PAGE_ID},
            )

        try:
            from openpyxl import Workbook  # type: ignore
        except Exception as exc:
            raise DomainError(
                "SYSTEM-UNKNOWN-999",
                detail="엑셀 모듈을 불러올 수 없습니다.",
                ctx={"exc": repr(exc)},
            )

        wb = Workbook()
        ws = wb.active
        ws.title = "stock_history"

        ws.append(
            [
                "처리일자",
                "내용",
                "SKU",
                "상품명",
                "입고수량",
                "출고수량",
                "현재재고",
                "최근 단가",
                "메모",
                "처리자",
            ]
        )

        for r in rows:
            label = {
                "INBOUND": "입고",
                "OUTBOUND": "출고",
                "ADJUST": "조정",
                "OUTBOUND_CANCEL": "조정",
            }.get(r.event_type, r.event_type)

            ws.append(
                [
                    r.process_date.isoformat() if r.process_date else "",
                    label,
                    r.sku,
                    r.product_name,
                    r.qty_in or 0,
                    r.qty_out or 0,
                    r.qty_on_hand or 0,
                    float(r.last_unit_price) if r.last_unit_price else 0,
                    r.memo or "",
                    r.created_by or "",
                ]
            )

        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        content_base64 = base64.b64encode(buffer.read()).decode("utf-8")

        file_name = f"stock_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

        return {
            "file_name": file_name,
            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content_base64": content_base64,
            "count": len(rows),
        }
