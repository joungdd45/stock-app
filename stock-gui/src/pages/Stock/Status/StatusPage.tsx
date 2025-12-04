// C:\dev\stock-app\stock-gui\src\pages\Stock\Status\StatusPage.tsx
// 재고관리 > 재고현황
// - TableBase 연동
// - 백엔드 stockAdapter(status) 연동
// - 다건검색(POST /api/stock/status/multi)
// - 재고 조정 모달(POST /api/stock/status/action, action="adjust")
// - 엑셀 다운로드(POST /api/stock/status/action, action="export")
// - 이 페이지만 체크박스 컬럼 제거(CSS 스코프)

import React, { useEffect, useMemo, useState } from "react";
import TableBase from "../../../components/common/table/TableBase";
import {
  stockAdapter,
  type StockStatusItem,
} from "@/api/adapters/stock.adapter";
import { handleError } from "@/utils/handleError";

/* ────────────────────────────────────────────────────────────────
 * 타입
 * ────────────────────────────────────────────────────────────────*/
type InventoryRow = {
  id: string;
  sku: string;
  name: string;
  stockNow: number;
  stockAvail: number;
  lastUnitPrice: number | null;
};

type SortDir = "ASC" | "DESC";

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

const NUMERIC_KEYS = new Set<keyof InventoryRow>([
  "stockNow",
  "stockAvail",
  "lastUnitPrice",
]);

/* ────────────────────────────────────────────────────────────────
 * 유틸
 * ────────────────────────────────────────────────────────────────*/
const fmt = (v: number) => v.toLocaleString();

/** 다건검색: 엔터, 콤마, 세미콜론, 탭, 공백, 파이프(|) 구분자 지원 */
function parseTerms(input?: string): string[] {
  if (!input) return [];
  const terms = input
    .split(/[\n\r,;|\t ]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(terms));
}

/* ────────────────────────────────────────────────────────────────
 * 다건검색 모달 (SKU 기준)
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
          <h3 className="text-base font-semibold">다건 검색 (SKU)</h3>
          <button
            className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            onClick={onClose}
          >
            닫기
          </button>
        </div>
        <div>
          <textarea
            className="h-48 w-full rounded-lg border px-3 py-2 text-sm"
            placeholder={
              "여러 SKU를 줄바꿈/콤마/세미콜론/탭/공백/| 로 구분해 입력하세요.\n예)\nsku-001\nEXIST-BULK-001\nNO-BARCODE-001"
            }
            value={val}
            onChange={(e) => setVal(e.target.value)}
          />
          <p className="mt-2 text-xs text-gray-500">
            입력된 SKU들을 기준으로 재고를 다건 조회합니다.
          </p>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
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
          <button
            className="rounded-md px-2 py-1 text-sm text-gray-500 hover:bg-gray-100"
            onClick={onClose}
          >
            닫기
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3">
          <div className="text-sm text-gray-600">
            SKU: <b>{sku}</b>
          </div>

          <label className="flex flex-col text-sm">
            <span className="mb-1 text-gray-600">현 재고(최종 수량)</span>
            <input
              type="number"
              className="rounded-lg border px-3 py-2"
              value={Number.isFinite(qty) ? qty : 0}
              onChange={(e) => setQty(Number(e.target.value))}
            />
            <span className="mt-1 text-xs text-gray-500">
              조정 후 최종 재고 수량을 입력하세요.
            </span>
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
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={onClose}
          >
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
 * ────────────────────────────────────────────────────────────────*/
function StockStatusStyles() {
  return (
    <style>{`
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
 * 메인 컴포넌트
 * ────────────────────────────────────────────────────────────────*/
export default function StatusPage() {
  const [sort, setSort] = useState<{ key?: string; dir?: SortDir }>({
    key: "sku",
    dir: "ASC",
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [filter, setFilter] = useState<any>({ keyword: "" });

  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<StockStatusItem[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [multiSkus, setMultiSkus] = useState<string[] | null>(null);

  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] =
    useState<{ sku: string; current: number } | null>(null);

  const [reloadKey, setReloadKey] = useState(0);

  /* 데이터 로딩 */
  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      setLoading(true);
      try {
        if (multiSkus && multiSkus.length > 0) {
          // SKU 다건 조회
          const res = await stockAdapter.multiStatus({
            skus: multiSkus,
            page,
            size: pageSize,
            sort_by: "sku",
            order: sort.dir === "DESC" ? "desc" : "asc",
          });
          if (!cancelled) {
            if (res.ok && res.data) {
              setItems(res.data.items ?? []);
              setTotalCount(res.data.count ?? res.data.items?.length ?? 0);
            } else {
              console.error("status multi error", res.error);
              if (!res.ok && res.error) {
                handleError(res.error);
              }
              setItems([]);
              setTotalCount(0);
            }
          }
        } else {
          // 기본 재고 현황 목록
          const res = await stockAdapter.getStatusList({
            page,
            size: pageSize,
            keyword: filter.keyword ?? undefined,
          });
          if (!cancelled) {
            if (res.ok && res.data) {
              setItems(res.data.items ?? []);
              setTotalCount(res.data.count ?? res.data.items?.length ?? 0);
            } else {
              console.error("status list error", res.error);
              if (!res.ok && res.error) {
                handleError(res.error);
              }
              setItems([]);
              setTotalCount(0);
            }
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchData();
    return () => {
      cancelled = true;
    };
  }, [page, pageSize, sort.dir, filter.keyword, multiSkus, reloadKey]);

  // filter 초기화 시 다건검색 해제
  useEffect(() => {
    if (!filter || !filter.keyword) {
      setMultiSkus(null);
    }
  }, [filter]);

  /* 정렬 + 화면용 가공 (여기서 0재고 제거) */
  const processed = useMemo(() => {
    let list: InventoryRow[] = items
      .map((it) => ({
        id: it.sku,
        sku: it.sku,
        name: it.name,
        stockNow: it.current_qty,
        stockAvail: it.available_qty,
        lastUnitPrice: it.last_price,
      }))
      // 🔥 재고가 전부 0인 항목은 숨김
      .filter(
        (r) =>
          (r.stockNow ?? 0) > 0 ||
          (r.stockAvail ?? 0) > 0,
      );

    const key = sort.key;
    if (key && key !== "adjust") {
      list = [...list].sort((a, b) => {
        const av = a[key as keyof InventoryRow] as any;
        const bv = b[key as keyof InventoryRow] as any;

        if (NUMERIC_KEYS.has(key as keyof InventoryRow)) {
          const diff = (Number(av ?? 0) || 0) - (Number(bv ?? 0) || 0);
          return sort.dir === "DESC" ? -diff : diff;
        }
        const comp = String(av ?? "").localeCompare(String(bv ?? ""));
        return sort.dir === "DESC" ? -comp : comp;
      });
    }

    // 여기서는 실제 화면에 보이는 건수 기준
    return { total: list.length, rows: list };
  }, [items, sort]);

  const tableRows = useMemo(
    () =>
      processed.rows.map((r) => ({
        id: r.id,
        sku: r.sku,
        name: r.name,
        stockNow: fmt(r.stockNow),
        stockAvail: fmt(r.stockAvail),
        lastUnitPrice:
          r.lastUnitPrice != null ? fmt(r.lastUnitPrice) : "-",
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
    [processed.rows],
  );

  /* 엑셀 다운로드: status.action(action=export) */
  const handleExport = async () => {
    try {
      const skusToExport = items
        .map((it) => ({
          sku: it.sku,
          current_qty: it.current_qty,
          available_qty: it.available_qty,
        }))
        // 엑셀도 0재고는 빼고 싶다면 같은 필터 적용
        .filter(
          (r) =>
            (r.current_qty ?? 0) > 0 ||
            (r.available_qty ?? 0) > 0,
        )
        .map((r) => r.sku);

      if (!skusToExport.length) {
        window.alert("내보낼 재고 데이터가 없습니다.");
        return;
      }

      const res = await stockAdapter.statusAction({
        action: "export",
        selected_skus: skusToExport,
        memo: "재고현황 엑셀 다운로드",
      });

      if (!res.ok || !res.data) {
        console.error("status export error", res.error);
        if (res.error) {
          handleError(res.error);
        } else {
          window.alert("엑셀 다운로드 중 오류가 발생했습니다.");
        }
        return;
      }

      const { file_name, content_type, content_base64 } = res.data;
      const byteString = window.atob(content_base64);
      const byteNumbers = new Array(byteString.length);
      for (let i = 0; i < byteString.length; i += 1) {
        byteNumbers[i] = byteString.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: content_type });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download =
        file_name ||
        `stock_status_${new Date().toISOString().slice(0, 10)}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("status export exception", err);
      window.alert("엑셀 다운로드 처리 중 예외가 발생했습니다.");
    }
  };

  return (
    <div className="stock-status-page p-4">
      <StockStatusStyles />

      <h1 className="mb-4 text-lg font-semibold">재고 현황</h1>

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
        onSortChange={(next) => setSort(next)}
        filter={filter}
        onFilterChange={(v) => setFilter(v)}
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

      {/* 다건 검색 모달 */}
      <BulkSearchModal
        open={bulkOpen}
        defaultValue={filter.keyword}
        onClose={() => setBulkOpen(false)}
        onApply={(value) => {
          const terms = parseTerms(value);
          setMultiSkus(terms.length ? terms : null);
          setFilter({ keyword: value });
          setPage(1);
        }}
      />

      {/* 재고 조정 모달 */}
      <AdjustModal
        open={adjustOpen}
        sku={adjustTarget?.sku}
        current={adjustTarget?.current}
        onClose={() => setAdjustOpen(false)}
        onSave={async (nextQty: number, reason?: string) => {
          if (!adjustTarget?.sku) {
            setAdjustOpen(false);
            return;
          }
          try {
            const res = await stockAdapter.statusAction({
              action: "adjust",
              sku: adjustTarget.sku,
              final_qty: nextQty,
              memo: reason,
              selected_skus: [adjustTarget.sku],
            });
            if (!res.ok) {
              console.error("status adjust error", res.error);
              if (res.error) {
                handleError(res.error);
              } else {
                window.alert("재고 조정 중 오류가 발생했습니다.");
              }
            } else {
              window.alert("재고 조정이 완료되었습니다.");
              setReloadKey((k) => k + 1);
            }
          } catch (err) {
            console.error("status adjust exception", err);
            window.alert("재고 조정 처리 중 예외가 발생했습니다.");
          } finally {
            setAdjustOpen(false);
          }
        }}
      />
    </div>
  );
}
