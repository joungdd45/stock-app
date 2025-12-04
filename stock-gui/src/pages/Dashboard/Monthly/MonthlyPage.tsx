// src/pages/dashboard/Monthly/MonthlyPage.tsx
// 대시보드 > 월간 현황
// - FilterBox 숨김(CSS)
// - actions: 월 선택 + 적용/초기화/엑셀 내보내기
// - 선택 월 기준으로 조회
// - 매출 컬럼 제거
// - 체크박스 컬럼은 재고현황(StatusPage)와 동일한 방식으로 CSS 숨김

import React, { useEffect, useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";
import {
  reportsAdapter,
  type ReportsMonthlyItem,
  type ReportsMonthlyExcelResult,
} from "@/api/adapters/reports.adapter";
import { handleError } from "@/utils/handleError";

type SortDir = "ASC" | "DESC";

type FilterState = {
  from?: string;
  to?: string;
};

type TableRow = {
  id: string;
  rank: number;
  sku: string;
  name: string;
  shippedQty: string;
};

const TABLE_HEADERS = [
  { key: "rank", header: "순위", width: "84px", sortable: false },
  { key: "sku", header: "SKU", width: "300px" },
  { key: "name", header: "상품명", width: "300px" },
  { key: "shippedQty", header: "출고수량", width: "120px" },
] as const;

const fmt = (v: number) => v.toLocaleString();
const dim = (y: number, m: number) => new Date(y, m, 0).getDate();

/* ────────────────────────────────────────────────
 * 이 페이지 전용 스타일
 * ────────────────────────────────────────────────*/
function MonthlyStyles() {
  return (
    <style>{`
      .monthly-page .noah-tablebase > *:nth-child(2){
        display:none !important;
      }

      .monthly-page .cds--table-sort__icon,
      .monthly-page .cds--table-sort__icon-unsorted,
      .monthly-page .bx--table-sort__icon,
      .monthly-page .bx--table-sort__icon--unsorted,
      .monthly-page .cds--table-sort__description,
      .monthly-page .bx--table-sort__description,
      .monthly-page thead th span[aria-hidden="true"]{
        display:none !important;
      }

      .monthly-page table col:first-child {
        display: none !important;
      }

      .monthly-page .cds--table-column-checkbox,
      .monthly-page .bx--table-column-checkbox {
        display: none !important;
      }
    `}</style>
  );
}

/* ────────────────────────────────────────────────
 * base64 엑셀 다운로드
 * ────────────────────────────────────────────────*/
function downloadBase64File(file: ReportsMonthlyExcelResult) {
  try {
    const byteChars = atob(file.content_base64);
    const len = byteChars.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = byteChars.charCodeAt(i);
    }

    const blob = new Blob([bytes], { type: file.content_type });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = file.file_name || "monthly_report.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("[Monthly] 엑셀 다운로드 실패", e);
    alert("엑셀 파일을 저장하는 중 오류가 발생했습니다.");
  }
}

/* ────────────────────────────────────────────────
 * 메인 컴포넌트
 * ────────────────────────────────────────────────*/
export default function MonthlyPage() {
  const today = new Date();
  const defaultMonthStr = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  // 화면 상단 month input
  const [selectedMonth, setSelectedMonth] = useState(defaultMonthStr);

  // TableBase용 필터(from/to) – UI 표현용
  const [filter, setFilter] = useState<FilterState>({});

  // 실제 API 호출용 year/month
  const [queryYear, setQueryYear] = useState(today.getFullYear());
  const [queryMonth, setQueryMonth] = useState(today.getMonth() + 1);

  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({
    key: "shippedQty",
    dir: "DESC",
  });

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [items, setItems] = useState<ReportsMonthlyItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  /* ─────────────────────────────────────────────
   * 서버에서 월간현황 조회
   * ───────────────────────────────────────────── */
  const fetchMonthly = async () => {
    setLoading(true);
    const res = await reportsAdapter.fetchMonthlyList({
      year: queryYear,
      month: queryMonth,
      page,
      size: pageSize,
    });

    if (!res.ok || !res.data) {
      setItems([]);
      setTotalCount(0);
      setLoading(false);
      return handleError(res.error);
    }

    setItems(res.data.items ?? []);
    setTotalCount(res.data.count ?? 0);
    setLoading(false);
  };

  useEffect(() => {
    fetchMonthly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryYear, queryMonth, page, pageSize]);

  /* ─────────────────────────────────────────────
   * 액션: 적용 / 초기화 / 엑셀
   * ───────────────────────────────────────────── */
  const applyMonth = () => {
    const [yStr, mStr] = selectedMonth.split("-");
    const year = Number(yStr);
    const month = Number(mStr);
    if (!year || !month) {
      alert("올바른 년·월을 선택해 주세요.");
      return;
    }

    // TableBase 필터(from/to) 갱신 – 표시용
    const last = dim(year, month);
    const mm = String(month).padStart(2, "0");
    setFilter({
      from: `${year}-${mm}-01`,
      to: `${year}-${mm}-${String(last).padStart(2, "0")}`,
    });

    // 실제 조회용 쿼리
    setQueryYear(year);
    setQueryMonth(month);
    setPage(1);
  };

  const resetAll = () => {
    const [yStr, mStr] = defaultMonthStr.split("-");
    const year = Number(yStr);
    const month = Number(mStr);

    setSelectedMonth(defaultMonthStr);
    setFilter({});
    setQueryYear(year);
    setQueryMonth(month);
    setPage(1);
  };

  const handleExport = async () => {
    const res = await reportsAdapter.exportMonthlyExcel({
      year: queryYear,
      month: queryMonth,
    });

    if (!res.ok || !res.data) {
      return handleError(res.error);
    }

    downloadBase64File(res.data);
  };

  /* ─────────────────────────────────────────────
   * 테이블 표현용 가공 (순위 계산)
   * ───────────────────────────────────────────── */
  const tableRows: TableRow[] = useMemo(() => {
    return items.map((item, idx) => ({
      id: `${item.sku}-${idx}`,
      rank: (page - 1) * pageSize + idx + 1,
      sku: item.sku,
      name: item.name,
      shippedQty: fmt(item.shipped_qty),
    }));
  }, [items, page, pageSize]);

  return (
    <div className="p-4 monthly-page">
      <MonthlyStyles />

      <TableBase
        rows={tableRows}
        headers={TABLE_HEADERS as any}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={totalCount}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          setPage(1);
        }}
        filter={filter}
        onFilterChange={() => {}}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="month"
              className="rounded-md border px-2 py-1 text-sm"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            />
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={applyMonth}
            >
              적용
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={resetAll}
            >
              초기화
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleExport}
            >
              엑셀 내보내기
            </button>
          </div>
        }
      />
    </div>
  );
}
