# 📄 backend/services/main/main_page_service.py
# 페이지: 메인 페이지(MainPage)
# 역할: 비즈니스 로직 전담 (요약 계산, 캘린더 생성)
# 단계: v1.4 (models.py 경로 수정 완료)

from __future__ import annotations
from typing import Any, Dict, List

from datetime import date
import calendar

from sqlalchemy import func, extract
from sqlalchemy.orm import Session

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────
PAGE_ID = "main.page"
PAGE_VERSION = "v1.4"


# ─────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    DB 모델 지연 임포트.
    실제 파일 위치: backend/models.py → import 경로: backend.models
    """
    try:
        from backend.models import (
            Product,
            InboundHeader,
            OutboundHeader,
            StockCurrent,
        )

        return {
            "Product": Product,
            "InboundHeader": InboundHeader,
            "OutboundHeader": OutboundHeader,
            "StockCurrent": StockCurrent,
        }
    except Exception as e:
        raise DomainError(
            "SYSTEM-INIT-001",
            detail="메인페이지 서비스에서 DB 모델을 불러오지 못했습니다.",
            ctx={
                "page_id": PAGE_ID,
                "error": str(e),
            },
        )


def _get_session_adapter(session: Any) -> Session:
    if isinstance(session, Session):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


# ─────────────────────────────────────────
# 서비스 클래스
# ─────────────────────────────────────────
class MainPageService:
    """
    메인페이지 서비스 구현체.
    - 요약 정보 get_summary
    - 캘린더 생성 get_calendar
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user
        self.models = _get_models()

    # -----------------------------------------------------
    # 1) 요약 정보 계산 summary
    # -----------------------------------------------------
    def get_summary(self) -> Dict[str, Any]:
        """
        메인페이지 상단 요약 데이터 (실제 DB 기반)
        """
        Product = self.models["Product"]
        InboundHeader = self.models["InboundHeader"]
        OutboundHeader = self.models["OutboundHeader"]
        StockCurrent = self.models["StockCurrent"]

        today = date.today()
        first_day_of_month = today.replace(day=1)

        try:
            # 1. 금일 입고 건수
            inbound_today = (
                self.session.query(func.count(InboundHeader.id))
                .filter(
                    InboundHeader.deleted_at.is_(None),
                    InboundHeader.inbound_date == today,
                    InboundHeader.status == "committed",
                )
                .scalar()
            ) or 0

            # 2. 금일 출고 건수
            outbound_today = (
                self.session.query(func.count(OutboundHeader.id))
                .filter(
                    OutboundHeader.deleted_at.is_(None),
                    OutboundHeader.outbound_date == today,
                    OutboundHeader.status == "completed",
                )
                .scalar()
            ) or 0

            # 3. 금월 출고 건수
            outbound_month = (
                self.session.query(func.count(OutboundHeader.id))
                .filter(
                    OutboundHeader.deleted_at.is_(None),
                    OutboundHeader.outbound_date >= first_day_of_month,
                    OutboundHeader.status == "completed",
                )
                .scalar()
            ) or 0

            # 4. 금월 취소 건수
            cancel_month = (
                self.session.query(func.count(OutboundHeader.id))
                .filter(
                    OutboundHeader.deleted_at.is_(None),
                    OutboundHeader.outbound_date >= first_day_of_month,
                    OutboundHeader.status == "cancel",
                )
                .scalar()
            ) or 0

            # 5. 총 아이템 수
            total_item_count = (
                self.session.query(func.count(Product.id))
                .filter(Product.deleted_at.is_(None))
                .scalar()
            ) or 0

            # 6. 총 재고 수
            total_stock_qty = (
                self.session.query(func.sum(StockCurrent.qty_on_hand))
                .filter(StockCurrent.deleted_at.is_(None))
                .scalar()
            ) or 0

            # 7. 국가별 출고 비율
            country_rows = (
                self.session.query(
                    OutboundHeader.country,
                    func.count(OutboundHeader.id).label("cnt"),
                )
                .filter(
                    OutboundHeader.deleted_at.is_(None),
                    OutboundHeader.status == "completed",
                    OutboundHeader.outbound_date >= first_day_of_month,
                    OutboundHeader.country.isnot(None),
                )
                .group_by(OutboundHeader.country)
                .all()
            )

            total_country_count = sum(row.cnt for row in country_rows) or 1

            country_ratio = [
                {
                    "country": row.country,
                    "count": row.cnt,
                    "ratio": round(row.cnt / total_country_count, 4),
                }
                for row in country_rows
            ]

            # 8. 월간 출고 그래프
            daily = (
                self.session.query(
                    extract("day", OutboundHeader.outbound_date).label("day"),
                    func.count(OutboundHeader.id).label("count"),
                )
                .filter(
                    OutboundHeader.deleted_at.is_(None),
                    OutboundHeader.status == "completed",
                    OutboundHeader.outbound_date >= first_day_of_month,
                )
                .group_by("day")
                .order_by("day")
                .all()
            )

            daily_outbound = [
                {"day": int(row.day), "count": row.count}
                for row in daily
            ]

            return {
                "date": today.isoformat(),
                "today_inbound": inbound_today,
                "today_outbound": outbound_today,
                "month_outbound": outbound_month,
                "month_cancel": cancel_month,
                "total_item_count": total_item_count,
                "total_stock_qty": total_stock_qty,
                "country_ratio": country_ratio,
                "daily_outbound": daily_outbound,
            }

        except Exception as e:
            raise DomainError(
                "MAIN-SUMMARY-001",
                detail="메인 요약 데이터 계산 중 오류 발생",
                ctx={"page_id": PAGE_ID, "error": str(e)},
            )

    # -----------------------------------------------------
    # 2) 캘린더 생성 calendar
    # -----------------------------------------------------
    def get_calendar(self, *, year: int, month: int) -> Dict[str, Any]:
        """
        내부 규칙 기반 자동 캘린더 생성
        """

        if month < 1 or month > 12:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="month는 1부터 12 사이여야 합니다.",
                ctx={"page_id": PAGE_ID, "month": month},
            )

        if year < 2000 or year > 2100:
            raise DomainError(
                "SYSTEM-VALID-001",
                detail="year는 2000에서 2100 사이여야 합니다.",
                ctx={"page_id": PAGE_ID, "year": year},
            )

        _, last_day = calendar.monthrange(year, month)
        days: List[Dict[str, Any]] = []

        today_str = date.today().isoformat()

        HOLIDAYS = {
            f"{year}-01-01": "신정",
            f"{year}-12-25": "크리스마스",
        }

        for day in range(1, last_day + 1):
            d = date(year, month, day)
            d_str = d.isoformat()
            dow = d.weekday()

            days.append({
                "date": d_str,
                "dow": dow,
                "holiday": HOLIDAYS.get(d_str),
                "is_today": (d_str == today_str),
            })

        return {
            "year": year,
            "month": month,
            "days": days,
        }
