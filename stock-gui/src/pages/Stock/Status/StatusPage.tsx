// C:\dev\stock-app\stock-gui\src\pages\Stock\Status\StatusPage.tsx
// 재고관리 > 재고현황 (TableBase 연동 / 더미데이터 포함 / 다건검색 + 조정 모달 + 엑셀 다운로드)
// - 이 페이지에서만 체크박스 컬럼 완전 제거 (CSS 스코프)

import React, { useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";

/* ────────────────────────────────────────────────────────────────
 * 타입
 * ────────────────────────────────────────────────────────────────*/
type InventoryRow = {
  id: string;
  sku: string;
  name: string;
  stockNow: number;
  stockAvail: number;
  lastUnitPrice: number;
};

type SortDir = "ASC" | "DESC";

/* ────────────────────────────────────────────────────────────────
 * 더미 데이터
 * ────────────────────────────────────────────────────────────────*/
const MOCK_ROWS: InventoryRow[] = [
  {
    id: "INV-001",
    sku: "FD_SAMY_BULDAKSA02_HAKBUL0200_01EA",
    name: "삼양 불닭사리 핵불닭 200g",
    stockNow: 320,
    stockAvail: 310,
    lastUnitPrice: 870,
  },
  {
    id: "INV-002",
    sku: "FD_DSFS_MAXIMKAN05_MILDLOS030_1BOX",
    name: "맥심 카누 마일드 로스트 30입",
    stockNow: 180,
    stockAvail: 175,
    lastUnitPrice: 11200,
  },
  {
    id: "INV-003",
    sku: "FD_OTTO_JINRAMYEON01EA",
    name: "오뚜기 진라면 순한맛 120g",
    stockNow: 950,
    stockAvail: 930,
    lastUnitPrice: 540,
  },
];

/* ────────────────────────────────────────────────────────────────
 * 헤더 정의(TableBase 규격)
 * ────────────────────────────────────────────────────────────────*/
const TABLE_HEADERS = [
  { key: "sku", header: "SKU", width: "280px" },
  { key: "name", header: "상품명", width: "300px" },
  { key: "stockNow", header: "현 재고", width: "120px" },
  { key: "stockAvail", header: "가용재고", width: "120px" },
  { key: "lastUnitPrice", header: "최근 단가", width: "120px" },
  { key: "adjust", header: "조정", width: "110px", sortable: false },
] as const;

const NUMERIC_KEYS = new Set<keyof InventoryRow>(["stockNow", "stockAvail", "lastUnitPrice"]);

/* ────────────────────────────────────────────────────────────────
 * 유틸
 * ────────────────────────────────────────────────────────────────*/
const fmt = (v: number) => v.toLocaleString();

/** 다건검색: 엔터, 콤마, 세미콜론, 탭, 공백, 파이프(|) 구분자 지원 */
function parseTerms(input?: string): string[] {
  if (!input) return [];
  const terms = input
    .split(/[\n\r,;|\t ]+/g)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(new Set(terms));
}

/* ────────────────────────────────────────────────────────────────
 * 다건검색 모달
 * ────────────────────────────────────────────────────────────────*/
function BulkSearchModal({
  open,
  defaultValue,
  onClose,
  onApply,
}: {
  open: boolean;
  defaultValue?: string;
  onClose: () => void;
  onApply: (value: string) => void;
}) {
  const [val, setVal] = useState(defaultValue ?? "");

  React.useEffect(() => {
    if (open) setVal(defaultValue ?? "");
  }, [open, defaultValue]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 md:items-center">
      <div className="w-full max-w-xl rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">다건 검색</h3>
          <button className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" onClick={onClose}>
            닫기
          </button>
        </div>
        <div>
          <textarea
            className="h-48 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder={
              "여러 키워드를 줄바꿈/콤마/세미콜론/탭/공백/| 로 구분해 입력하세요.\n예)\nFD_SAMY_BULDAK\n진라면\nKANU 30"
            }
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
          <p className="mt-2 text-xs text-gray-500">
            입력된 모든 토큰을 OR 조건으로 검색합니다. (SKU, 상품명 부분 일치)
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50" onClick={onClose}>
            취소
          </button>
          <button
            className="rounded-xl bg-black px-4 py-2 text-sm text-white"
            onClick={() => {
              onApply(val);
              onClose();
            }}
          >
            적용
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * 재고 조정 모달
 * ────────────────────────────────────────────────────────────────*/
function AdjustModal({
  open,
  sku,
  current,
  onClose,
  onSave,
}: {
  open: boolean;
  sku?: string;
  current?: number;
  onClose: () => void;
  onSave: (nextQty: number, reason?: string) => void;
}) {
  const [qty, setQty] = useState<number>(current ?? 0);
  const [reason, setReason] = useState<string>("");

  React.useEffect(() => {
    if (open) {
      setQty(current ?? 0);
      setReason("");
    }
  }, [open, current]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-3 md:items-center">
      <div className="w-full max-w-lg rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">재고 조정</h3>
          <button className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100" onClick={onClose}>
            닫기
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="text-sm text-gray-600">
            SKU: <b>{sku}</b>
          </div>

          <label className="flex flex-col text-sm">
            <span className="mb-1 text-gray-600">현 재고</span>
            <input
              type="number"
              className="rounded-lg border px-3 py-2"
              value={Number.isFinite(qty) ? qty : 0}
              onChange={(e) => setQty(Number(e.target.value))}
            />
            <span className="mt-1 text-xs text-gray-500">원하는 최종 수량을 입력하세요.</span>
          </label>

          <label className="flex flex-col text-sm">
            <span className="mb-1 text-gray-600">조정 내용</span>
            <textarea
              className="min-h-[92px] rounded-lg border px-3 py-2"
              placeholder="예: 정기 실사 반영, 파손분 제외 등"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50" onClick={onClose}>
            취소
          </button>
          <button
            className="rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white"
            onClick={() => onSave(qty, reason)}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * 이 페이지 전용 스타일 (체크박스 컬럼 제거)
 *  - colgroup 첫 번째 col
 *  - 헤더/바디의 체크박스 셀
 * ────────────────────────────────────────────────────────────────*/
function StockStatusStyles() {
  return (
    <style>{`
      /* 이 페이지 범위 안에서만 적용 */
      .stock-status-page table col:first-child {
        display: none !important;
      }

      .stock-status-page .cds--table-column-checkbox,
      .stock-status-page .bx--table-column-checkbox {
        display: none !important;
      }
    `}</style>
  );
}

/* ────────────────────────────────────────────────────────────────
 * 메인
 * ────────────────────────────────────────────────────────────────*/
export default function StatusPage() {
  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({ key: "sku", dir: "ASC" });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filter, setFilter] = useState<any>({ keyword: "" });

  const [bulkOpen, setBulkOpen] = useState(false);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<{ sku: string; current: number } | null>(null);

  const processed = useMemo(() => {
    const terms = parseTerms(filter.keyword);
    let list = MOCK_ROWS.filter((r) => {
      if (terms.length === 0) return true;
      const sku = r.sku.toLowerCase();
      const name = r.name.toLowerCase();
      return terms.some((t) => sku.includes(t) || name.includes(t));
    });

    const key = sort.key;
    if (key && key !== "adjust") {
      list = [...list].sort((a, b) => {
        const av = a[key as keyof InventoryRow] as any;
        const bv = b[key as keyof InventoryRow] as any;

        if (NUMERIC_KEYS.has(key as keyof InventoryRow)) {
          const diff = (Number(av) || 0) - (Number(bv) || 0);
          return sort.dir === "DESC" ? -diff : diff;
        }
        const comp = String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "DESC" ? -comp : comp;
      });
    }

    const total = list.length;
    const start = (page - 1) * pageSize;
    const paged = list.slice(start, start + pageSize);

    return { total, rows: paged };
  }, [filter, sort, page, pageSize]);

  const tableRows = useMemo(
    () =>
      processed.rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        stockNow: fmt(r.stockNow),
        stockAvail: fmt(r.stockAvail),
        lastUnitPrice: fmt(r.lastUnitPrice),
        adjust: (
          <button
            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs text-white"
            onClick={() => {
              setAdjustTarget({ sku: r.sku, current: r.stockNow });
              setAdjustOpen(true);
            }}
          >
            조정
          </button>
        ),
      })),
    [processed.rows]
  );

  // 전체 재고현황 엑셀(CSV) 다운로드
  const handleExport = () => {
    const header = ["SKU", "상품명", "현 재고", "가용재고", "최근 단가"];
    const lines = [
      header.join(","),
      ...MOCK_ROWS.map((r) => {
        const safeName = `"${String(r.name).replace(/"/g, '""')}"`;
        return [r.sku, safeName, r.stockNow, r.stockAvail, r.lastUnitPrice].join(",");
      }),
    ];
    const csv = "\uFEFF" + lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `stock_status_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="stock-status-page p-4">
      <StockStatusStyles />

      <h1 className="mb-4 text-lg font-semibold">재고 현황</h1>

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
        onSortChange={(next) => setSort(next)}
        filter={filter}
        onFilterChange={setFilter}
        actions={
          <div className="flex gap-2">
            <button
              className="rounded-xl bg-gray-900 px-3 py-2 text-sm text-white hover:bg-gray-950"
              onClick={handleExport}
            >
              엑셀 다운로드
            </button>
            <button
              className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={() => setBulkOpen(true)}
            >
              다건검색
            </button>
          </div>
        }
      />

      <BulkSearchModal
        open={bulkOpen}
        defaultValue={filter.keyword}
        onClose={() => setBulkOpen(false)}
        onApply={(value) => {
          setFilter({ keyword: value });
          setPage(1);
        }}
      />

      <AdjustModal
        open={adjustOpen}
        sku={adjustTarget?.sku}
        current={adjustTarget?.current}
        onClose={() => setAdjustOpen(false)}
        onSave={(nextQty: number, reason?: string) => {
          alert(
            `더미 처리: ${adjustTarget?.sku} 재고를 ${nextQty}로 변경\n사유: ${
              reason && reason.trim().length ? reason : "-"
            }`
          );
          setAdjustOpen(false);
        }}
      />
    </div>
  );
}
