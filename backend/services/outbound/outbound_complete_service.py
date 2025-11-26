# 📄 backend/services/outbound/outbound_complete_service.py
# 페이지: 출고 완료(OutboundCompletePage)
# 역할: 비즈니스 로직 전담 (조회, 계산, 검증, 상태변경, 트랜잭션, 도메인 예외)
# 단계: v2.2 (list_items + export + cancel 구현, update 비활성)
#
# ✅ 서비스 원칙
# - 판단/조회/계산/검증/상태변경/트랜잭션/도메인 예외만 담당
# - HTTP 상태코드, 메시지/문구, JSON 응답 포맷, Swagger 문서화는 담당하지 않음
# - 문제 발생 시 DomainError(code, detail, ctx)만 던진다

from __future__ import annotations

import base64
from io import BytesIO
from datetime import datetime
from typing import Optional, Dict, Any, List

from sqlalchemy import select, func, and_, or_, desc, asc
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from backend.system.error_codes import DomainError

# ─────────────────────────────────────────────────────────
# 페이지 메타 정보
# ─────────────────────────────────────────────────────────
PAGE_ID = "outbound.complete"
PAGE_VERSION = "v2.2"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 모델/세션 지연 임포트
# ─────────────────────────────────────────────────────────
def _get_models() -> Dict[str, Any]:
    """
    실제 ORM 모델 연결은 이 함수 내부에서 처리한다.
    """
    try:
        from backend.models import (  # type: ignore
            OutboundHeader,
            OutboundItem,
            Product,
            InventoryLedger,
            StockCurrent,
        )
    except Exception as exc:  # pragma: no cover
        raise DomainError(
            "SYSTEM-DB-901",
            detail="출고 완료 페이지에서 ORM 모델을 로드할 수 없습니다.",
            ctx={"page_id": PAGE_ID, "exc": repr(exc)},
        )

    return {
        "OutboundHeader": OutboundHeader,
        "OutboundItem": OutboundItem,
        "Product": Product,
        "InventoryLedger": InventoryLedger,
        "StockCurrent": StockCurrent,
    }


def _get_session_adapter(session: Any) -> Any:
    """
    동기/비동기 세션 차이를 흡수하기 위한 어댑터.
    - 현재는 Session, AsyncSession만 허용.
    """
    if isinstance(session, (Session, AsyncSession)):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


# ─────────────────────────────────────────────────────────
# 서비스 클래스 — 라우터에서 DI로 제공됨
# ─────────────────────────────────────────────────────────
class OutboundCompleteService:
    """
    출고 완료 페이지 서비스.

    라우터 예)
        svc: OutboundCompleteService = Depends(get_service)
        result = await svc.list_items(...)
    """

    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user
        self.models = _get_models()

    # ─────────────────────────────────────────────────────
    # 내부 공통 유틸
    # ─────────────────────────────────────────────────────
    @property
    def _is_async(self) -> bool:
        return isinstance(self.session, AsyncSession)

    async def _exec(self, stmt):
        """
        Session / AsyncSession 모두 지원하는 실행 유틸.
        """
        if self._is_async:
            return await self.session.execute(stmt)  # type: ignore[return-value]
        return self.session.execute(stmt)

    async def _commit(self) -> None:
        """
        트랜잭션 커밋 유틸.
        """
        if self._is_async:
            await self.session.commit()
        else:
            self.session.commit()

    def _parse_date(self, value: Optional[str], field: str) -> Optional[datetime.date]:
        """
        YYYY-MM-DD 문자열을 date로 변환.
        """
        if value is None:
            return None
        value = value.strip()
        if not value:
            return None

        try:
            return datetime.strptime(value, "%Y-%m-%d").date()
        except ValueError:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail=f"{field}는 YYYY-MM-DD 형식이어야 합니다.",
                ctx={"page_id": PAGE_ID, field: value},
            )

    def _build_sorting(self, H, I, P, sort_by: Optional[str], sort_dir: Optional[str]):
        """
        정렬 기준 생성.
        - 기본: 출고일자 내림차순, id 내림차순
        - 허용 컬럼: outbound_date, country, order_number, tracking_number, sku, product_name
        """
        direction = (sort_dir or "desc").lower()
        if direction not in ("asc", "desc"):
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="sort_dir는 asc 또는 desc여야 합니다.",
                ctx={"page_id": PAGE_ID, "sort_dir": sort_dir},
            )

        if not sort_by:
            primary = H.outbound_date
            secondary = H.id
        else:
            sort_by = sort_by.lower()
            if sort_by == "outbound_date":
                primary = H.outbound_date
                secondary = H.id
            elif sort_by == "country":
                primary = H.country
                secondary = H.outbound_date
            elif sort_by == "order_number":
                primary = H.order_number
                secondary = H.outbound_date
            elif sort_by == "tracking_number":
                primary = H.tracking_number
                secondary = H.outbound_date
            elif sort_by == "sku":
                primary = I.sku
                secondary = H.outbound_date
            elif sort_by == "product_name":
                primary = P.name
                secondary = H.outbound_date
            else:
                raise DomainError(
                    "OUTBOUND-VALID-001",
                    detail="지원하지 않는 정렬 컬럼입니다.",
                    ctx={"page_id": PAGE_ID, "sort_by": sort_by},
                )

        if direction == "asc":
            return [asc(primary), asc(secondary)]
        return [desc(primary), desc(secondary)]

    def _build_filters(
        self,
        H,
        I,
        P,
        from_date: Optional[datetime.date],
        to_date: Optional[datetime.date],
        q: Optional[str],
    ) -> List[Any]:
        """
        공통 WHERE 조건 생성.
        - 출고완료 상태, 논리삭제 제외
        - 날짜 필터
        - q 한 개로 국가, 주문번호, 트래킹번호, SKU, 상품명 검색
        """
        conditions: List[Any] = [
            H.status == "completed",
            H.deleted_at.is_(None),
            I.deleted_at.is_(None),
        ]

        if from_date is not None:
            conditions.append(H.outbound_date >= from_date)
        if to_date is not None:
            conditions.append(H.outbound_date <= to_date)

        if q:
            q = q.strip()
            if q:
                keyword_cond = or_(
                    H.country == q,
                    H.order_number == q,
                    H.tracking_number == q,
                    I.sku == q,
                    P.name.ilike(f"%{q}%"),
                )
                conditions.append(keyword_cond)

        return conditions

    # ─────────────────────────────────────────────────────
    # 1) 목록 조회 — list_items
    # ─────────────────────────────────────────────────────
    async def list_items(
        self,
        *,
        from_date: Optional[str],
        to_date: Optional[str],
        q: Optional[str],
        page: int,
        size: int,
        sort_by: Optional[str],
        sort_dir: Optional[str],
    ) -> Dict[str, Any]:
        """
        출고 완료 목록 조회.
        - 한 줄 = 한 주문의 한 SKU
        - status = completed 인 전표만 대상
        - 날짜 필터, q 한 개로 검색
        - count: 전체 행 수
        - order_count: 전체 주문번호 수
        """

        # 기본 VALID 체크
        if page <= 0:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="page는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "page": page},
            )
        if size <= 0:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="size는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "size": size},
            )

        date_from = self._parse_date(from_date, "from_date")
        date_to = self._parse_date(to_date, "to_date")

        H = self.models["OutboundHeader"]
        I = self.models["OutboundItem"]
        P = self.models["Product"]

        conditions = self._build_filters(H, I, P, date_from, date_to, q)
        where_clause = and_(*conditions)

        # 전체 행 수 조회
        count_stmt = (
            select(func.count())
            .select_from(I)
            .join(H, I.header_id == H.id)
            .join(P, P.sku == I.sku)
            .where(where_clause)
        )
        count_result = await self._exec(count_stmt)
        total_count = int(count_result.scalar() or 0)

        if total_count == 0:
            return {
                "items": [],
                "count": 0,
                "order_count": 0,
                "page": page,
                "size": size,
            }

        # 주문번호 수 조회 (DISTINCT)
        order_count_stmt = (
            select(func.count(func.distinct(H.order_number)))
            .select_from(H)
            .join(I, I.header_id == H.id)
            .join(P, P.sku == I.sku)
            .where(where_clause)
        )
        order_count_result = await self._exec(order_count_stmt)
        order_count = int(order_count_result.scalar() or 0)

        # 정렬
        order_by_list = self._build_sorting(H, I, P, sort_by, sort_dir)

        # 실제 데이터 조회
        offset = (page - 1) * size

        list_stmt = (
            select(
                H.id.label("header_id"),
                I.id.label("item_id"),
                H.outbound_date,
                H.country,
                H.order_number,
                H.tracking_number,
                I.sku,
                P.name.label("product_name"),
                I.qty,
                H.weight_g,
                I.sales_total,
            )
            .select_from(I)
            .join(H, I.header_id == H.id)
            .join(P, P.sku == I.sku)
            .where(where_clause)
            .order_by(*order_by_list)
            .offset(offset)
            .limit(size)
        )

        result = await self._exec(list_stmt)
        rows = result.all()

        items: List[Dict[str, Any]] = []
        for row in rows:
            (
                header_id,
                item_id,
                outbound_date,
                country,
                order_number,
                tracking_number,
                sku,
                product_name,
                qty,
                weight_g,
                sales_total,
            ) = row

            items.append(
                {
                    "header_id": header_id,
                    "item_id": item_id,
                    "outbound_date": outbound_date.isoformat()
                    if outbound_date
                    else None,
                    "country": country,
                    "order_number": order_number,
                    "tracking_number": tracking_number,
                    "sku": sku,
                    "product_name": product_name,
                    "qty": qty,
                    "weight_g": weight_g,
                    "sales_total": float(sales_total)
                    if sales_total is not None
                    else None,
                }
            )

        return {
            "items": items,
            "count": total_count,
            "order_count": order_count,
            "page": page,
            "size": size,
        }

    # ─────────────────────────────────────────────────────
    # 2) 단일 수정 — update_item (출고완료 화면에서는 비활성)
    # ─────────────────────────────────────────────────────
    async def update_item(
        self,
        *,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        출고 완료 화면에서는 단일 수정 기능을 사용하지 않는다.
        요청 시 명시적으로 비활성 상태를 반환한다.
        """
        raise DomainError(
            "OUTBOUND-DISABLED-403",
            detail="출고 완료 화면에서는 수정 기능이 지원되지 않습니다.",
            ctx={"page_id": PAGE_ID},
        )

    # ─────────────────────────────────────────────────────
    # 3) 출고취소 — cancel_items (한 건 기준, 헤더 단위 롤백)
    # ─────────────────────────────────────────────────────
    async def cancel_items(
        self,
        *,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        출고취소 처리.

        - ids에는 outbound_item.id가 들어온다.
        - 하지만 실제 비즈니스는 "해당 전표(헤더) 전체를 출고취소"로 본다.
          1) 선택된 outbound_item.id → header 찾기
          2) header.status == 'completed' 인지 검증
          3) 해당 header 아래 모든 outbound_item 조회
          4) 재고 롤백:
             - inventory_ledger에 OUTBOUND_CANCEL 이력 추가 (qty_in)
             - stock_current.qty_on_hand += qty
          5) outbound_header.status = 'canceled' 로 변경
        """

        ids: List[int] = payload.get("ids", [])
        reason: Optional[str] = payload.get("reason")

        if not ids:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="ids는 한 개 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID},
            )

        if len(ids) != 1:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="출고취소는 한 번에 한 건(outbound_item 1개 기준)만 처리할 수 있습니다.",
                ctx={"page_id": PAGE_ID, "ids": ids},
            )

        target_item_id = ids[0]

        H = self.models["OutboundHeader"]
        I = self.models["OutboundItem"]
        InventoryLedger = self.models["InventoryLedger"]
        StockCurrent = self.models["StockCurrent"]

        # 1) 선택된 outbound_item 기준으로 header 찾기
        header_stmt = (
            select(
                I.id.label("item_id"),
                H.id.label("header_id"),
                H.status,
                H.order_number,
                H.memo,
            )
            .select_from(I)
            .join(H, I.header_id == H.id)
            .where(
                and_(
                    I.id == target_item_id,
                    H.deleted_at.is_(None),
                    I.deleted_at.is_(None),
                )
            )
        )

        header_result = await self._exec(header_stmt)
        header_row = header_result.first()

        if header_row is None:
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="출고취소 대상 행을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "ids": ids},
            )

        header_id = header_row.header_id
        header_status = header_row.status
        order_number = header_row.order_number
        header_memo = header_row.memo

        # 2) 상태 검증: completed만 취소 가능
        if header_status != "completed":
            raise DomainError(
                "OUTBOUND-STATE-451",
                detail="출고완료 상태가 아닌 전표는 출고취소할 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "header_id": header_id,
                    "status": header_status,
                },
            )

        # 3) 이 헤더 아래 모든 아이템 조회
        items_stmt = (
            select(I.sku, I.qty)
            .where(
                and_(
                    I.header_id == header_id,
                    I.deleted_at.is_(None),
                )
            )
        )
        items_result = await self._exec(items_stmt)
        item_rows = items_result.all()

        if not item_rows:
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="출고취소 대상 품목을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "header_id": header_id},
            )

        # 4) 재고 롤백 처리
        user_id_str = str(self.user.get("user_id", "")) if self.user else None

        # 4-1) 각 SKU별로 stock_current + inventory_ledger 처리
        for sku, qty in item_rows:
            # stock_current 조회
            sc_stmt = select(StockCurrent).where(
                and_(
                    StockCurrent.sku == sku,
                    StockCurrent.deleted_at.is_(None),
                )
            )
            sc_result = await self._exec(sc_stmt)
            stock_row = sc_result.scalar_one_or_none()

            if stock_row is None:
                # 출고완료까지 갔는데 재고행이 없다면 상태 불일치로 본다.
                raise DomainError(
                    "OUTBOUND-STATE-451",
                    detail="재고현황을 찾을 수 없습니다.",
                    ctx={
                        "page_id": PAGE_ID,
                        "header_id": header_id,
                        "sku": sku,
                    },
                )

            # qty_on_hand 복구
            stock_row.qty_on_hand = (stock_row.qty_on_hand or 0) + (qty or 0)

            # total_value 는 last_unit_price 기준으로 재계산 시도
            if stock_row.last_unit_price is not None:
                stock_row.total_value = (
                    stock_row.last_unit_price * stock_row.qty_on_hand
                )

            if user_id_str:
                stock_row.updated_by = user_id_str

            # ledger 보정 이력 추가 (OUTBOUND_CANCEL)
            ledger = InventoryLedger(
                sku=sku,
                event_type="OUTBOUND_CANCEL",
                ref_type="OUTBOUND",
                ref_id=header_id,
                qty_in=qty or 0,
                qty_out=0,
                unit_price=stock_row.last_unit_price,
                memo=f"출고취소 (order_number={order_number})",
                created_by=user_id_str,
                updated_by=user_id_str,
            )
            self.session.add(ledger)

        # 5) outbound_header 상태 변경: completed → canceled
        header_obj_result = await self._exec(
            select(H).where(
                and_(
                    H.id == header_id,
                    H.deleted_at.is_(None),
                )
            )
        )
        header_obj = header_obj_result.scalar_one_or_none()
        if header_obj is None:
            # 위에서 한 번 검증했으므로 이 경우는 이론상 거의 없음
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="출고전표를 다시 조회하는 중에 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "header_id": header_id},
            )

        header_obj.status = "canceled"
        if user_id_str:
            header_obj.updated_by = user_id_str

        # 취소 사유가 있으면 memo에 남긴다.
        if reason:
            base_memo = header_memo or ""
            reason_line = f"[취소사유] {reason}"
            if base_memo:
                header_obj.memo = base_memo + "\n" + reason_line
            else:
                header_obj.memo = reason_line

        # 6) 커밋
        await self._commit()

        return {
            "ids": ids,
            "header_id": header_id,
            "order_number": order_number,
            "item_count": len(item_rows),
            "action": "cancel",
        }

    # ─────────────────────────────────────────────────────
    # 4) 엑셀 내보내기 — export_items (선택 행 xlsx 생성)
    # ─────────────────────────────────────────────────────
    async def export_items(
        self,
        *,
        payload: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        선택 행을 엑셀(xlsx)로 내보내는 기능.
        - ids에 담긴 outbound_item.id 들만 대상으로 한다.
        - 반환값은 프론트에서 다운로드 처리할 수 있도록
          파일명, content_type, base64 인코딩된 내용으로 전달한다.
        """

        ids: List[int] = payload.get("ids", [])
        if not ids:
            raise DomainError(
                "OUTBOUND-VALID-001",
                detail="ids는 한 개 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID},
            )

        H = self.models["OutboundHeader"]
        I = self.models["OutboundItem"]
        P = self.models["Product"]

        # 대상 행 조회 (status=completed + 논리삭제 제외 + 선택된 item_id)
        stmt = (
            select(
                H.id.label("header_id"),
                I.id.label("item_id"),
                H.outbound_date,
                H.country,
                H.order_number,
                H.tracking_number,
                I.sku,
                P.name.label("product_name"),
                I.qty,
                H.weight_g,
                I.sales_total,
            )
            .select_from(I)
            .join(H, I.header_id == H.id)
            .join(P, P.sku == I.sku)
            .where(
                and_(
                    H.status == "completed",
                    H.deleted_at.is_(None),
                    I.deleted_at.is_(None),
                    I.id.in_(ids),
                )
            )
            .order_by(H.outbound_date.desc(), H.id.desc(), I.id.desc())
        )

        result = await self._exec(stmt)
        rows = result.all()

        if not rows:
            raise DomainError(
                "OUTBOUND-NOTFOUND-101",
                detail="엑셀로 내보낼 출고 완료 행을 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "ids": ids},
            )

        # 엑셀 워크북 생성
        try:
            from openpyxl import Workbook  # type: ignore
        except Exception as exc:
            raise DomainError(
                "SYSTEM-UNKNOWN-999",
                detail="엑셀(xlsx) 생성 모듈을 사용할 수 없습니다.",
                ctx={"page_id": PAGE_ID, "exc": repr(exc)},
            )

        wb = Workbook()
        ws = wb.active
        ws.title = "outbound_complete"

        # 헤더 (화면과 동일 순서)
        headers = [
            "출고일자",
            "국가",
            "주문번호",
            "트래킹번호",
            "SKU",
            "상품명",
            "출고수량",
            "중량(g)",
            "총가격",
        ]
        ws.append(headers)

        # 데이터 행
        for row in rows:
            (
                header_id,
                item_id,
                outbound_date,
                country,
                order_number,
                tracking_number,
                sku,
                product_name,
                qty,
                weight_g,
                sales_total,
            ) = row

            ws.append(
                [
                    outbound_date.isoformat() if outbound_date else "",
                    country or "",
                    order_number or "",
                    tracking_number or "",
                    sku or "",
                    product_name or "",
                    qty or 0,
                    weight_g or 0,
                    float(sales_total) if sales_total is not None else 0.0,
                ]
            )

        # 메모리 상에서 xlsx로 저장
        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        content_bytes = buffer.getvalue()
        content_base64 = base64.b64encode(content_bytes).decode("ascii")

        file_name = f"outbound_complete_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"

        return {
            "file_name": file_name,
            "content_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content_base64": content_base64,
            "count": len(rows),
        }
