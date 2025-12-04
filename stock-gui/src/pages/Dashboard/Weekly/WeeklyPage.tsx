// src/pages/dashboard/Weekly/WeeklyPage.tsx
// 대시보드 > 주간 현황
// - FilterBox 완전 숨김(CSS) + actions에 월/주/적용/초기화/엑셀 버튼
// - 선택 월·주 기준으로 백엔드 /api/reports/weekly 호출
// - 응답 range_from/range_to를 from/to로 매핑
// - 총 매출 열 제거
// - 체크박스 컬럼은 Stock Status와 동일하게 CSS로 완전 숨김

import React, { useEffect, useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";
import {
  reportsAdapter,
  type ReportsWeeklyItem,
  type ReportsWeeklyListResult,
} from "@/api/adapters/reports.adapter";
import { handleError } from "@/utils/handleError";

type SortDir = "ASC" | "DESC";
type FilterState = { from?: string; to?: string };

const TABLE_HEADERS = [
  { key: "rank", header: "순위", width: "84px", sortable: false },
  { key: "sku", header: "SKU", width: "300px" },
  { key: "name", header: "상품명", width: "300px" },
  { key: "shippedQty", header: "출고수량", width: "120px" },
] as const;

/* ────────────────────────────────────────────────────────────────
 * 이 페이지 전용 스타일 (체크박스 컬럼 제거 + FilterBox/정렬아이콘 숨김)
 * ────────────────────────────────────────────────────────────────*/
function WeeklyStyles() {
  return (
    <style>{`
      /* TableBase 자식 순서상 2번째가 FilterBox → 숨김 */
      .weekly-page .noah-tablebase > *:nth-child(2){
        display:none !important;
      }

      /* 정렬 아이콘/설명 + 커스텀 ▲▼ 텍스트 숨김 */
      .weekly-page .cds--table-sort__icon,
      .weekly-page .cds--table-sort__icon-unsorted,
      .weekly-page .bx--table-sort__icon,
      .weekly-page .bx--table-sort__icon--unsorted,
      .weekly-page .cds--table-sort__description,
      .weekly-page .bx--table-sort__description,
      .weekly-page thead th span[aria-hidden="true"]{
        display:none !important;
      }

      /* ✅ Stock Status와 동일한 방식으로 체크박스 컬럼 제거 */
      .weekly-page table col:first-child {
        display: none !important;
      }

      .weekly-page .cds--table-column-checkbox,
      .weekly-page .bx--table-column-checkbox {
        display: none !important;
      }
    `}</style>
  );
}

/* 숫자 포맷 공통 헬퍼 */
const formatNumber = (v?: number | null) => (v ?? 0).toLocaleString();

/* ────────────────────────────────────────────────────────────────
 * 메인 컴포넌트
 * ────────────────────────────────────────────────────────────────*/
export default function WeeklyPage() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedWeek, setSelectedWeek] = useState(1);

  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({
    key: "shippedQty",
    dir: "DESC",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [loading, setLoading] = useState(false);

  const [result, setResult] = useState<ReportsWeeklyListResult | null>(null);

  const filter: FilterState = useMemo(
    () =>
      result
        ? {
            from: result.range_from,
            to: result.range_to,
          }
        : {},
    [result]
  );

  const items: ReportsWeeklyItem[] = result?.items ?? [];
  const total = result?.total ?? 0;

  const buildParams = (override?: {
    year?: number;
    month?: number;
    week?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const [yStr, mStr] = selectedMonth.split("-");
    const base = {
      year: Number(override?.year ?? Number(yStr)),
      month: Number(override?.month ?? Number(mStr)),
      week: Number(override?.week ?? selectedWeek),
      page: Number(override?.page ?? page),
      pageSize: Number(override?.pageSize ?? pageSize),
    };
    return base;
  };

  const fetchWeekly = async (override?: {
    year?: number;
    month?: number;
    week?: number;
    page?: number;
    pageSize?: number;
  }) => {
    const params = buildParams(override);

    setLoading(true);
    const res = await reportsAdapter.fetchWeeklyList({
      year: params.year,
      month: params.month,
      week: params.week,
      page: params.page,
      page_size: params.pageSize,
      sort: "qty_desc", // 기본: 출고수량 내림차순
    });

    if (!res.ok || !res.data) {
      setResult(null);
      setLoading(false);
      return handleError(res.error);
    }

    setResult(res.data);
    setPage(params.page);
    setPageSize(params.pageSize);
    setLoading(false);
  };

  const handleApply = () => {
    // 선택된 월/주 기준으로 1페이지부터 재조회
    fetchWeekly({ page: 1 });
  };

  const handleReset = () => {
    const resetMonth = defaultMonth;
    const resetWeek = 1;
    const [yStr, mStr] = resetMonth.split("-");

    setSelectedMonth(resetMonth);
    setSelectedWeek(resetWeek);
    setPage(1);
    setPageSize(10);

    fetchWeekly({
      year: Number(yStr),
      month: Number(mStr),
      week: resetWeek,
      page: 1,
      pageSize: 10,
    });
  };

  const handleExport = async () => {
    const params = buildParams({});

    const res = await reportsAdapter.exportWeeklyExcel({
      year: params.year,
      month: params.month,
      week: params.week,
      query: undefined,
      page: undefined,
      page_size: undefined,
      sort: "qty_desc",
    });

    if (!res.ok) {
      return handleError(res.error);
    }

    // 실제 파일 다운로드 처리는 apiHub/인터셉터 쪽에서 담당한다고 가정
    alert("주간 현황 엑셀 내보내기를 시작했습니다.");
  };

  // 첫 진입 시 기본 월/1주 기준 조회
  useEffect(() => {
    fetchWeekly();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tableRows = useMemo(
    () =>
      items.map((item, idx) => ({
        id: `${item.sku}-${idx}`,
        rank: (page - 1) * pageSize + idx + 1,
        sku: item.sku,
        name: item.name,
        shippedQty: formatNumber(item.shipped_qty),
      })),
    [items, page, pageSize]
  );

  return (
    <div className="p-4 weekly-page">
      <WeeklyStyles />

      <TableBase
        rows={tableRows}
        headers={TABLE_HEADERS as any}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={(nextPage: number) => {
          setPage(nextPage);
          fetchWeekly({ page: nextPage });
        }}
        onPageSizeChange={(nextSize: number) => {
          setPage(1);
          setPageSize(nextSize);
          fetchWeekly({ page: 1, pageSize: nextSize });
        }}
        sort={sort}
        onSortChange={(next) => {
          setSort(next);
          // 정렬은 일단 프론트만 사용 (백엔드 sort는 qty_desc 고정)
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
            <select
              className="rounded-md border px-2 py-1 text-sm"
              value={selectedWeek}
              onChange={(e) => setSelectedWeek(Number(e.target.value))}
            >
              <option value={1}>1주</option>
              <option value={2}>2주</option>
              <option value={3}>3주</option>
              <option value={4}>4주</option>
              <option value={5}>5주</option>
              <option value={6}>6주</option>
            </select>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={handleApply}
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
