// src/pages/dashboard/Top10/Top10Page.tsx
// 대시보드 > TOP10 현황
// - FilterBox 숨김(CSS)
// - actions: 연·월 선택 + 키워드 + 적용/초기화/엑셀 내보내기
// - 백엔드 /api/reports/top10/list, /api/reports/top10/export 연동
// - 총 매출 열 제거(출고수량만 표시)
// - 체크박스 컬럼은 재고현황(StatusPage)와 동일한 방식으로 CSS 숨김

import React, { useEffect, useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";
import {
  reportsAdapter,
  type ReportsTop10Item,
} from "@/api/adapters/reports.adapter";
import { handleError } from "@/utils/handleError";

type SortDir = "ASC" | "DESC";

interface SortState {
  key?: string;
  dir?: SortDir;
}

type RowItem = {
  id: string;
  rank: number;
  sku: string;
  name: string;
  shippedQty: number;
};

/* ────────────────────────────────────────────────────────────────
 * 헤더 정의 (총 매출 제거)
 * ────────────────────────────────────────────────────────────────*/
const TABLE_HEADERS = [
  { key: "rank", header: "순위", width: "84px", sortable: false },
  { key: "sku", header: "SKU", width: "300px" },
  { key: "name", header: "상품명", width: "300px" },
  { key: "shippedQty", header: "출고수량", width: "120px" },
] as const;

const SORTABLE_KEYS = new Set<keyof RowItem>(["sku", "name", "shippedQty"]);
const NUMERIC_KEYS = new Set<keyof RowItem>(["shippedQty"]);

const fmt = (v: number) => v.toLocaleString();

/* ────────────────────────────────────────────────────────────────
 * 체크박스/필터박스/정렬아이콘 숨김 스타일
 * ────────────────────────────────────────────────────────────────*/
function Top10Styles() {
  return (
    <style>{`
      .top10-page .noah-tablebase > *:nth-child(2){
        display:none !important;
      }

      .top10-page .cds--table-sort__icon,
      .top10-page .cds--table-sort__icon-unsorted,
      .top10-page .bx--table-sort__icon,
      .top10-page .bx--table-sort__icon--unsorted,
      .top10-page .cds--table-sort__description,
      .top10-page .bx--table-sort__description,
      .top10-page thead th span[aria-hidden="true"]{
        display:none !important;
      }

      .top10-page table col:first-child {
        display: none !important;
      }

      .top10-page .cds--table-column-checkbox,
      .top10-page .bx--table-column-checkbox {
        display: none !important;
      }
    `}</style>
  );
}

/* base64 → 파일 다운로드 */
function downloadBase64File(
  contentBase64: string,
  fileName: string,
  contentType: string
) {
  try {
    const byteCharacters = atob(contentBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const blob = new Blob([new Uint8Array(byteNumbers)], { type: contentType });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("[Top10] 엑셀 다운로드 실패", e);
  }
}

/* ────────────────────────────────────────────────────────────────
 * 메인 컴포넌트
 * ────────────────────────────────────────────────────────────────*/
export default function Top10Page() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [keyword, setKeyword] = useState("");
  const [filter, setFilter] = useState<Record<string, unknown>>({});

  const [items, setItems] = useState<ReportsTop10Item[]>([]);
  const [sort, setSort] = useState<SortState>({
    key: "shippedQty",
    dir: "DESC",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  /* TOP10 조회 */
  const fetchTop10 = async () => {
    const [year, month] = selectedMonth.split("-").map(Number);

    setLoading(true);
    const res = await reportsAdapter.fetchTop10List({
      year,
      month,
      keyword: keyword || undefined,
    });
    setLoading(false);

    if (!res.ok) {
      setItems([]);
      return handleError(res.error);
    }

    setItems(res.data.items ?? []);
    setPage(1);
  };

  /* 초기 진입 시 현재 월 기준 조회 */
  useEffect(() => {
    fetchTop10();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 정렬/페이지 */
  const processed = useMemo(() => {
    let list: RowItem[] = items.map((it) => ({
      id: it.sku,
      rank: 0,
      sku: it.sku,
      name: it.name,
      shippedQty: it.shipped_qty ?? 0,
    }));

    const key = sort.key as keyof RowItem | undefined;
    if (key && SORTABLE_KEYS.has(key)) {
      list = [...list].sort((a, b) => {
        const av = a[key] as any;
        const bv = b[key] as any;

        if (NUMERIC_KEYS.has(key)) {
          const diff = (Number(av) || 0) - (Number(bv) || 0);
          return sort.dir === "DESC" ? -diff : diff;
        }

        const comp = String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "DESC" ? -comp : comp;
      });
    }

    list = list.slice(0, 10);

    const total = list.length;
    const start = (page - 1) * pageSize;
    const sliced = list.slice(start, start + pageSize);

    const rows = sliced.map((r, idx) => ({
      ...r,
      rank: (page - 1) * pageSize + idx + 1,
    }));

    return { total, rows };
  }, [items, sort, page, pageSize]);

  const tableRows = useMemo(
    () =>
      processed.rows.map((r) => ({
        id: r.id,
        rank: r.rank,
        sku: r.sku,
        name: r.name,
        shippedQty: fmt(r.shippedQty),
      })),
    [processed.rows]
  );

  /* 엑셀 내보내기 */
  const handleExportExcel = async () => {
    const [year, month] = selectedMonth.split("-").map(Number);

    const res = await reportsAdapter.exportTop10Excel({
      year,
      month,
      keyword: keyword || undefined,
    });

    if (!res.ok) {
      return handleError(res.error);
    }

    const { file_name, content_type, content_base64 } = res.data;
    downloadBase64File(content_base64, file_name, content_type);
  };

  const handleReset = () => {
    setSelectedMonth(defaultMonth);
    setKeyword("");
    setFilter({});
    setItems([]);
    setPage(1);
  };

  return (
    <div className="p-4 top10-page">
      <Top10Styles />

      <TableBase
        rows={tableRows}
        headers={TABLE_HEADERS as any}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={processed.total}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        sort={sort}
        onSortChange={(next) => {
          setSort(next as SortState);
          setPage(1);
        }}
        filter={filter}
        onFilterChange={(next) => setFilter(next as Record<string, unknown>)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              className="rounded-md border px-2 py-1 text-sm"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            />
            <input
              type="text"
              className="rounded-md border px-2 py-1 text-sm"
              placeholder="SKU, 상품명 검색"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={fetchTop10}
            >
              적용
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleReset}
            >
              초기화
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleExportExcel}
            >
              엑셀 내보내기
            </button>
          </div>
        }
      />
    </div>
  );
}
