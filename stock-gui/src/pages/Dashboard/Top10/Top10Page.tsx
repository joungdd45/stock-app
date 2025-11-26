// src/pages/dashboard/Top10/Top10Page.tsx
// 대시보드 > TOP10
// - FilterBox 숨김(CSS)
// - actions: 월 선택 + 적용/초기화/엑셀 내보내기
// - 월 범위 집계 후 TOP10으로 제한
// - 총 매출 열 제거
// - 체크박스 컬럼은 재고현황(StatusPage)와 동일한 방식으로 CSS 숨김

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
  {
    date: "2025-10-01",
    sku: "FD_OTTO_JINRAMYEON01EA",
    name: "오뚜기 진라면 순한맛 120g",
    qty: 75,
    revenue: 405000,
  },
  {
    date: "2025-10-03",
    sku: "FD_SAMY_BULDAKSA02_HAKBUL0200_01EA",
    name: "삼양 불닭사리 핵불닭 200g",
    qty: 40,
    revenue: 360000,
  },
  {
    date: "2025-10-05",
    sku: "FD_LOTTE_PEpero05_ALMOND_01EA",
    name: "롯데 빼빼로 아몬드",
    qty: 33,
    revenue: 181500,
  },
  {
    date: "2025-10-09",
    sku: "FD_HAIT_SAEUKKANG090_01EA",
    name: "해태 새우깡 90g",
    qty: 30,
    revenue: 126000,
  },
  {
    date: "2025-10-12",
    sku: "FD_NONG_SHIN_RAMYUN120_01EA",
    name: "농심 신라면 120g",
    qty: 28,
    revenue: 154000,
  },
  {
    date: "2025-10-13",
    sku: "FD_PEPSI_ZERO_033L_CAN_01EA",
    name: "펩시 제로 330ml 캔",
    qty: 26,
    revenue: 104000,
  },
  {
    date: "2025-10-20",
    sku: "FD_PULM_DUMPLING_BULGOGI_01EA",
    name: "풀무원 얇은피만두 불고기",
    qty: 27,
    revenue: 243000,
  },
  {
    date: "2025-10-21",
    sku: "FD_BING_SUJEONGWA_238_01EA",
    name: "빙 수정과 238ml",
    qty: 19,
    revenue: 76000,
  },
  {
    date: "2025-10-23",
    sku: "FD_SAMY_RICECAKE_TTEOKBOKKI_01EA",
    name: "삼양 즉석 떡볶이",
    qty: 24,
    revenue: 204000,
  },
  {
    date: "2025-10-25",
    sku: "FD_DSFS_MAXIMKAN05_MILDLOS030_1BOX",
    name: "맥심 카누 마일드 로스트 30입",
    qty: 15,
    revenue: 450000,
  },
  {
    date: "2025-10-28",
    sku: "FD_LOTTE_PEpero05_ALMOND_01EA",
    name: "롯데 빼빼로 아몬드",
    qty: 12,
    revenue: 66000,
  },
];

/* ────────────────────────────────────────────────────────────────
 * 헤더 정의 (총 매출 제거)
 * ────────────────────────────────────────────────────────────────*/
const TABLE_HEADERS = [
  { key: "rank", header: "순위", width: "84px", sortable: false },
  { key: "sku", header: "SKU", width: "300px" },
  { key: "name", header: "상품명", width: "300px" },
  { key: "shippedQty", header: "출고수량", width: "120px" },
] as const;

const SORTABLE_KEYS = new Set<keyof AggRow>(["sku", "name", "shippedQty"]);
const NUMERIC_KEYS = new Set<keyof AggRow>(["shippedQty"]);
const fmt = (v: number) => v.toLocaleString();
const dim = (y: number, m: number) => new Date(y, m, 0).getDate();

/* ────────────────────────────────────────────────────────────────
 * 이 페이지 전용 스타일 (체크박스 컬럼 제거 + FilterBox/정렬아이콘 숨김)
 * ────────────────────────────────────────────────────────────────*/
function Top10Styles() {
  return (
    <style>{`
      /* FilterBox(2번째 자식) 숨김 */
      .top10-page .noah-tablebase > *:nth-child(2){
        display:none !important;
      }

      /* 정렬 아이콘/설명 + 커스텀 ▲▼ 텍스트 숨김 */
      .top10-page .cds--table-sort__icon,
      .top10-page .cds--table-sort__icon-unsorted,
      .top10-page .bx--table-sort__icon,
      .top10-page .bx--table-sort__icon--unsorted,
      .top10-page .cds--table-sort__description,
      .top10-page .bx--table-sort__description,
      .top10-page thead th span[aria-hidden="true"]{
        display:none !important;
      }

      /* 재고현황/주간/월간과 동일하게 체크박스 컬럼 제거 */
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

/* ────────────────────────────────────────────────────────────────
 * 메인 컴포넌트
 * ────────────────────────────────────────────────────────────────*/
export default function Top10Page() {
  const today = new Date();
  const defaultMonth = `${today.getFullYear()}-${String(
    today.getMonth() + 1
  ).padStart(2, "0")}`;

  const [filter, setFilter] = useState<FilterState>({});
  const [selectedMonth, setSelectedMonth] = useState(defaultMonth);

  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({
    key: "shippedQty",
    dir: "DESC",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const applyMonth = () => {
    const [y, m] = selectedMonth.split("-").map(Number);
    const last = dim(y, m);
    const mm = String(m).padStart(2, "0");
    setFilter({
      from: `${y}-${mm}-01`,
      to: `${y}-${mm}-${String(last).padStart(2, "0")}`,
    });
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

    // TOP 10만 사용
    return list.slice(0, 10);
  }, [filter.from, filter.to, sort]);

  const processed = useMemo(() => {
    const total = aggregated.length;
    const start = (page - 1) * pageSize;
    return {
      total,
      rows: aggregated.slice(start, start + pageSize),
    };
  }, [aggregated, page, pageSize]);

  const rows = useMemo(
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
    <div className="p-4 top10-page">
      <Top10Styles />

      <TableBase
        rows={rows}
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
              onClick={() => alert("엑셀 내보내기(추후 연동)")}
            >
              엑셀 내보내기
            </button>
          </div>
        }
      />
    </div>
  );
}
