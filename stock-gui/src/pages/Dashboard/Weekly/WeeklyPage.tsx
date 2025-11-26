// src/pages/dashboard/Weekly/WeeklyPage.tsx
// 대시보드 > 주간 현황
// - FilterBox 완전 숨김(CSS) + actions에 월/주/적용/초기화/엑셀 버튼
// - 선택 월·주를 from/to로 매핑
// - 총 매출 열 제거
// - 체크박스 컬럼은 Stock Status와 동일하게 CSS로 완전 숨김

import React, { useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";

type SortDir = "ASC" | "DESC";
type SalesRow = { date: string; sku: string; name: string; qty: number; revenue: number };
type AggRow = { id: string; sku: string; name: string; shippedQty: number; revenue: number };
type FilterState = { from?: string; to?: string };

/* ────────────────────────────────────────────────────────────────
 * 더미 데이터
 * ────────────────────────────────────────────────────────────────*/
const SALES: SalesRow[] = [
  { date: "2025-10-01", sku: "FD_OTTO_JINRAMYEON01EA", name: "오뚜기 진라면 순한맛 120g", qty: 40, revenue: 216000 },
  { date: "2025-10-03", sku: "FD_SAMY_BULDAKSA02_HAKBUL0200_01EA", name: "삼양 불닭사리 핵불닭 200g", qty: 22, revenue: 198000 },
  { date: "2025-10-07", sku: "FD_SAMY_BULDAKSA02_HAKBUL0200_01EA", name: "삼양 불닭사리 핵불닭 200g", qty: 18, revenue: 162000 },
  { date: "2025-10-09", sku: "FD_NONG_SHIN_RAMYUN120_01EA", name: "농심 신라면 120g", qty: 28, revenue: 154000 },
  { date: "2025-10-12", sku: "FD_HAIT_SAEUKKANG090_01EA", name: "해태 새우깡 90g", qty: 30, revenue: 126000 },
  { date: "2025-10-13", sku: "FD_PEPSI_ZERO_033L_CAN_01EA", name: "펩시 제로 330ml 캔", qty: 26, revenue: 104000 },
  { date: "2025-10-15", sku: "FD_BING_SUJEONGWA_238_01EA", name: "빙 수정과 238ml", qty: 19, revenue: 76000 },
  { date: "2025-10-18", sku: "FD_LOTTE_PEpero05_ALMOND_01EA", name: "롯데 빼빼로 아몬드", qty: 33, revenue: 181500 },
  { date: "2025-10-22", sku: "FD_PULM_DUMPLING_BULGOGI_01EA", name: "풀무원 얇은피만두 불고기", qty: 27, revenue: 243000 },
  { date: "2025-10-26", sku: "FD_SAMY_RICECAKE_TTEOKBOKKI_01EA", name: "삼양 즉석 떡볶이", qty: 24, revenue: 204000 },
];

/* ────────────────────────────────────────────────────────────────
 * 헤더 정의 (매출 제거)
 * ────────────────────────────────────────────────────────────────*/
const TABLE_HEADERS = [
  { key: "rank", header: "순위", width: "84px", sortable: false },
  { key: "sku", header: "SKU", width: "300px" },
  { key: "name", header: "상품명", width: "300px" },
  { key: "shippedQty", header: "출고수량", width: "120px" },
] as const;

const SORTABLE_KEYS = new Set<keyof AggRow>(["sku", "name", "shippedQty"]);
const NUMERIC_KEYS = new Set<keyof AggRow>(["shippedQty", "revenue"]);
const fmt = (v: number) => v.toLocaleString();
const dim = (y: number, m: number) => new Date(y, m, 0).getDate();
const weekRange = (y: number, m1to12: number, w: number) => {
  const s = (w - 1) * 7 + 1;
  const e = Math.min(s + 6, dim(y, m1to12));
  const mm = String(m1to12).padStart(2, "0");
  return {
    from: `${y}-${mm}-${String(s).padStart(2, "0")}`,
    to: `${y}-${mm}-${String(e).padStart(2, "0")}`,
  };
};

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

/* ────────────────────────────────────────────────────────────────
 * 메인 컴포넌트
 * ────────────────────────────────────────────────────────────────*/
export default function WeeklyPage() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  const [filter, setFilter] = useState<FilterState>({});
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);
  const [selectedWeek, setSelectedWeek] = useState(1);

  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({
    key: "shippedQty",
    dir: "DESC",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const applyRange = () => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const { from, to } = weekRange(y, m, selectedWeek);
    setFilter({ from, to });
    setPage(1);
  };

  const resetAll = () => {
    setFilter({});
    setPage(1);
  };

  const aggregated = useMemo(() => {
    const from = filter.from ? new Date(filter.from) : null;
    const to = filter.to ? new Date(filter.to) : null;

    const ranged = SALES.filter((s) => {
      const d = new Date(s.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    });

    const map = new Map<string, AggRow>();
    for (const s of ranged) {
      const k = `${s.sku}__${s.name}`;
      const prev = map.get(k);
      if (prev) {
        prev.shippedQty += s.qty;
        prev.revenue += s.revenue;
      } else {
        map.set(k, {
          id: k,
          sku: s.sku,
          name: s.name,
          shippedQty: s.qty,
          revenue: s.revenue,
        });
      }
    }

    let list = Array.from(map.values());
    const key = sort.key as keyof AggRow | undefined;
    if (key && SORTABLE_KEYS.has(key)) {
      list.sort((a, b) => {
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
    return list;
  }, [filter.from, filter.to, sort]);

  const processed = useMemo(() => {
    const total = aggregated.length;
    const start = (page - 1) * pageSize;
    return {
      total,
      rows: aggregated.slice(start, start + pageSize),
    };
  }, [aggregated, page, pageSize]);

  const tableRows = useMemo(
    () =>
      processed.rows.map((r, i) => ({
        id: r.id,
        rank: (page - 1) * pageSize + i + 1,
        sku: r.sku,
        name: r.name,
        shippedQty: fmt(r.shippedQty),
      })),
    [processed.rows, page, pageSize]
  );

  return (
    <div className="p-4 weekly-page">
      <WeeklyStyles />

      <TableBase
        rows={tableRows}
        headers={TABLE_HEADERS as any}
        loading={false}
        page={page}
        pageSize={pageSize}
        total={processed.total}
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
            </select>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={applyRange}
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
              onClick={() =>
                alert("엑셀 내보내기(추후 CSV/XLSX 연동)")
              }
            >
              엑셀 내보내기
            </button>
          </div>
        }
      />
    </div>
  );
}
