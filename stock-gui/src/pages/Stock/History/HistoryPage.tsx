// C:\dev\stock-app\stock-gui\src\pages\Stock\History\HistoryPage.tsx
// 재고관리 > 재고이력
// - 가로 스크롤 제거: 컬럼폭 최적화 + 긴 텍스트 줄바꿈
// - 이 페이지만 체크박스 컬럼 제거 (CSS 스코프)
// - 상단 우측에 엑셀 다운로드 버튼 추가

import React, { useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";

type HistoryType = "입고" | "출고" | "조정";

type HistoryRow = {
  id: string;
  date: string; // 원본 "YYYY-MM-DD HH:mm"
  type: HistoryType;
  sku: string;
  name: string;
  inQty: number;
  outQty: number;
  stockNow: number;
  unitPrice: number;
  memo?: string;
  actor: string;
};

type SortDir = "ASC" | "DESC";

const MOCK_ROWS: HistoryRow[] = [
  {
    id: "HIS-0001",
    date: "2025-10-26 09:10",
    type: "입고",
    sku: "FD_SAMY_BULDAKSA02_HAKBUL0200_01EA",
    name: "삼양 불닭사리 핵불닭 200g",
    inQty: 200,
    outQty: 0,
    stockNow: 1120,
    unitPrice: 870,
    memo: "",
    actor: "관리자",
  },
  {
    id: "HIS-0002",
    date: "2025-10-26 10:22",
    type: "출고",
    sku: "FD_DSFS_MAXIMKAN05_MILDLOS030_1BOX",
    name: "맥심 카누 마일드 로스트 30입",
    inQty: 0,
    outQty: 12,
    stockNow: 168,
    unitPrice: 11200,
    memo: "",
    actor: "직원명",
  },
  {
    id: "HIS-0003",
    date: "2025-10-26 11:05",
    type: "조정",
    sku: "FD_OTTO_JINRAMYEON01EA",
    name: "오뚜기 진라면 순한맛 120g",
    inQty: 0,
    outQty: 0,
    stockNow: 945,
    unitPrice: 540,
    memo: "월간 실사 차이 반영",
    actor: "대표명",
  },
];

// ✅ 컬럼 폭을 보수적으로 축소 (총합↓) + 긴 컬럼은 줄바꿈으로 해결
const TABLE_HEADERS = [
  { key: "date", header: "처리일자", width: "112px" },
  { key: "type", header: "내용", width: "72px" },
  { key: "sku", header: "SKU", width: "200px" }, // 긴 값: 줄바꿈
  { key: "name", header: "상품명", width: "220px" }, // 긴 값: 줄바꿈
  { key: "inQty", header: "입고수량", width: "88px" },
  { key: "outQty", header: "출고수량", width: "88px" },
  { key: "stockNow", header: "현 재고", width: "96px" },
  { key: "unitPrice", header: "최근 단가", width: "100px" },
  { key: "memo", header: "메모", width: "200px" }, // 긴 값: 줄바꿈
  { key: "actor", header: "처리자", width: "88px" },
] as const;

const NUMERIC_KEYS = new Set<keyof HistoryRow>(["inQty", "outQty", "stockNow", "unitPrice"]);
const fmtNum = (v: number) => v.toLocaleString();

/* ────────────────────────────────────────────────────────────────
 * 이 페이지 전용 스타일 (체크박스 컬럼 제거)
 *  - colgroup 첫 번째 col
 *  - 헤더/바디의 체크박스 셀
 * ────────────────────────────────────────────────────────────────*/
function StockHistoryStyles() {
  return (
    <style>{`
      .stock-history-page table col:first-child {
        display: none !important;
      }

      .stock-history-page .cds--table-column-checkbox,
      .stock-history-page .bx--table-column-checkbox {
        display: none !important;
      }
    `}</style>
  );
}

export default function HistoryPage() {
  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({
    key: "date",
    dir: "DESC",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  // TableBase의 FilterBox와 맞추기 위해 any로 관리 (from/to/keyword 확장 가능)
  const [filter, setFilter] = useState<any>({});

  const processed = useMemo(() => {
    let list = [...MOCK_ROWS];

    // 정렬
    const key = sort.key as keyof HistoryRow | undefined;
    if (key) {
      list = list.sort((a, b) => {
        if (key === "date") {
          const av = new Date(a.date.replace(" ", "T"));
          const bv = new Date(b.date.replace(" ", "T"));
          const diff = av.getTime() - bv.getTime();
          return sort.dir === "DESC" ? -diff : diff;
        }
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

    // 페이지네이션
    const total = list.length;
    const start = (page - 1) * pageSize;
    const paged = list.slice(start, start + pageSize);
    return { total, rows: paged };
  }, [sort, page, pageSize]);

  // 🔎 긴 텍스트는 줄바꿈 허용(span으로 감싸 Tailwind 클래스 적용)
  const tableRows = useMemo(
    () =>
      processed.rows.map((r) => ({
        id: r.id,
        date: r.date.split(" ")[0], // 시간 제거
        type: r.type,
        sku: <span className="whitespace-normal break-all leading-6">{r.sku}</span>,
        name: <span className="whitespace-normal break-words leading-6">{r.name}</span>,
        inQty: fmtNum(r.inQty),
        outQty: fmtNum(r.outQty),
        stockNow: fmtNum(r.stockNow),
        unitPrice: fmtNum(r.unitPrice),
        memo: <span className="whitespace-normal break-words leading-6">{r.memo ?? ""}</span>,
        actor: r.actor,
      })),
    [processed.rows]
  );

  // ✅ 재고이력 전체 엑셀(CSV) 다운로드 (가짜 데이터 기준, 나중에 API 결과로 교체)
  const handleExport = () => {
    const header = [
      "처리일자",
      "내용",
      "SKU",
      "상품명",
      "입고수량",
      "출고수량",
      "현 재고",
      "최근 단가",
      "메모",
      "처리자",
    ];

    const lines = [
      header.join(","),
      ...MOCK_ROWS.map((r) => {
        const safeName = `"${String(r.name).replace(/"/g, '""')}"`;
        const safeMemo = `"${String(r.memo ?? "").replace(/"/g, '""')}"`;
        return [
          r.date,
          r.type,
          r.sku,
          safeName,
          r.inQty,
          r.outQty,
          r.stockNow,
          r.unitPrice,
          safeMemo,
          r.actor,
        ].join(",");
      }),
    ];

    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock_history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    // 컨테이너에서 가로 넘침 차단
    <div className="stock-history-page p-4 w-full overflow-x-hidden">
      <StockHistoryStyles />

      <h1 className="mb-4 text-lg font-semibold">재고 이력</h1>

      <div className="w-full overflow-x-hidden">
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
          onSortChange={setSort}
          filter={filter}
          onFilterChange={setFilter}
          actions={
            <button
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-950"
              onClick={handleExport}
            >
              엑셀 다운로드
            </button>
          }
        />
      </div>
    </div>
  );
}
