// C:\dev\stock-app\stock-gui\src\pages\Stock\History\HistoryPage.tsx
// 재고관리 > 재고이력
// - 재고 수불부(입고·출고·조정) 타임라인 조회
// - 상단: 기간(from/to) + 키워드(SKU, 상품명 등) 필터
// - 하단: 처리일자 / 내용 / SKU / 상품명 / 입고수량 / 출고수량 / 현 재고 / 최근 단가 / 메모 / 처리자
// - 가로 스크롤 최소화(컬럼 폭 조정 + 긴 텍스트 줄바꿈)
// - 이 페이지만 체크박스 컬럼 제거(CSS 스코프)
// - 상단 우측 엑셀 다운로드 버튼: 백엔드 /api/stock/history/export 사용

import React, { useEffect, useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";
import {
  stockAdapter,
  type StockHistoryListItem,
} from "@/api/adapters/stock.adapter";

type HistoryType = "입고" | "출고" | "조정";

type HistoryRow = {
  id: string;
  date: string;
  type: HistoryType;
  sku: string;
  name: string;
  inQty: number;
  outQty: number;
  stockNow: number;
  unitPrice: number;
  memo: string;
  actor: string;
};

type SortDir = "ASC" | "DESC";

const TABLE_HEADERS = [
  { key: "date", header: "처리일자", width: "112px" },
  { key: "type", header: "내용", width: "72px" },
  { key: "sku", header: "SKU", width: "200px" },
  { key: "name", header: "상품명", width: "220px" },
  { key: "inQty", header: "입고수량", width: "88px" },
  { key: "outQty", header: "출고수량", width: "88px" },
  { key: "stockNow", header: "현 재고", width: "96px" },
  { key: "unitPrice", header: "최근 단가", width: "100px" },
  { key: "memo", header: "메모", width: "220px" },
  { key: "actor", header: "처리자", width: "88px" },
] as const;

const NUMERIC_KEYS = new Set<keyof HistoryRow>([
  "inQty",
  "outQty",
  "stockNow",
  "unitPrice",
]);

const fmtNum = (v: number) => v.toLocaleString();

/* ─────────────────────────────────────────────
 * 메모 표시용 포맷터 (원문 유지, 화면만 가공)
 * ───────────────────────────────────────────── */
function formatMemo(raw?: string) {
  const s = (raw ?? "").trim();
  if (!s) return "-";

  let out = s;

  // order_number=test001 → 주문번호: test001
  out = out.replace(
    /order_number\s*=\s*([^\s)]+)/gi,
    "/ 주문번호 : $1"
  );

  // (묶음:bulk02 x 3) → (묶음: bulk02 * 3)
  out = out.replace(
    /\(\s*묶음\s*:\s*([^)x]+?)\s*x\s*(\d+)\s*\)/g,
    "/ 묶음 : $1 × $2"
  );

  // 묶음:bulk02 x 3 → 묶음: bulk02 * 3
  out = out.replace(
    /묶음\s*:\s*([^\s]+)\s*x\s*(\d+)/g,
    "/ 묶음 : $1 × $2"
  );

  return out;
}

/* ─────────────────────────────────────────────
 * 이 페이지 전용 스타일 (체크박스 컬럼 제거)
 * ───────────────────────────────────────────── */
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

// 백엔드 → 화면용 Row 매핑
const mapFromApi = (item: StockHistoryListItem): HistoryRow => ({
  id: String(item.ledger_id),
  date: item.process_date,
  type: item.event_label as HistoryType,
  sku: item.sku,
  name: item.product_name,
  inQty: item.qty_in,
  outQty: item.qty_out,
  stockNow: item.current_stock,
  unitPrice: item.last_unit_price ?? 0,
  memo: item.memo ?? "",
  actor: item.handler ?? "",
});

export default function HistoryPage() {
  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({
    key: "date",
    dir: "DESC",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filter, setFilter] = useState<any>({});
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fetchList = async () => {
      setLoading(true);
      try {
        const res = await stockAdapter.getHistoryList({
          from_date: filter.from || undefined,
          to_date: filter.to || undefined,
          keyword: filter.keyword || undefined,
          page,
          size: pageSize,
        });

        if (res.ok && res.data) {
          setTotal(res.data.count ?? 0);
          setRows(res.data.items.map(mapFromApi));
        } else {
          setTotal(0);
          setRows([]);
          window.alert(
            res.error?.message ?? "재고 이력 조회 중 오류가 발생했습니다."
          );
        }
      } catch (e) {
        setTotal(0);
        setRows([]);
        window.alert("재고 이력 조회 중 예외가 발생했습니다.");
        console.error(e);
      } finally {
        setLoading(false);
      }
    };

    fetchList();
  }, [page, pageSize, filter.from, filter.to, filter.keyword]);

  const processed = useMemo(() => {
    let list = [...rows];
    const key = sort.key as keyof HistoryRow | undefined;

    if (key) {
      list.sort((a, b) => {
        if (key === "date") {
          const diff =
            new Date(a.date).getTime() - new Date(b.date).getTime();
          return sort.dir === "DESC" ? -diff : diff;
        }
        if (NUMERIC_KEYS.has(key)) {
          const diff = (a[key] as number) - (b[key] as number);
          return sort.dir === "DESC" ? -diff : diff;
        }
        const comp = String(a[key] ?? "").localeCompare(String(b[key] ?? ""));
        return sort.dir === "DESC" ? -comp : comp;
      });
    }

    return { total, rows: list };
  }, [rows, sort, total]);

  const tableRows = useMemo(
    () =>
      processed.rows.map((r) => ({
        id: r.id,
        date: r.date,
        type: r.type,
        sku: <span className="whitespace-normal break-all">{r.sku}</span>,
        name: <span className="whitespace-normal break-words">{r.name}</span>,
        inQty: fmtNum(r.inQty),
        outQty: fmtNum(r.outQty),
        stockNow: fmtNum(r.stockNow),
        unitPrice: fmtNum(r.unitPrice),
        memo: (
          <span className="whitespace-pre-wrap break-words leading-6">
            {formatMemo(r.memo)}
          </span>
        ),
        actor: r.actor,
      })),
    [processed.rows]
  );

  const handleExport = async () => {
    try {
      const res = await stockAdapter.exportHistory({
        from_date: filter.from || undefined,
        to_date: filter.to || undefined,
        keyword: filter.keyword || undefined,
      } as any);

      if (!res.ok || !res.data) {
        window.alert(
          res.error?.message ?? "엑셀 다운로드 중 오류가 발생했습니다."
        );
        return;
      }

      const { file_name, content_type, content_base64 } = res.data;
      const binary = atob(content_base64);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], {
        type: content_type || "application/octet-stream",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        file_name ??
        `stock_history_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      window.alert("엑셀 다운로드 중 예외가 발생했습니다.");
    }
  };

  return (
    <div className="stock-history-page p-4 w-full overflow-x-hidden">
      <StockHistoryStyles />

      <h1 className="mb-4 text-lg font-semibold">재고 이력</h1>

      <TableBase
        rows={tableRows}
        headers={TABLE_HEADERS as any}
        loading={loading}
        page={page}
        pageSize={pageSize}
        total={processed.total}
        onPageChange={setPage}
        onPageSizeChange={(ps) => {
          setPageSize(ps);
          setPage(1);
        }}
        sort={sort}
        onSortChange={setSort}
        filter={filter}
        onFilterChange={setFilter}
        actions={
          <button
            className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-950"
            onClick={handleExport}
            disabled={loading}
          >
            엑셀 다운로드
          </button>
        }
      />
    </div>
  );
}
