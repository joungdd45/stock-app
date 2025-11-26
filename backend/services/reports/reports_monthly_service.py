# 📄 backend/services/reports/reports_monthly_service.py
# 페이지: 대시보드 - 월간현황(MonthlyPage)
# 역할: 월간 출고 집계 + 엑셀 다운로드
#
# 기준 쿼리 (네가 준 레퍼런스 그대로 사용):
#
# FROM outbound_item I
# JOIN outbound_header H ON I.header_id = H.id
# JOIN product P ON I.sku = P.sku
# WHERE
#   H.status = 'completed'
#   AND H.deleted_at IS NULL
#   AND I.deleted_at IS NULL
#   AND H.outbound_date >= :month_from
#   AND H.outbound_date <= :month_to
#   [AND (I.sku ILIKE :q OR P.name ILIKE :q)]
# GROUP BY I.sku, P.name
# ORDER BY shipped_qty DESC, revenue DESC

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import date
from io import BytesIO
from typing import Optional, Dict, Any, List, Tuple

from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError

try:
    from openpyxl import Workbook
except ImportError:
    Workbook = None


PAGE_ID = "reports.monthly"
PAGE_VERSION = "v2.2"


# ─────────────────────────────────────────────
# DTO
# ─────────────────────────────────────────────
@dataclass
class MonthlyFilter:
    year: int
    month: int
    q: Optional[str]
    page: int
    size: int


# ─────────────────────────────────────────────
# 서비스 본체
# ─────────────────────────────────────────────
class ReportsMonthlyService:
    """
    대시보드 - 월간현황 서비스

    - outbound_header / outbound_item / product 를 직접 SQL로 조회
    - ORM 모델 임포트 없이 동작 → ModuleNotFoundError 방지
    """

    def __init__(self, *, session: Session, user: Dict[str, Any]):
        self.session: Session = session
        self.user: Dict[str, Any] = user

    # -------------------------------------------------
    # 1) 월간 출고현황 조회
    # -------------------------------------------------
    def list_items(
        self,
        *,
        year: int,
        month: int,
        q: Optional[str],
        page: int,
        size: int,
    ) -> Dict[str, Any]:
        filters = MonthlyFilter(
            year=year,
            month=month,
            q=q,
            page=page,
            size=size,
        )

        page, size = self._normalize_paging(filters.page, filters.size)
        filters.page = page
        filters.size = size

        month_from, month_to = self._get_month_range(filters.year, filters.month)

        base_from_where, params = self._build_base_from_where(
            month_from=month_from,
            month_to=month_to,
            q=filters.q,
        )

        # 전체 건수 (SKU 개수) 계산
        count_sql = text(f"""
            SELECT COUNT(*) AS cnt
            FROM (
                SELECT
                    I.sku
                {base_from_where}
                GROUP BY I.sku, P.name
            ) sub
        """)
        total_count = int(self.session.execute(count_sql, params).scalar_one() or 0)

        # 목록 조회 (페이지네이션)
        list_sql = text(f"""
            SELECT
                I.sku              AS sku,
                P.name             AS name,
                SUM(I.qty)         AS shipped_qty,
                SUM(I.sales_total) AS revenue
            {base_from_where}
            GROUP BY
                I.sku,
                P.name
            ORDER BY
                shipped_qty DESC,
                revenue DESC
            LIMIT :limit OFFSET :offset
        """)

        list_params = dict(params)
        list_params["limit"] = filters.size
        list_params["offset"] = (filters.page - 1) * filters.size

        rows = self.session.execute(list_sql, list_params).all()

        items: List[Dict[str, Any]] = []
        for r in rows:
            items.append(
                {
                    "sku": r.sku,
                    "name": r.name,
                    "shipped_qty": int(r.shipped_qty or 0),
                }
            )

        return {
            "items": items,
            "count": total_count,
            "page": filters.page,
            "size": filters.size,
        }

    # -------------------------------------------------
    # 2) 월간 출고현황 엑셀 다운로드
    # -------------------------------------------------
    def export_xlsx(
        self,
        *,
        year: int,
        month: int,
        q: Optional[str],
    ) -> Dict[str, Any]:
        if Workbook is None:
            raise DomainError(
                "SYSTEM-UNKNOWN-999",
                detail="엑셀(xlsx) 생성 모듈을 사용할 수 없습니다.",
                ctx={"page_id": PAGE_ID},
                stage="service",
                domain=PAGE_ID,
            )

        month_from, month_to = self._get_month_range(year, month)

        base_from_where, params = self._build_base_from_where(
            month_from=month_from,
            month_to=month_to,
            q=q,
        )

        export_sql = text(f"""
            SELECT
                I.sku              AS sku,
                P.name             AS name,
                SUM(I.qty)         AS shipped_qty,
                SUM(I.sales_total) AS revenue
            {base_from_where}
            GROUP BY
                I.sku,
                P.name
            ORDER BY
                shipped_qty DESC,
                revenue DESC
        """)

        rows = self.session.execute(export_sql, params).all()

        # 엑셀 생성
        wb = Workbook()
        ws = wb.active
        ws.title = "월간현황"

        # 헤더
        ws.append(["순위", "SKU", "상품명", "출고수량"])

        rank = 1
        for r in rows:
            ws.append(
                [
                    rank,
                    r.sku,
                    r.name,
                    int(r.shipped_qty or 0),
                ]
            )
            rank += 1

        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)

        content_base64 = base64.b64encode(buffer.read()).decode("utf-8")

        return {
            "file_name": f"monthly_dashboard_{year}{month:02d}.xlsx",
            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content_base64": content_base64,
        }

    # ─────────────────────────────────────────────
    # 내부 유틸
    # ─────────────────────────────────────────────
    @staticmethod
    def _normalize_paging(page: int, size: int) -> Tuple[int, int]:
        if page < 1:
            page = 1
        if size < 1:
            size = 10
        if size > 200:
            size = 200
        return page, size

    @staticmethod
    def _get_month_range(year: int, month: int) -> Tuple[date, date]:
        """
        month_from (해당월 1일), month_to(해당월 마지막날) 반환.
        쿼리에서는 >= month_from AND <= month_to 로 사용.
        """
        first_day = date(year, month, 1)
        if month == 12:
            next_month = date(year + 1, 1, 1)
        else:
            next_month = date(year, month + 1, 1)

        last_day = next_month - date.resolution  # 하루 빼기
        return first_day, last_day

    @staticmethod
    def _build_base_from_where(
        *,
        month_from: date,
        month_to: date,
        q: Optional[str],
    ) -> Tuple[str, Dict[str, Any]]:
        """
        공통 FROM + WHERE 문자열과 파라미터 딕셔너리 생성.
        네가 준 레퍼런스 SQL 구조를 그대로 사용.
        """
        conditions = [
            "H.status = 'completed'",
            "H.deleted_at IS NULL",
            "I.deleted_at IS NULL",
            "P.deleted_at IS NULL",
            "H.outbound_date >= :month_from",
            "H.outbound_date <= :month_to",
        ]

        params: Dict[str, Any] = {
            "month_from": month_from,
            "month_to": month_to,
        }

        if q:
            keyword = q.strip()
            if keyword:
                conditions.append(
                    "(I.sku ILIKE :q_like OR P.name ILIKE :q_like)"
                )
                params["q_like"] = f"%{keyword}%"

        where_clause = " AND ".join(conditions)

        base_from_where = f"""
            FROM outbound_item I
            JOIN outbound_header H ON I.header_id = H.id
            JOIN product P ON I.sku = P.sku
            WHERE {where_clause}
        """

        return base_from_where, params
