/**
 * 📄 src/pages/Inbound/Complete/CompletePage.tsx
 * 역할: 입고관리 > 입고 완료 (조회 + 수정/삭제/엑셀 다운로드)
 * UI: RegisterQueryPage 스타일과 동일한 버튼 디자인(rounded-xl 등)
 *
 * 참고:
 * - 현재 TableBase에 선택 콜백이 없어 실제 선택행 정보는 받을 수 없음.
 * - 지금은 테스트용으로 "현재 페이지의 첫 번째 행"을 기준으로 수정/삭제 처리.
 * - [DUMMY START] to [DUMMY END] 더미 블록은 API 연동 시 통째로 교체.
 */

import React, { useMemo, useState } from "react";
import TableBase, { type TableHeaderDef } from "../../../components/common/table/TableBase";

// ───────────────────────────────────────────────────────────────
// 정렬/필터 상태 타입
type SortDir = "ASC" | "DESC";
type SortState = { key?: string; dir?: SortDir };

// 데이터 타입
type CompleteRow = {
  id: string;
  date: string;        // 입고일
  sku: string;         // SKU
  name: string;        // 상품명
  quantity: number;    // 입고 수량
  totalPrice: number;  // 총 단가(총액)
  unitPrice: number;   // 개당 단가
  supplier: string;    // 입고처
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
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n);

// ⛳ 더미 데이터 원본
// ======================= [DUMMY START] =======================
const DUMMY_ROWS: CompleteRow[] = [
  {
    id: "done-003",
    date: "2025-10-22",
    sku: "SN_MINIYAKGWA_03",
    name: "삼립 미니약과 (3봉)",
    quantity: 5,
    totalPrice: 42500,
    unitPrice: 8500,
    supplier: "삼립",
  },
  {
    id: "done-002",
    date: "2025-10-21",
    sku: "FD_BULDAK_200",
    name: "불닭볶음면 200g",
    quantity: 10,
    totalPrice: 150000,
    unitPrice: 15000,
    supplier: "삼양식품",
  },
  {
    id: "done-001",
    date: "2025-10-20",
    sku: "FD_MAXIM_001",
    name: "맥심 모카골드 100T",
    quantity: 3,
    totalPrice: 39000,
    unitPrice: 13000,
    supplier: "동진상회",
  },
];
// ======================== [DUMMY END] ========================

// ───────────────────────────────────────────────────────────────
export default function CompletePage() {
  // 페이지네이션/정렬/필터
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortState>({ key: "date", dir: "DESC" });
  const [filter, setFilter] = useState<Record<string, any>>({});

  // 실제 화면 데이터
  const [data, setData] = useState<CompleteRow[]>(DUMMY_ROWS);

  // 수정 모달 상태
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState<CompleteRow | null>(null);

  const loading = false;

  // 정렬
  const sorted = useMemo(() => {
    if (!sort.key) return data;
    const dir = sort.dir === "DESC" ? -1 : 1;
    return [...data].sort((a: any, b: any) => {
      const ak = a[sort.key!];
      const bk = b[sort.key!];
      if (ak === bk) return 0;
      return ak > bk ? dir : -dir;
    });
  }, [data, sort]);

  // 페이징
  const total = sorted.length;
  const start = (page - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  // 표시용 가공
  const rows = useMemo(
    () =>
      pageRows.map((r) => ({
        ...r,
        quantity: fmtInt(r.quantity),
        totalPrice: fmtCurrency(r.totalPrice),
        unitPrice: fmtCurrency(r.unitPrice),
      })),
    [pageRows]
  );

  // ──────────────────────
  // 이벤트 핸들러: 수정/삭제
  // ──────────────────────
  const handleOpenEdit = () => {
    if (pageRows.length === 0) {
      window.alert("수정할 항목이 없습니다.");
      return;
    }

    // TODO: TableBase 선택 연동 전까지는 첫 번째 행 기준
    const target = pageRows[0];
    setEditForm({ ...target });
    setIsEditOpen(true);
  };

  const handleDelete = () => {
    if (pageRows.length === 0) {
      window.alert("삭제할 항목이 없습니다.");
      return;
    }

    // TODO: TableBase 선택 연동 전까지는 첫 번째 행 기준
    const target = pageRows[0];

    const ok = window.confirm(
      `현재 페이지의 첫 번째 항목\n[${target.date}] ${target.sku}를 삭제할까요?`
    );
    if (!ok) return;

    setData((prev) => prev.filter((row) => row.id !== target.id));
  };

  const handleEditChange = (field: keyof CompleteRow, value: string) => {
    if (!editForm) return;

    if (field === "quantity" || field === "totalPrice" || field === "unitPrice") {
      const num = value === "" ? 0 : Number(value.replace(/[, ]/g, ""));
      if (Number.isNaN(num)) return;
      setEditForm({ ...editForm, [field]: num });
      return;
    }

    setEditForm({ ...editForm, [field]: value });
  };

  const handleEditSave = () => {
    if (!editForm) return;

    setData((prev) =>
      prev.map((row) => (row.id === editForm.id ? { ...editForm } : row))
    );
    setIsEditOpen(false);
  };

  const handleEditCancel = () => {
    setIsEditOpen(false);
  };

  // ────────────────────────────────────────────────────────────
  // 우측 액션 버튼
  // ────────────────────────────────────────────────────────────
  const actions = (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <button
        className="rounded-xl px-4 py-2 text-sm bg-gray-900 text-white hover:bg-black"
        onClick={handleOpenEdit}
      >
        수정
      </button>

      <button
        className="rounded-xl px-4 py-2 text-sm bg-red-600 text-white hover:bg-red-700"
        onClick={handleDelete}
      >
        삭제
      </button>

      <button
        className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
        onClick={() => {
          // TODO: onDownloadCSV
        }}
      >
        다운로드(CSV)
      </button>

      <button
        className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
        onClick={() => {
          // TODO: toggle column menu
        }}
      >
        열 보이기
      </button>
    </div>
  );

  // ────────────────────────────────────────────────────────────
  return (
    <div className="p-4 flex flex-col gap-3">
      {/* 상단 제목(셸에서 넣지 않았다면 노출) */}
      <h2 className="text-base font-semibold">입고관리 - 입고 완료</h2>

      <TableBase
        headers={HEADERS}
        rows={rows}
        loading={loading}
        // 페이지네이션
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(p) => setPage(p)}
        onPageSizeChange={(ps) => {
          setPageSize(ps);
          setPage(1);
        }}
        // 정렬
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        // 필터
        filter={filter}
        onFilterChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
        // 툴바 우측 액션
        actions={actions}
      />

      {/* 수정 모달 */}
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

              {/* SKU */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">SKU</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                  value={editForm.sku}
                  onChange={(e) => handleEditChange("sku", e.target.value)}
                />
              </div>

              {/* 상품명 */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">상품명</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                  value={editForm.name}
                  onChange={(e) => handleEditChange("name", e.target.value)}
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
                  value={fmtCurrency(editForm.totalPrice)}
                  onChange={(e) => handleEditChange("totalPrice", e.target.value)}
                />
              </div>

              {/* 개당 단가 */}
              <div className="flex items-center gap-3">
                <label className="w-24 text-sm text-gray-600">개당 단가</label>
                <input
                  type="text"
                  className="flex-1 rounded-md border px-3 py-2 text-sm text-right"
                  value={fmtCurrency(editForm.unitPrice)}
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
