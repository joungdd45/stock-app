/**
 * 📄 src/pages/Inbound/Complete/CompletePage.tsx
 * 역할: 입고관리 > 입고 완료 (조회 + 수정/삭제/엑셀 다운로드)
 * - 백엔드 연동:
 *   - GET  /api/inbound/complete/list
 *   - POST /api/inbound/complete/update
 *   - POST /api/inbound/complete/delete
 *   - POST /api/inbound/complete/export-xlsx
 */

import React, { useMemo, useState, useEffect, useCallback } from "react";
import TableBase, { type TableHeaderDef } from "../../../components/common/table/TableBase";
import { inboundAdapter } from "@/api/adapters/inbound.adapter";
import { handleError } from "@/utils/handleError";

// ───────────────────────────────────────────────────────────────
// 정렬/필터 상태 타입
type SortDir = "ASC" | "DESC";
type SortState = { key?: string; dir?: SortDir };

// ✅ FilterBox(FilterValue)와 동일 구조, null 제거
type FilterState = {
  from?: string; // YYYY-MM-DD (또는 undefined)
  to?: string;
  keyword?: string;
};

// 화면용 행 타입
type CompleteRow = {
  id: string; // item_id (string 변환)
  date: string; // 입고일 (YYYY-MM-DD 또는 "")
  sku: string; // SKU
  name: string; // 상품명
  quantity: number; // 입고 수량
  totalPrice: number; // 총 단가(총액, number)
  unitPrice: number; // 개당 단가(number, total/qty)
  supplier: string; // 입고처
};

// 테이블 헤더
const HEADERS: TableHeaderDef[] = [
  { key: "date", header: "입고일", width: "10rem", sortable: true },
  { key: "sku", header: "SKU", width: "16rem", sortable: true },
  { key: "name", header: "상품명", width: "1fr", sortable: true },
  { key: "quantity", header: "입고 수량", width: "8rem", sortable: true },
  { key: "totalPrice", header: "총 단가", width: "10rem", sortable: true },
  { key: "unitPrice", header: "개당 단가", width: "10rem", sortable: true },
  { key: "supplier", header: "입고처", width: "10rem", sortable: true },
];

// 포맷터
const fmtInt = (n: number) => n.toLocaleString("ko-KR");
const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("ko-KR", {
    maximumFractionDigits: 0,
  }).format(n);

// ✅ 원화 표시(화면 전용)
const fmtWon = (n: number) => `₩ ${fmtCurrency(n)}`;

// 백엔드 → 화면용 매핑
const mapFromApi = (item: {
  item_id: number;
  inbound_date: string | null;
  sku: string;
  product_name: string;
  qty: number;
  total_price: string;
  unit_price: string;
  supplier_name: string;
}): CompleteRow => {
  const qty = item.qty ?? 0;
  const total = Number(item.total_price ?? 0);
  const unit = qty > 0 ? total / qty : Number(item.unit_price ?? 0) || 0;

  return {
    id: String(item.item_id),
    date: item.inbound_date ?? "",
    sku: item.sku,
    name: item.product_name,
    quantity: qty,
    totalPrice: total,
    unitPrice: unit,
    supplier: item.supplier_name,
  };
};

// ───────────────────────────────────────────────────────────────
export default function CompletePage() {
  // 페이지네이션/정렬/필터
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [total, setTotal] = useState(0);
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "DESC" });
  const [filter, setFilter] = useState<FilterState>({});

  // 실제 페이지 단위 데이터(백엔드에서 받은 rows)
  const [rawRows, setRawRows] = useState<CompleteRow[]>([]);
  const [loading, setLoading] = useState(false);

  // 선택된 item_id 목록 (string)
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // 수정 모달 상태
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<CompleteRow | null>(null);

  // ──────────────────────
  // 목록 조회
  // ──────────────────────
  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      // ✅ 여기에서만 undefined → null 로 변환해서 백엔드에 전달
      const params = {
        start_date: filter.from ? filter.from : null,
        end_date: filter.to ? filter.to : null,
        keyword: filter.keyword ? filter.keyword : null,
        page,
        size: pageSize,
      };

      const res = await inboundAdapter.completeList(params);
      if (!res.ok) {
        console.error("[InboundComplete] list error", res.error);
        if (res.error) handleError(res.error);
        setRawRows([]);
        setTotal(0);
        return;
      }

      const result = res.data;
      const items = (result?.items ?? []).map(mapFromApi);
      setRawRows(items);
      setTotal(result?.count ?? 0);
    } catch (e) {
      console.error("[InboundComplete] list exception", e);
      // 예외는 공통 코드가 아니라서 일반 메시지 유지
      window.alert("입고완료 목록 조회 중 예기치 못한 오류가 발생했습니다.");
      setRawRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setSelectedIds([]); // 조회할 때마다 선택 초기화
    }
  }, [filter.from, filter.to, filter.keyword, page, pageSize]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  // ──────────────────────
  // 정렬 + 표시용 가공
  // ──────────────────────
  const sortedRows = useMemo(() => {
    if (!sort.key) return rawRows;
    const dir = sort.dir === "DESC" ? -1 : 1;
    return [...rawRows].sort((a: any, b: any) => {
      const ak = a[sort.key!];
      const bk = b[sort.key!];
      if (ak === bk) return 0;
      return ak > bk ? dir : -dir;
    });
  }, [rawRows, sort]);

  // ✅ 화면 표시: totalPrice/unitPrice에 원화 표시
  const displayRows = useMemo(
    () =>
      sortedRows.map((r) => ({
        ...r,
        quantity: fmtInt(r.quantity),
        totalPrice: fmtWon(r.totalPrice),
        unitPrice: fmtWon(r.unitPrice),
      })),
    [sortedRows],
  );

  // ──────────────────────
  // 선택된 행 기반 헬퍼
  // ──────────────────────
  const getSingleSelectedRow = (): CompleteRow | null => {
    if (selectedIds.length !== 1) return null;
    const id = selectedIds[0];
    return rawRows.find((r) => r.id === id) ?? null;
  };

  const getSelectedItemIds = (): number[] => {
    return selectedIds
      .map((id) => Number(id))
      .filter((n) => Number.isFinite(n) && n > 0);
  };

  // ──────────────────────
  // 이벤트 핸들러: 수정/삭제/엑셀
  // ──────────────────────
  const handleOpenEdit = () => {
    if (selectedIds.length === 0) {
      window.alert("수정할 입고완료 항목을 선택해 주세요.");
      return;
    }
    if (selectedIds.length > 1) {
      window.alert("수정은 한 번에 1건만 가능합니다. 1건만 선택해 주세요.");
      return;
    }

    const target = getSingleSelectedRow();
    if (!target) {
      window.alert("선택한 항목을 찾을 수 없습니다.");
      return;
    }

    setEditForm({ ...target });
    setIsEditOpen(true);
  };

  const handleDelete = async () => {
    const itemIds = getSelectedItemIds();
    if (itemIds.length === 0) {
      window.alert("삭제할 입고완료 항목을 선택해 주세요.");
      return;
    }

    const ok = window.confirm(`선택한 ${itemIds.length}건의 입고완료 내역을 삭제할까요?`);
    if (!ok) return;

    try {
      const res = await inboundAdapter.completeDelete({ item_ids: itemIds });
      if (!res.ok) {
        console.error("[InboundComplete] delete error", res.error);
        if (res.error) handleError(res.error);
        return;
      }

      await loadList();
    } catch (e) {
      console.error("[InboundComplete] delete exception", e);
      window.alert("입고완료 내역 삭제 중 예기치 못한 오류가 발생했습니다.");
    }
  };

  // 수정 폼 입력 핸들러
  const handleEditChange = (field: keyof CompleteRow, value: string) => {
    if (!editForm) return;

    // 수량/금액/단가 숫자 입력
    if (field === "quantity" || field === "totalPrice" || field === "unitPrice") {
      // ✅ ₩, 콤마, 공백 제거
      const num = value === "" ? 0 : Number(value.replace(/[₩, ]/g, ""));
      if (Number.isNaN(num)) return;

      let nextQuantity = editForm.quantity;
      let nextTotal = editForm.totalPrice;

      if (field === "quantity") {
        nextQuantity = num;
      } else if (field === "totalPrice") {
        nextTotal = num;
      }

      let nextUnit = editForm.unitPrice;
      if (nextQuantity > 0) {
        nextUnit = Math.floor(nextTotal / nextQuantity);
      }

      setEditForm({
        ...editForm,
        quantity: nextQuantity,
        totalPrice: nextTotal,
        unitPrice: nextUnit,
      });
      return;
    }

    setEditForm({ ...editForm, [field]: value });
  };

  const handleEditSave = async () => {
    if (!editForm) return;

    const itemIdNum = Number(editForm.id);
    if (!Number.isFinite(itemIdNum) || itemIdNum <= 0) {
      window.alert("수정 대상 ID가 올바르지 않습니다.");
      return;
    }

    const payload = {
      item_id: itemIdNum,
      qty: editForm.quantity,
      total_price: editForm.totalPrice,
      inbound_date: editForm.date || undefined,
      supplier_name: editForm.supplier || undefined,
    };

    try {
      const res = await inboundAdapter.completeUpdate(payload);
      if (!res.ok) {
        console.error("[InboundComplete] update error", res.error);
        if (res.error) handleError(res.error);
        return;
      }

      setIsEditOpen(false);
      await loadList();
    } catch (e) {
      console.error("[InboundComplete] update exception", e);
      window.alert("입고완료 내역 수정 중 예기치 못한 오류가 발생했습니다.");
    }
  };

  const handleEditCancel = () => {
    setIsEditOpen(false);
  };

  const handleExportXlsx = async () => {
    const itemIds = getSelectedItemIds();
    if (itemIds.length === 0) {
      window.alert("엑셀로 내보낼 입고완료 항목을 선택해 주세요.");
      return;
    }

    try {
      const res = await inboundAdapter.completeExportXlsx({ item_ids: itemIds });
      if (!res.ok) {
        console.error("[InboundComplete] export-xlsx error", res.error);
        if (res.error) handleError(res.error);
        return;
      }

      console.log("[InboundComplete] export-xlsx result (for reference)", res.data);
      window.alert(
        "엑셀 다운로드 요청이 완료되었습니다. (파일 저장 방식은 추후 구현 예정입니다.)",
      );
    } catch (e) {
      console.error("[InboundComplete] export-xlsx exception", e);
      window.alert("엑셀 다운로드 처리 중 예기치 못한 오류가 발생했습니다.");
    }
  };

  // ────────────────────────────────────────────────────────────
  // 우측 액션 버튼
  // ────────────────────────────────────────────────────────────
  const actions = (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <button
        className="rounded-xl px-4 py-2 text-sm bg-gray-900 text-white hover:bg-black"
        onClick={handleOpenEdit}
        disabled={loading}
      >
        수정
      </button>

      <button
        className="rounded-xl px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700"
        onClick={handleDelete}
        disabled={loading}
      >
        삭제
      </button>

      <button
        className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
        onClick={handleExportXlsx}
        disabled={loading}
      >
        엑셀 다운로드
      </button>

      <button
        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        onClick={() => {
          // 열 보이기 토글은 컬럼 설정 기능 확정 후 구현
        }}
      >
        열 보이기
      </button>
    </div>
  );

  // ────────────────────────────────────────────────────────────
  return (
    <div className="p-4 flex flex-col gap-3">
      <h2 className="text-base font-semibold">입고관리 - 입고 완료</h2>

      <TableBase
        headers={HEADERS}
        rows={displayRows}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(ps) => {
          setPageSize(ps);
          setPage(1);
        }}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
        }}
        filter={filter}
        onFilterChange={(v) => {
          setFilter(v as FilterState);
          setPage(1);
        }}
        actions={actions}
        onSelectionChange={(ids) => setSelectedIds(ids)}
      />

      {isEditOpen && editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold">입고 완료 내역 수정</h3>

            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              {/* 입고일 */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">입고일</label>
                <input
                  type="date"
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                  value={editForm.date}
                  onChange={(e) => handleEditChange("date", e.target.value)}
                />
              </div>

              {/* SKU (읽기 전용) */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">SKU</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm bg-gray-50"
                  value={editForm.sku}
                  readOnly
                />
              </div>

              {/* 상품명 (읽기 전용) */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">상품명</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm bg-gray-50"
                  value={editForm.name}
                  readOnly
                />
              </div>

              {/* 입고 수량 */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">입고 수량</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm text-right"
                  value={fmtInt(editForm.quantity)}
                  onChange={(e) => handleEditChange("quantity", e.target.value)}
                />
              </div>

              {/* 총 단가 */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">총 단가</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm text-right"
                  value={fmtWon(editForm.totalPrice)}
                  onChange={(e) => handleEditChange("totalPrice", e.target.value)}
                />
              </div>

              {/* 개당 단가 */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">개당 단가</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm text-right"
                  value={fmtWon(editForm.unitPrice)}
                  onChange={(e) => handleEditChange("unitPrice", e.target.value)}
                />
              </div>

              {/* 입고처 */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">입고처</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                  value={editForm.supplier}
                  onChange={(e) => handleEditChange("supplier", e.target.value)}
                />
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
                onClick={handleEditCancel}
              >
                취소
              </button>
              <button
                className="rounded-xl bg-gray-900 px-4 py-2 text-sm text-white hover:bg-black"
                onClick={handleEditSave}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
