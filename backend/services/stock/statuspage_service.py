# 📄 backend/services/stock/statuspage_service.py
# 페이지: 재고 현황(StatusPage)
# 역할: 재고 목록 조회, 다건검색, 엑셀 생성, 재고 절대값 조정 (+ 바코드 스캔 단건조회)
# 단계: v1.6 (scan_by_barcode 추가) / 구조 통일 작업지침 v2 적용
#
# ✅ 서비스 원칙
# - 판단/조회/계산/검증/상태변경/트랜잭션/도메인 예외만 담당
# - HTTP 상태, JSON 응답 포맷, Swagger 문서화는 담당하지 않음
# - 문제 발생 시 DomainError(code, detail, ctx, ...)만 던진다.

from __future__ import annotations

from typing import Any, Dict, Optional, List
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
import base64

from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from openpyxl import Workbook

from backend.system.error_codes import DomainError

PAGE_ID = "stock.status"
PAGE_VERSION = "v1.6"


# ─────────────────────────────────────────────────────────
# 내부 유틸 — 세션 어댑터 / 공통 execute
# ─────────────────────────────────────────────────────────
def _get_session_adapter(session: Any) -> Any:
    if isinstance(session, (Session, AsyncSession)):
        return session

    raise DomainError(
        "SYSTEM-DB-901",
        detail="지원하지 않는 DB 세션 타입입니다.",
        ctx={"page_id": PAGE_ID, "session_type": str(type(session))},
    )


async def _execute(session: Any, stmt, params: Optional[Dict[str, Any]] = None):
    params = params or {}
    if isinstance(session, AsyncSession):
        return await session.execute(stmt, params)
    return session.execute(stmt, params)


async def _commit(session: Any) -> None:
    if isinstance(session, AsyncSession):
        await session.commit()
    else:
        session.commit()


async def _rollback(session: Any) -> None:
    if isinstance(session, AsyncSession):
        await session.rollback()
    else:
        session.rollback()


def _get_user_id(user: Dict[str, Any]) -> str:
    val = user.get("user_id")
    if val is None:
        return ""
    return str(val)


# ─────────────────────────────────────────────────────────
# 서비스 결과 모델
# ─────────────────────────────────────────────────────────
@dataclass
class AdjustResult:
    sku: str
    before_qty: int
    after_qty: int
    current_qty: int
    available_qty: int
    last_price: Optional[float]


# ─────────────────────────────────────────────────────────
# 서비스 클래스
# ─────────────────────────────────────────────────────────
class StatusPageService:
    page_id: str = PAGE_ID
    page_version: str = PAGE_VERSION

    def __init__(self, *, session: Any, user: Dict[str, Any]):
        self.session = _get_session_adapter(session)
        self.user = user

    # ─────────────────────────────────────────────────────
    # 내부 헬퍼: 페이지 크기 결정
    # ─────────────────────────────────────────────────────
    async def _resolve_page_size(self, size: int) -> int:
        if size and size > 0:
            return size

        user_id = _get_user_id(self.user)
        page_key = PAGE_ID

        stmt = text(
            """
            SELECT page_size
            FROM user_page_settings
            WHERE user_id = :user_id
              AND page_key = :page_key
              AND deleted_at IS NULL
            """
        )
        result = await _execute(
            self.session,
            stmt,
            {"user_id": user_id, "page_key": page_key},
        )
        row = result.first()
        if row and row[0]:
            return int(row[0])

        return 10

    # ─────────────────────────────────────────────────────
    # 내부 헬퍼: 정렬 기준 검증
    # ─────────────────────────────────────────────────────
    def _resolve_sorting(
        self,
        sort_by: Optional[str],
        order: Optional[str],
    ) -> Dict[str, str]:
        sort_column_map: Dict[str, str] = {
            "sku": "p.sku",
            "name": "p.name",
            "current_qty": "sc.qty_on_hand",
            "available_qty": "sc.qty_on_hand - sc.qty_pending_out",
            "last_price": "sc.last_unit_price",
        }

        sort_key = (sort_by or "sku").lower()
        if sort_key not in sort_column_map:
            raise DomainError(
                "STOCK-VALID-001",
                detail="정렬 기준이 올바르지 않습니다.",
                ctx={"page_id": PAGE_ID, "sort_by": sort_by},
            )

        order_key = (order or "asc").lower()
        if order_key not in ("asc", "desc"):
            raise DomainError(
                "STOCK-VALID-001",
                detail="정렬 방향이 올바르지 않습니다.",
                ctx={"page_id": PAGE_ID, "order": order},
            )

        return {
            "order_by_expr": sort_column_map[sort_key],
            "order_dir": "ASC" if order_key == "asc" else "DESC",
        }

    # ─────────────────────────────────────────────────────
    # 공통 조회 베이스 SQL
    # ─────────────────────────────────────────────────────
    def _base_sql(self) -> str:
        return """
            FROM stock_current sc
            JOIN product p ON p.sku = sc.sku
            WHERE sc.deleted_at IS NULL
              AND p.deleted_at IS NULL
              AND p.is_active = TRUE
              AND (p.is_bundle IS NULL OR p.is_bundle = FALSE)
        """

    # ─────────────────────────────────────────────────────
    # 결과 매핑
    # ─────────────────────────────────────────────────────
    def _map_rows(self, rows) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for r in rows:
            items.append(
                {
                    "sku": r["sku"],
                    "name": r["name"],
                    "current_qty": int(r["current_qty"]) if r["current_qty"] is not None else 0,
                    "available_qty": int(r["available_qty"]) if r["available_qty"] is not None else 0,
                    "last_price": float(r["last_price"]) if r["last_price"] is not None else None,
                }
            )
        return items

    # ─────────────────────────────────────────────────────
    # ✅ NEW) 바코드 스캔 단건 조회 (정확 매칭)
    # ─────────────────────────────────────────────────────
    async def scan_by_barcode(self, *, barcode: str) -> Dict[str, Any]:
        """
        바코드 스캔 전용 단건 조회.
        - barcode를 product.barcode에 '정확히(=)' 매칭
        - 해당 상품의 sku로 stock_current를 조회하여 1건 반환
        """
        b = str(barcode or "").strip()
        if not b:
            raise DomainError(
                "STOCK-VALID-001",
                detail="barcode는 필수입니다.",
                ctx={"page_id": PAGE_ID},
            )

        # product.barcode = :barcode (정확매칭)
        # - 활성/미삭제/비묶음 조건 유지
        # - 재고는 stock_current에서 조인
        stmt = text(
            f"""
            SELECT
                p.sku AS sku,
                p.name AS name,
                sc.qty_on_hand AS current_qty,
                sc.qty_on_hand - sc.qty_pending_out AS available_qty,
                sc.last_unit_price AS last_price
            {self._base_sql()}
              AND p.barcode = :barcode
            LIMIT 1
            """
        )

        try:
            result = await _execute(self.session, stmt, {"barcode": b})
            row = result.mappings().first()
        except Exception as exc:
            raise DomainError(
                "SYSTEM-DB-901",
                detail=str(exc),
                ctx={"page_id": PAGE_ID, "barcode": b},
            )

        if not row:
            raise DomainError(
                "STOCK-NOTFOUND-101",
                detail="해당 바코드로 상품을 찾지 못했어요.",
                ctx={"page_id": PAGE_ID, "barcode": b},
            )

        return {
            "sku": row["sku"],
            "name": row["name"],
            "current_qty": int(row["current_qty"] or 0),
            "available_qty": int(row["available_qty"] or 0),
            "last_price": float(row["last_price"]) if row["last_price"] is not None else None,
        }

    # ─────────────────────────────────────────────────────
    # 1) 재고현황 목록 조회 (단일검색)
    # ─────────────────────────────────────────────────────
    async def list_items(
        self,
        *,
        q: Optional[str],
        page: int,
        size: int,
        sort_by: Optional[str] = "sku",
        order: Optional[str] = "asc",
    ) -> Dict[str, Any]:
        if page <= 0:
            raise DomainError(
                "STOCK-VALID-001",
                detail="페이지 번호는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "page": page},
            )

        size_resolved = await self._resolve_page_size(size)

        sort_info = self._resolve_sorting(sort_by, order)
        offset = (page - 1) * size_resolved

        # ✅ 검색 대상에 barcode 포함(리스트 검색용)
        base_sql = (
            self._base_sql()
            + """
              AND (
                    :q IS NULL
                 OR p.sku ILIKE '%' || :q || '%'
                 OR p.name ILIKE '%' || :q || '%'
                 OR p.barcode ILIKE '%' || :q || '%'
              )
            """
        )

        count_stmt = text(f"SELECT COUNT(*) {base_sql}")
        count_result = await _execute(self.session, count_stmt, {"q": q})
        total = count_result.scalar_one() or 0

        list_sql = f"""
            SELECT
                p.sku,
                p.name,
                sc.qty_on_hand AS current_qty,
                sc.qty_on_hand - sc.qty_pending_out AS available_qty,
                sc.last_unit_price AS last_price
            {base_sql}
            ORDER BY {sort_info["order_by_expr"]} {sort_info["order_dir"]}
            OFFSET :offset
            LIMIT :limit
        """
        list_stmt = text(list_sql)
        rows_result = await _execute(
            self.session,
            list_stmt,
            {"q": q, "offset": offset, "limit": size_resolved},
        )
        rows = rows_result.mappings().all()

        return {
            "items": self._map_rows(rows),
            "count": int(total),
            "page": page,
            "size": size_resolved,
        }

    # ─────────────────────────────────────────────────────
    # 2) 다건검색 — SKU 리스트 전용
    # ─────────────────────────────────────────────────────
    async def list_by_skus(
        self,
        *,
        skus: List[str],
        page: int,
        size: int,
        sort_by: Optional[str] = "sku",
        order: Optional[str] = "asc",
    ) -> Dict[str, Any]:
        if not skus:
            raise DomainError(
                "STOCK-VALID-001",
                detail="SKU 목록이 비어 있습니다.",
                ctx={"page_id": PAGE_ID},
            )

        if page <= 0:
            raise DomainError(
                "STOCK-VALID-001",
                detail="페이지 번호는 1 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "page": page},
            )

        size_resolved = await self._resolve_page_size(size)
        sort_info = self._resolve_sorting(sort_by, order)
        offset = (page - 1) * size_resolved

        base_sql = (
            self._base_sql()
            + """
              AND sc.sku = ANY(:skus)
            """
        )

        count_stmt = text(f"SELECT COUNT(*) {base_sql}")
        count_result = await _execute(self.session, count_stmt, {"skus": skus})
        total = count_result.scalar_one() or 0

        list_sql = f"""
            SELECT
                p.sku,
                p.name,
                sc.qty_on_hand AS current_qty,
                sc.qty_on_hand - sc.qty_pending_out AS available_qty,
                sc.last_unit_price AS last_price
            {base_sql}
            ORDER BY {sort_info["order_by_expr"]} {sort_info["order_dir"]}
            OFFSET :offset
            LIMIT :limit
        """
        list_stmt = text(list_sql)
        rows_result = await _execute(
            self.session,
            list_stmt,
            {"skus": skus, "offset": offset, "limit": size_resolved},
        )
        rows = rows_result.mappings().all()

        return {
            "items": self._map_rows(rows),
            "count": int(total),
            "page": page,
            "size": size_resolved,
        }

    # ─────────────────────────────────────────────────────
    # 3) 엑셀 내보내기 (openpyxl 실제 생성)
    # ─────────────────────────────────────────────────────
    async def export_items(self, *, selected_skus: List[str]) -> Dict[str, Any]:
        """
        선택된 SKU 목록을 기준으로 재고현황 엑셀 생성.
        - 헤더: SKU / 상품명 / 현 재고 / 가용재고
        - 반환: 파일명, content_type, content_base64, count
        """
        if not selected_skus:
            raise DomainError(
                "STOCK-VALID-001",
                detail="선택된 SKU가 없습니다.",
                ctx={"page_id": PAGE_ID},
            )

        base_sql = (
            self._base_sql()
            + """
              AND sc.sku = ANY(:skus)
            """
        )

        list_sql = f"""
            SELECT
                p.sku,
                p.name,
                sc.qty_on_hand AS current_qty,
                sc.qty_on_hand - sc.qty_pending_out AS available_qty
            {base_sql}
            ORDER BY p.sku ASC
        """

        result = await _execute(
            self.session,
            text(list_sql),
            {"skus": selected_skus},
        )
        rows = result.mappings().all()

        if not rows:
            raise DomainError(
                "STOCK-NOTFOUND-101",
                detail="엑셀로 내보낼 재고가 없습니다.",
                ctx={"page_id": PAGE_ID, "skus": selected_skus},
            )

        wb = Workbook()
        ws = wb.active
        ws.title = "재고현황"

        ws.append(["SKU", "상품명", "현 재고", "가용재고"])

        for r in rows:
            ws.append(
                [
                    r["sku"],
                    r["name"],
                    int(r["current_qty"] or 0),
                    int(r["available_qty"] or 0),
                ]
            )

        buf = BytesIO()
        wb.save(buf)
        buf.seek(0)
        content_bytes = buf.read()
        buf.close()

        content_b64 = base64.b64encode(content_bytes).decode("utf-8")

        today_str = datetime.now().strftime("%Y%m%d")
        file_name = f"재고현황_{today_str}.xlsx"
        content_type = (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

        return {
            "file_name": file_name,
            "content_type": content_type,
            "content_base64": content_b64,
            "count": len(rows),
        }

    # ─────────────────────────────────────────────────────
    # 4) 재고 절대값 조정
    # ─────────────────────────────────────────────────────
    async def adjust(self, *, payload: Dict[str, Any]) -> Dict[str, Any]:
        sku = (payload.get("sku") or "").strip()
        final_qty_raw = payload.get("final_qty")
        memo = payload.get("memo")
        user_id = _get_user_id(self.user)

        if not sku:
            raise DomainError(
                "STOCK-VALID-001",
                detail="SKU는 필수입니다.",
                ctx={"page_id": PAGE_ID},
            )

        try:
            final_qty = int(final_qty_raw)
        except Exception:
            raise DomainError(
                "STOCK-VALID-001",
                detail="final_qty는 정수여야 합니다.",
                ctx={"page_id": PAGE_ID, "value": final_qty_raw},
            )

        if final_qty < 0:
            raise DomainError(
                "STOCK-VALID-001",
                detail="최종 재고 수량은 0 이상이어야 합니다.",
                ctx={"page_id": PAGE_ID, "final_qty": final_qty},
            )

        select_stmt = text(
            """
            SELECT
                id,
                sku,
                qty_on_hand,
                qty_reserved,
                qty_pending_out,
                last_unit_price
            FROM stock_current
            WHERE sku = :sku
              AND deleted_at IS NULL
            FOR UPDATE
            """
        )
        result = await _execute(self.session, select_stmt, {"sku": sku})
        row = result.mappings().first()

        if row is None:
            raise DomainError(
                "STOCK-NOTFOUND-101",
                detail="해당 SKU의 재고 정보를 찾을 수 없습니다.",
                ctx={"page_id": PAGE_ID, "sku": sku},
            )

        before_qty = int(row["qty_on_hand"])
        qty_pending_out = int(row["qty_pending_out"])
        last_unit_price = row["last_unit_price"]

        if final_qty < qty_pending_out:
            raise DomainError(
                "STOCK-STATE-451",
                detail="출고 대기수량보다 작은 값으로 재고를 조정할 수 없습니다.",
                ctx={
                    "page_id": PAGE_ID,
                    "sku": sku,
                    "final_qty": final_qty,
                    "qty_pending_out": qty_pending_out,
                },
            )

        delta = final_qty - before_qty
        qty_in = delta if delta > 0 else 0
        qty_out = -delta if delta < 0 else 0

        try:
            insert_ledger_stmt = text(
                """
                INSERT INTO inventory_ledger (
                    sku,
                    event_type,
                    ref_type,
                    ref_id,
                    qty_in,
                    qty_out,
                    unit_price,
                    memo,
                    created_by,
                    updated_by,
                    created_at
                )
                VALUES (
                    :sku,
                    :event_type,
                    :ref_type,
                    :ref_id,
                    :qty_in,
                    :qty_out,
                    :unit_price,
                    :memo,
                    :created_by,
                    :updated_by,
                    NOW()
                )
                """
            )
            await _execute(
                self.session,
                insert_ledger_stmt,
                {
                    "sku": sku,
                    "event_type": "ADJUST",
                    "ref_type": "STOCK",
                    "ref_id": None,
                    "qty_in": qty_in,
                    "qty_out": qty_out,
                    "unit_price": last_unit_price,
                    "memo": memo,
                    "created_by": user_id or None,
                    "updated_by": user_id or None,
                },
            )

            total_value = (
                float(last_unit_price) * float(final_qty)
                if last_unit_price is not None
                else None
            )

            update_stock_stmt = text(
                """
                UPDATE stock_current
                SET
                    qty_on_hand = :final_qty,
                    total_value = :total_value,
                    updated_by = :updated_by,
                    updated_at = NOW()
                WHERE sku = :sku
                  AND deleted_at IS NULL
                """
            )
            await _execute(
                self.session,
                update_stock_stmt,
                {
                    "final_qty": final_qty,
                    "total_value": total_value,
                    "updated_by": user_id or None,
                    "sku": sku,
                },
            )

            await _commit(self.session)

        except DomainError:
            await _rollback(self.session)
            raise
        except Exception as exc:
            await _rollback(self.session)
            raise DomainError(
                "SYSTEM-DB-901",
                detail=str(exc),
                ctx={"page_id": PAGE_ID, "sku": sku},
            )

        available_qty = final_qty - qty_pending_out

        return {
            "sku": sku,
            "before_qty": before_qty,
            "after_qty": final_qty,
            "current_qty": final_qty,
            "available_qty": available_qty,
            "last_price": float(last_unit_price) if last_unit_price is not None else None,
        }
