# 📄 backend/services/reports/reports_weekly_service.py
# 페이지: 대시보드 > 주간현황
# 역할: 비즈니스 로직 전담 (집계, 정렬, 페이징, 엑셀 생성)
# 스펙:
# - 주차: 월 기준, 월요일 to 일요일
# - 정렬: qty_desc(출고수량 기준) / sales_desc(총 매출 기준)
# - 통화: KRW (outbound_item.sales_total 합계)
# - 엑셀: 현재 필터(year, month, week, query) 기준 전체 집계 결과 다운로드

from __future__ import annotations

import calendar
from datetime import date
from io import BytesIO
from typing import List, Optional, Dict, Literal, Tuple

from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import Session
from openpyxl import Workbook  # ✅ 엑셀 생성 라이브러리

from backend.models import OutboundHeader, OutboundItem, Product  # ✅ 실제 ORM 경로 사용


# ─────────────────────────────────────────────────────────
# 서비스 예외
# ─────────────────────────────────────────────────────────
class ServiceError(Exception):
    """서비스 공통 예외의 루트 클래스"""


class ValidationError(ServiceError):
    """파라미터 또는 비즈니스 규칙 검증 실패"""


class NotFoundError(ServiceError):
    """집계 대상이 없거나 조회 결과 없음"""


class AggregationError(ServiceError):
    """집계 처리 중 내부 오류"""


# ─────────────────────────────────────────────────────────
# DTO
# ─────────────────────────────────────────────────────────
SortPrimary = Literal["qty_desc", "sales_desc"]


class WeeklyItem(BaseModel):
    rank: int = Field(..., description="정렬 결과 순위(1부터)")
    sku: str = Field(..., description="SKU 코드")
    name: str = Field(..., description="상품명")
    qty: int = Field(..., description="기간 내 출고수량")
    sales_total: int = Field(..., description="기간 내 총 매출(KRW)")


class WeeklyResult(BaseModel):
    range_from: date
    range_to: date
    page: int
    page_size: int
    total: int
    items: List[WeeklyItem]
    meta: Dict[str, str] = Field(
        default={"currency": "KRW", "timezone": "Asia/Seoul"},
        description="통화/타임존 메타 정보",
    )


# ─────────────────────────────────────────────────────────
# 서비스 본체
# ─────────────────────────────────────────────────────────
class ReportsWeeklyService:
    """대시보드 > 주간현황 서비스"""

    async def get_weekly_report(
        self,
        *,
        session: Session,
        year: int,
        month: int,
        week: int,
        query: Optional[str],
        page: int,
        page_size: int,
        sort: SortPrimary,
    ) -> WeeklyResult:
        """주간현황 목록 조회(페이징)"""

        # 1) 기본 검증
        self._validate_basic_params(
            year=year,
            month=month,
            week=week,
            page=page,
            page_size=page_size,
        )

        # 2) 주차 → 날짜 범위 계산
        range_from, range_to = await self._calc_week_range(
            year=year,
            month=month,
            week=week,
        )

        # 3) 집계 쿼리
        rows = await self._fetch_aggregated_rows(
            session=session,
            range_from=range_from,
            range_to=range_to,
            query=query,
        )

        if rows is None:
            raise AggregationError("집계 처리 중 알 수 없는 오류가 발생했습니다.")

        if not rows:
            # 데이터 없는 경우도 정상 응답
            return WeeklyResult(
                range_from=range_from,
                range_to=range_to,
                page=page,
                page_size=page_size,
                total=0,
                items=[],
            )

        # 4) 정렬 + 순위
        ranked_items = self._apply_sort_and_rank(rows=rows, sort=sort)

        # 5) 페이징
        page_items, total = self._paginate(
            items=ranked_items,
            page=page,
            page_size=page_size,
        )

        return WeeklyResult(
            range_from=range_from,
            range_to=range_to,
            page=page,
            page_size=page_size,
            total=total,
            items=page_items,
        )

    async def export_weekly_report_xlsx(
        self,
        *,
        session: Session,
        year: int,
        month: int,
        week: int,
        query: Optional[str],
        sort: SortPrimary,
    ) -> bytes:
        """현재 필터 기준 전체 집계 결과를 xlsx로 생성"""

        # 기본 검증 (page/page_size는 의미 없으니 최소값만 써서 재사용)
        self._validate_basic_params(
            year=year,
            month=month,
            week=week,
            page=1,
            page_size=1,
        )

        # 주차 범위 계산
        range_from, range_to = await self._calc_week_range(
            year=year,
            month=month,
            week=week,
        )

        # 전체 집계 (query 포함)
        rows = await self._fetch_aggregated_rows(
            session=session,
            range_from=range_from,
            range_to=range_to,
            query=query,
        )

        if rows is None:
            raise AggregationError("집계 처리 중 알 수 없는 오류가 발생했습니다.")

        if not rows:
            raise NotFoundError("해당 기간에 집계할 출고 데이터가 없습니다.")

        # 정렬 + 순위
        ranked_items = self._apply_sort_and_rank(rows=rows, sort=sort)

        # 전체 집계 결과를 그대로 엑셀 생성
        xlsx_bytes = self._build_xlsx(items=ranked_items)
        return xlsx_bytes

    # ─────────────────────────────────────
    # 내부 헬퍼
    # ─────────────────────────────────────
    def _validate_basic_params(
        self,
        *,
        year: int,
        month: int,
        week: int,
        page: int,
        page_size: int,
    ) -> None:
        if year < 2000 or year > 2100:
            raise ValidationError("year 파라미터가 올바르지 않습니다.")

        if month < 1 or month > 12:
            raise ValidationError("month 파라미터는 1 to 12 범위여야 합니다.")

        if week < 1 or week > 6:
            raise ValidationError("week 파라미터가 올바르지 않습니다.")

        if page < 1:
            raise ValidationError("page는 1 이상이어야 합니다.")

        if page_size < 1 or page_size > 1000:
            raise ValidationError("page_size는 1 to 1000 범위여야 합니다.")

    async def _calc_week_range(
        self,
        *,
        year: int,
        month: int,
        week: int,
    ) -> Tuple[date, date]:
        """월 기준 주차(월요일 to 일요일) → (range_from, range_to)"""

        cal = calendar.Calendar(firstweekday=0)  # 0 = 월요일
        weeks = cal.monthdatescalendar(year, month)

        if week < 1 or week > len(weeks):
            raise ValidationError("요청한 week가 해당 월의 유효한 주차 범위를 벗어났습니다.")

        week_dates = weeks[week - 1]
        # 해당 월에 속하는 날짜만 사용
        month_dates = [d for d in week_dates if d.month == month]

        if not month_dates:
            raise ValidationError("요청한 주차에 해당 월 날짜가 존재하지 않습니다.")

        return month_dates[0], month_dates[-1]

    async def _fetch_aggregated_rows(
        self,
        *,
        session: Session,
        range_from: date,
        range_to: date,
        query: Optional[str],
    ) -> List[Dict]:
        """원천 데이터 조회(출고수량, 매출 합계)

        - outbound_header / outbound_item / product 조인
        - 상태: outbound_header.status = 'completed'
        - deleted_at IS NULL 필터
        - outbound_header.outbound_date between range_from and range_to
        - query 있으면 SKU 또는 상품명 부분일치
        - group by SKU + 상품명
        """

        conditions = [
            OutboundHeader.deleted_at.is_(None),
            OutboundItem.deleted_at.is_(None),
            Product.deleted_at.is_(None),
            OutboundHeader.outbound_date >= range_from,
            OutboundHeader.outbound_date <= range_to,
            OutboundHeader.status == "completed",
        ]

        if query:
            like_expr = f"%{query}%"
            conditions.append(
                or_(
                    OutboundItem.sku.ilike(like_expr),
                    Product.name.ilike(like_expr),
                )
            )

        stmt = (
            select(
                OutboundItem.sku.label("sku"),
                Product.name.label("name"),
                func.coalesce(func.sum(OutboundItem.qty), 0).label("qty"),
                func.coalesce(func.sum(OutboundItem.sales_total), 0).label("sales_total"),
            )
            .join(OutboundHeader, OutboundItem.header_id == OutboundHeader.id)
            .join(Product, OutboundItem.sku == Product.sku)
            .where(and_(*conditions))
            .group_by(OutboundItem.sku, Product.name)
        )

        result = session.execute(stmt)

        rows: List[Dict] = []
        for row in result:
            rows.append(
                {
                    "sku": row.sku,
                    "name": row.name,
                    "qty": int(row.qty or 0),
                    "sales_total": int(row.sales_total or 0),
                }
            )

        return rows

    def _apply_sort_and_rank(
        self,
        *,
        rows: List[Dict],
        sort: SortPrimary,
    ) -> List[WeeklyItem]:
        """정렬 규칙 적용 후 순위 부여"""

        if sort == "sales_desc":
            sorted_rows = sorted(
                rows,
                key=lambda r: (
                    -(r.get("sales_total") or 0),
                    -(r.get("qty") or 0),
                    r.get("sku") or "",
                ),
            )
        else:
            sorted_rows = sorted(
                rows,
                key=lambda r: (
                    -(r.get("qty") or 0),
                    -(r.get("sales_total") or 0),
                    r.get("sku") or "",
                ),
            )

        items: List[WeeklyItem] = []
        for idx, r in enumerate(sorted_rows, start=1):
            items.append(
                WeeklyItem(
                    rank=idx,
                    sku=r["sku"],
                    name=r["name"],
                    qty=r["qty"],
                    sales_total=r["sales_total"],
                )
            )
        return items

    def _paginate(
        self,
        *,
        items: List[WeeklyItem],
        page: int,
        page_size: int,
    ) -> Tuple[List[WeeklyItem], int]:
        total = len(items)
        if total == 0:
            return [], 0

        start = (page - 1) * page_size
        end = start + page_size

        if start >= total:
            return [], total

        return items[start:end], total

    def _build_xlsx(self, *, items: List[WeeklyItem]) -> bytes:
        """주간현황 집계 전체를 엑셀로 생성"""

        wb = Workbook()
        ws = wb.active
        ws.title = "주간현황"

        # 헤더
        ws.append(["순위", "SKU", "상품명", "출고수량", "총 매출(KRW)"])

        # 데이터
        for item in items:
            ws.append(
                [
                    item.rank,
                    item.sku,
                    item.name,
                    item.qty,
                    item.sales_total,
                ]
            )

        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        return buffer.read()


# 싱글톤 인스턴스 — 라우터에서 import 용
reports_weekly_service = ReportsWeeklyService()
