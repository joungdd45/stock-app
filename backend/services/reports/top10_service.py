# 📄 backend/services/reports/top10_service.py
# 페이지: 대시보드 — TOP10 출고 현황
# 역할: 비즈니스 로직 전담 (조회, 집계, 엑셀 생성, 도메인 예외)
# 단계: v2.0 (implemented) / 구조 통일 작업지침 v2 적용

from __future__ import annotations
from typing import Any, Dict, Optional, List
from datetime import date
import calendar
import base64
from io import BytesIO

from sqlalchemy import select, func, desc, or_, and_
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from backend.system.error_codes import DomainError

# ✅ 주간현황과 동일한 ORM 경로
from backend.models import OutboundHeader, OutboundItem, Product

PAGE_ID = "reports.top10"
PAGE_VERSION = "v2.0"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 세션 어댑터
# ─────────────────────────────────────────────────────────
def _get_session_adapter(session: Any) -> Any:
    if isinstance(session, (Session, AsyncSession)):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
        stage="service",
        domain=PAGE_ID,
    )


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 월 범위 계산
# ─────────────────────────────────────────────────────────
def _get_month_range(year: int, month: int) -> tuple[date, date]:
    if year < 2000 or year > 2100 or month < 1 or month > 12:
        raise DomainError(
            "REPORTS-TOP10-VALID-001",
            detail="유효하지 않은 연도 또는 월입니다.",
            ctx={"year": year, "month": month},
            stage="service",
            domain=PAGE_ID,
        )

    last_day = calendar.monthrange(year, month)[1]
    start = date(year, month, 1)
    end = date(year, month, last_day)

    return start, end


# ─────────────────────────────────────────────────────────
# 서비스 클래스
# ─────────────────────────────────────────────────────────
class Top10Service:
    """
    대시보드 — TOP10 출고 현황 서비스
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user

    # -----------------------------------------------------
    # 내부: TOP10 쿼리 생성
    # -----------------------------------------------------
    def _build_query(
        self,
        *,
        year: int,
        month: int,
        keyword: Optional[str],
    ):
        month_from, month_to = _get_month_range(year, month)

        conditions = [
            OutboundHeader.status == "completed",
            OutboundHeader.deleted_at.is_(None),
            OutboundItem.deleted_at.is_(None),
            OutboundHeader.outbound_date >= month_from,
            OutboundHeader.outbound_date <= month_to,
        ]

        if keyword:
            like = f"%{keyword}%"
            conditions.append(
                or_(
                    OutboundItem.sku.ilike(like),
                    Product.name.ilike(like),
                )
            )

        stmt = (
            select(
                OutboundItem.sku.label("sku"),
                Product.name.label("name"),
                func.coalesce(func.sum(OutboundItem.qty), 0).label("shipped_qty"),
                func.coalesce(func.sum(OutboundItem.sales_total), 0).label("revenue"),
            )
            .select_from(OutboundItem)
            .join(OutboundHeader, OutboundItem.header_id == OutboundHeader.id)
            .join(Product, OutboundItem.sku == Product.sku)
            .where(and_(*conditions))
            .group_by(
                OutboundItem.sku,
                Product.name,
            )
            .order_by(
                desc("shipped_qty"),
                desc("revenue"),
            )
            .limit(10)
        )

        return stmt

    # -----------------------------------------------------
    # [read] TOP10 조회
    # -----------------------------------------------------
    async def list_top10(
        self,
        *,
        year: int,
        month: int,
        keyword: Optional[str],
    ) -> Dict[str, Any]:

        stmt = self._build_query(
            year=year,
            month=month,
            keyword=keyword,
        )

        if isinstance(self.session, AsyncSession):
            rows = (await self.session.execute(stmt)).all()
        else:
            rows = self.session.execute(stmt).all()

        items: List[Dict[str, Any]] = []
        for r in rows:
            items.append(
                {
                    "sku": r.sku,
                    "name": r.name,
                    "shipped_qty": int(r.shipped_qty or 0),
                    "revenue": float(r.revenue or 0),
                }
            )

        return {
            "month": f"{year:04d}-{month:02d}",
            "count": len(items),
            "items": items,
        }

    # -----------------------------------------------------
    # [read] TOP10 엑셀 내보내기
    # -----------------------------------------------------
    async def export_top10(
        self,
        *,
        year: int,
        month: int,
        keyword: Optional[str],
    ) -> Dict[str, Any]:

        data = await self.list_top10(
            year=year,
            month=month,
            keyword=keyword,
        )

        try:
            from openpyxl import Workbook
        except Exception as exc:
            raise DomainError(
                "REPORTS-TOP10-EXCEL-001",
                detail="엑셀 모듈을 불러올 수 없습니다.",
                ctx={"error": repr(exc)},
                stage="service",
                domain=PAGE_ID,
            )

        try:
            wb = Workbook()
            ws = wb.active
            ws.title = f"TOP10_{data['month']}"

            # 헤더
            ws.append(["순위", "SKU", "상품명", "출고수량"])

            # 데이터
            for idx, item in enumerate(data["items"], start=1):
                ws.append(
                    [
                        idx,
                        item["sku"],
                        item["name"],
                        item["shipped_qty"],
                    ]
                )

            # 기본 컬럼 폭
            ws.column_dimensions["A"].width = 8
            ws.column_dimensions["B"].width = 30
            ws.column_dimensions["C"].width = 40
            ws.column_dimensions["D"].width = 15

            buffer = BytesIO()
            wb.save(buffer)
            buffer.seek(0)

            encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")

            return {
                "file_name": f"dashboard_top10_{year:04d}{month:02d}.xlsx",
                "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "content_base64": encoded,
            }

        except DomainError:
            raise

        except Exception as exc:
            raise DomainError(
                "REPORTS-TOP10-EXCEL-002",
                detail="TOP10 엑셀 생성 중 오류가 발생했습니다.",
                ctx={"error": repr(exc)},
                stage="service",
                domain=PAGE_ID,
            )
