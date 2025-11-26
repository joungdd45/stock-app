# 📄 backend/routers/reports/reports_weekly.py
# 페이지: 대시보드 > 주간현황
# 목적: 주간 출고 현황 조회 및 xlsx 내보내기
# 단계: v1.2 — ReportsWeeklyService 연동 + 인증 가드/세션 DI 적용
# 규칙: 전체수정 / 상단주석 / 라우터 이름 = 파일명 / tags 동일
# 스펙:
# - 주차: 월 기준, 월요일 to 일요일 (서비스에서 계산)
# - 기본 정렬: qty_desc(출고수량 desc) / sales_desc(총 매출 desc)
# - 경로: /api/reports/weekly
# - 엑셀: 현재 필터(year, month, week, query) 기준 전체 집계 결과 다운로드

from __future__ import annotations

import base64
from datetime import date
from typing import List, Optional, Dict, Any

from fastapi import APIRouter, Query, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.db.session import get_sync_session  # ✅ 실제 DB 세션
from backend.security.guard import guard  # ✅ 공통 인증 가드
from backend.services.reports.reports_weekly_service import (
    reports_weekly_service,
    SortPrimary,
)

reports_weekly = APIRouter(
    prefix="/api/reports/weekly",
    tags=["reports_weekly"],
)

# ─────────────────────────────────────────────
# 서비스 DI 컨텍스트 (세션 + 유저)
# ─────────────────────────────────────────────


class ReportsWeeklyServiceCtx:
    """
    주간현황 서비스 호출용 컨텍스트.
    - session: 동기 SQLAlchemy 세션
    - user: guard를 통해 주입된 현재 사용자 정보 (참고용)
    실제 비즈니스 로직은 reports_weekly_service 쪽에만 존재.
    """

    def __init__(self, session: Session, user: Dict[str, Any]):
        self.session = session
        self.user = user

    async def get_weekly_report(
        self,
        year: int,
        month: int,
        week: int,
        query: Optional[str],
        page: int,
        page_size: int,
        sort: SortPrimary,
    ):
        return await reports_weekly_service.get_weekly_report(
            session=self.session,
            year=year,
            month=month,
            week=week,
            query=query,
            page=page,
            page_size=page_size,
            sort=sort,
        )

    async def export_weekly_report_xlsx(
        self,
        year: int,
        month: int,
        week: int,
        query: Optional[str],
        sort: SortPrimary,
    ):
        return await reports_weekly_service.export_weekly_report_xlsx(
            session=self.session,
            year=year,
            month=month,
            week=week,
            query=query,
            sort=sort,
        )


def get_service(
    user=Depends(guard),
    session: Session = Depends(get_sync_session),
) -> ReportsWeeklyServiceCtx:
    """
    인증 가드 + 동기 DB 세션을 한 번에 주입하는 DI.
    - 엔드포인트에서는 svc = Depends(get_service) 패턴으로 사용.
    """
    return ReportsWeeklyServiceCtx(session=session, user=user)

# ─────────────────────────────────────────────
# DTO 정의 — 요청/응답 구조
# ─────────────────────────────────────────────


class WeeklyItem(BaseModel):
    rank: int = Field(..., description="정렬 결과 순위(1부터)")
    sku: str = Field(..., description="SKU 코드")
    name: str = Field(..., description="상품명")
    qty: int = Field(..., description="기간 내 출고수량")
    sales_total: int = Field(..., description="기간 내 총 매출(KRW)")


class WeeklyListResponse(BaseModel):
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


class WeeklyExportResponse(BaseModel):
    file_name: str = Field(..., description="다운로드 파일명")
    content_type: str = Field(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        description="MIME 타입",
    )
    content_base64: str = Field(..., description="xlsx 바이너리 Base64 인코딩")


# ─────────────────────────────────────────────
# 조회 — 주간현황 목록
# ─────────────────────────────────────────────


@reports_weekly.get(
    "",
    response_model=WeeklyListResponse,
    summary="대시보드 주간현황 조회",
)
async def get_weekly_report(
    year: int = Query(..., description="연도 예: 2025"),
    month: int = Query(..., description="월 1 to 12"),
    week: int = Query(..., description="월 기준 주차(월요일 시작, 1 to 6)"),
    query: Optional[str] = Query(None, description="SKU 또는 상품명 검색(부분일치)"),
    page: int = Query(1, description="페이지 기본값 1"),
    page_size: int = Query(10, description="페이지 크기 기본값 10"),
    sort: SortPrimary = Query("qty_desc", description="qty_desc 또는 sales_desc"),
    svc: ReportsWeeklyServiceCtx = Depends(get_service),
) -> WeeklyListResponse:
    """
    선택된 연/월/주차 기준으로
    - outbound_header/outbound_item/product를 집계해서
    - 출고수량/총매출 기준으로 정렬 후
    - 페이징된 주간현황 목록을 반환한다.
    """
    result = await svc.get_weekly_report(
        year=year,
        month=month,
        week=week,
        query=query,
        page=page,
        page_size=page_size,
        sort=sort,
    )

    items = [
        WeeklyItem(
            rank=item.rank,
            sku=item.sku,
            name=item.name,
            qty=item.qty,
            sales_total=item.sales_total,
        )
        for item in result.items
    ]

    return WeeklyListResponse(
        range_from=result.range_from,
        range_to=result.range_to,
        page=result.page,
        page_size=result.page_size,
        total=result.total,
        items=items,
        meta=result.meta,
    )


# ─────────────────────────────────────────────
# 엑셀 내보내기 — 현재 필터 기준 전체 주간 집계
# ─────────────────────────────────────────────


@reports_weekly.get(
    "/export",
    response_model=WeeklyExportResponse,
    summary="대시보드 주간현황 xlsx 내보내기",
)
async def export_weekly_report_xlsx(
    year: int = Query(..., description="연도 예: 2025"),
    month: int = Query(..., description="월 1 to 12"),
    week: int = Query(..., description="월 기준 주차(월요일 시작, 1 to 6)"),
    query: Optional[str] = Query(None, description="SKU 또는 상품명 검색(부분일치)"),
    sort: SortPrimary = Query("qty_desc", description="qty_desc 또는 sales_desc"),
    svc: ReportsWeeklyServiceCtx = Depends(get_service),
) -> WeeklyExportResponse:
    """
    선택된 연/월/주차(+검색어) 기준으로
    집계된 전체 주간현황 데이터를 엑셀(xlsx)로 반환한다.
    (체크박스/선택과 무관하게 전체 집계 결과 다운로드)
    """
    xlsx_bytes = await svc.export_weekly_report_xlsx(
        year=year,
        month=month,
        week=week,
        query=query,
        sort=sort,
    )

    content_base64 = base64.b64encode(xlsx_bytes).decode("utf-8")
    file_name = f"reports_weekly_{year:04d}{month:02d}_w{week}.xlsx"

    return WeeklyExportResponse(
        file_name=file_name,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        content_base64=content_base64,
    )
