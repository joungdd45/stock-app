/* ============================================================================
 * 📄 src/pages/Inbound/Register/inboundRegisterQueryPage.tsx
 * 입고관리 → 입고등록 → 조회탭
 *
 * 기능:
 * - 필터(기간 시작/종료, SKU·상품명 키워드)
 * - 목록 조회 (백엔드 /api/inbound/register/query/list 연동)
 * - 선택 수정(1건) → 모달 기반 수정 → update API 호출
 * - 선택 삭제(N건) → confirm 후 delete API 호출
 * - CSV 다운로드(표시 컬럼 기준, 프론트 생성 – xlsx API 생기면 교체)
 * ========================================================================== */

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  DataTable,
  TableContainer,
  Table,
  TableHead,
  TableRow,
  TableHeader,
  TableBody,
  TableCell,
  TableSelectAll,
  TableSelectRow,
  SkeletonText,
} from "@carbon/react";
import { inboundAdapter } from "@/api/adapters/inbound.adapter";
import { handleError } from "@/utils/handleError";

const DEBUG = true;
const dbg = (...args: any[]) => DEBUG && console.log("[InboundRegisterQuery]", ...args);

/* ─────────────────────────────────────────
 * 타입 정의
 * ───────────────────────────────────────── */

type Row = {
  id: string; // `${headerId}-${itemId}`
  headerId: number;
  itemId: number;
  orderDate: string; // YYYY-MM-DD
  sku: string;
  name: string;
  qty: number;
  totalPrice: number;
  unitPrice: number;
  supplier: string;
  orderNo: string;
};

const ALL_HEADERS = [
  { key: "orderDate", header: "주문일자" },
  { key: "sku", header: "SKU" },
  { key: "name", header: "상품명" },
  { key: "qty", header: "입고 수량" },
  { key: "totalPrice", header: "총 단가" },
  { key: "unitPrice", header: "개당 단가" },
  { key: "supplier", header: "입고처" },
  { key: "orderNo", header: "주문번호" },
] as const;

const fmtInt = (n: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n);

/* ─────────────────────────────────────────
 * 필터 박스
 * ───────────────────────────────────────── */

function FilterBox(props: {
  value: { from?: string; to?: string; keyword?: string };
  onChange: (v: { from?: string; to?: string; keyword?: string }) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const { value, onChange, onSubmit, onReset } = props;

  return (
    <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">기간 시작</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.from ?? ""}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">기간 종료</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.to ?? ""}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </label>
        <label className="flex flex-col text-sm md:col-span-2">
          <span className="mb-1 text-gray-600">SKU 또는 상품명</span>
          <input
            type="text"
            placeholder="SKU, 상품명, 공급처 검색"
            className="rounded-lg border px-3 py-2"
            value={value.keyword ?? ""}
            onChange={(e) => onChange({ ...value, keyword: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={onReset}
          >
            초기화
          </button>
          <button
            type="button"
            className="rounded-xl bg-black px-4 py-2 text-sm text-white"
            onClick={onSubmit}
          >
            검색
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
 * 상단 우측 액션 버튼
 * ───────────────────────────────────────── */

function ButtonGroup(props: {
  selectedCount: number;
  visibleKeys: Set<string>;
  onToggleKey: (k: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onDownload: () => void;
}) {
  const disNone = props.selectedCount === 0;
  const disNotOne = props.selectedCount !== 1;

  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
      <button
        className={`rounded-xl px-4 py-2 text-sm ${
          disNotOne ? "bg-gray-200 text-gray-500" : "bg-blue-600 text-white"
        }`}
        disabled={disNotOne}
        onClick={props.onEdit}
      >
        수정
      </button>
      <button
        className={`rounded-xl px-4 py-2 text-sm ${
          disNone ? "bg-gray-200 text-gray-500" : "bg-red-600 text-white"
        }`}
        disabled={disNone}
        onClick={props.onDelete}
      >
        삭제
      </button>
      <button
        className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
        onClick={props.onDownload}
      >
        다운로드(CSV)
      </button>

      <div className="relative" ref={menuRef}>
        <button
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => setOpen((v) => !v)}
        >
          열 보이기
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-2 w-48 rounded-xl border bg-white p-2 shadow-md">
            {ALL_HEADERS.map((h) => (
              <label key={h.key} className="flex items-center gap-2 p-1 text-sm">
                <input
                  type="checkbox"
                  checked={props.visibleKeys.has(h.key)}
                  onChange={() => props.onToggleKey(h.key)}
                />
                <span>{h.header}</span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
 * 스타일 보정
 * ───────────────────────────────────────── */

const AssistiveTextFix = () => (
  <style>{`
    :root .cds--assistive-text,
    :root .cds--table-sort__description {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      overflow: hidden !important;
      clip: rect(1px, 1px, 1px, 1px) !important;
      white-space: nowrap !important;
      border: 0 !important;
      padding: 0 !important;
      margin: -1px !important;
    }
    :root .cds--table-sort__icon,
    :root .cds--table-sort__icon-unsorted { display: none !important; }
    th .cds--checkbox-label, td .cds--checkbox-label { display: none !important; }
    th.cds--table-column-checkbox, td.cds--table-column-checkbox,
    th:first-child, td:first-child { text-align: center !important; }
    th:first-child .cds--checkbox-wrapper, td:first-child .cds--checkbox-wrapper { margin: 0 auto !important; }
    .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
    .ellipsis-sku { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 360px; }
  `}</style>
);

/* ─────────────────────────────────────────
 * 수정 모달 컴포넌트
 * ───────────────────────────────────────── */

type EditModalProps = {
  open: boolean;
  target: Row | null;
  form: { qty: string; totalPrice: string; supplier: string };
  saving: boolean;
  onChange: (form: { qty: string; totalPrice: string; supplier: string }) => void;
  onClose: () => void;
  onSubmit: () => void;
};

function EditModal({ open, target, form, saving, onChange, onClose, onSubmit }: EditModalProps) {
  if (!open || !target) return null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
        <h2 className="mb-3 text-lg font-semibold text-gray-900">입고 내역 수정</h2>

        <div className="mb-3 rounded-xl bg-gray-50 p-3 text-xs text-gray-700">
          <div className="flex justify-between gap-2">
            <span className="font-medium">주문일자</span>
            <span>{target.orderDate}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <span className="font-medium">주문번호</span>
            <span className="font-mono">{target.orderNo}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <span className="font-medium">SKU</span>
            <span className="font-mono">{target.sku}</span>
          </div>
          <div className="mt-1 flex justify_between gap-2">
            <span className="font-medium">상품명</span>
            <span className="truncate text-right">{target.name}</span>
          </div>
        </div>

        <div className="space_y-3 text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-gray-700">입고 수량</span>
            <input
              type="number"
              min={1}
              className="rounded-lg border px-3 py-2"
              value={form.qty}
              onChange={(e) => onChange({ ...form, qty: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-700">총 단가</span>
            <input
              type="number"
              min={0}
              className="rounded-lg border px-3 py-2"
              value={form.totalPrice}
              onChange={(e) => onChange({ ...form, totalPrice: e.target.value })}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-gray-700">입고처</span>
            <input
              type="text"
              className="rounded-lg border px-3 py-2"
              value={form.supplier}
              onChange={(e) => onChange({ ...form, supplier: e.target.value })}
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2 text-sm">
          <button
            type="button"
            className="rounded-xl border px-4 py-2 text-gray-700 hover:bg-gray-50"
            disabled={saving}
            onClick={onClose}
          >
            취소
          </button>
          <button
            type="button"
            className="rounded-xl bg-blue-600 px-4 py-2 text-white disabled:opacity-60"
            disabled={saving}
            onClick={onSubmit}
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────
 * 메인 컴포넌트
 * ───────────────────────────────────────── */

export default function RegisterQueryPage() {
  const [filter, setFilter] = useState<{ from?: string; to?: string; keyword?: string }>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25>(10);
  const [sort, setSort] = useState<{ key?: string; dir?: "ASC" | "DESC" }>({
    key: "orderDate",
    dir: "DESC",
  });

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(
    new Set(ALL_HEADERS.map((h) => h.key)),
  );

  // 수정 모달 상태
  const [editTarget, setEditTarget] = useState<Row | null>(null);
  const [editForm, setEditForm] = useState<{ qty: string; totalPrice: string; supplier: string }>(
    {
      qty: "",
      totalPrice: "",
      supplier: "",
    },
  );
  const [editSaving, setEditSaving] = useState(false);

  const toggleKey = (k: string) =>
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  // 합계
  const summary = useMemo(() => {
    const qty = rows.reduce((s, r) => s + (r.qty || 0), 0);
    const amount = rows.reduce((s, r) => s + (r.totalPrice || 0), 0);
    return { qty, amount };
  }, [rows]);

  const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));

  // 디버그용 window 핸들
  useEffect(() => {
    (window as any).__inbound = {
      setFilter,
      setPage,
      setPageSize,
      setSort,
      get ui() {
        return { filter, page, pageSize, sort };
      },
      get rows() {
        return rows;
      },
    };
    dbg("window.__inbound 준비 완료 (adapter 버전)");
  }, [filter, page, pageSize, sort, rows]);

  /* ─────────────────────────────────────────
   * 리스트 조회 (committed 숨기기 적용)
   * ───────────────────────────────────────── */

  const fetchList = async (reason: string) => {
    dbg("FETCH 시작", {
      reason,
      searchFilter: filter,
      page,
      pageSize,
      sort,
    });

    setLoading(true);
    setError(null);

    const params = {
      date_from: filter.from || undefined,
      date_to: filter.to || undefined,
      keyword: filter.keyword || undefined,
      page,
      size: pageSize,
      sort_key: sort.key === "orderDate" ? "order_date" : sort.key,
      sort_dir: sort.dir,
    };

    try {
      const res = await inboundAdapter.registerQueryList(params);

      if (!res.ok) {
        handleError(res.error);
        setRows([]);
        setTotalCount(0);
        setError(res.error?.message ?? "조회 중 오류가 발생했습니다.");
        dbg("FETCH 실패", res.error);
        return;
      }

      const raw: any = res.data ?? {};

      // 1) committed 상태는 프론트에서 숨김
      const rawItems: any[] = Array.isArray(raw.items) ? raw.items : [];
      const visibleItems = rawItems.filter((it) => it.status !== "committed");

      // 2) 필터된 아이들만 Row로 변환
      const newRows: Row[] = visibleItems.map((it) => ({
        id: `${it.header_id}-${it.item_id}`,
        headerId: it.header_id,
        itemId: it.item_id,
        orderDate: it.order_date,
        sku: it.sku,
        name: it.name,
        qty: it.qty,
        totalPrice: it.total_price,
        unitPrice: it.unit_price,
        supplier: it.supplier_name,
        orderNo: it.order_no,
      }));

      setRows(newRows);

      // 3) 총 건수도 화면에 보이는 기준으로 맞춤
      setTotalCount(visibleItems.length);

      dbg("FETCH 성공", {
        apiCount: raw.pagination?.count,
        visibleCount: visibleItems.length,
      });
    } catch (err) {
      console.error(err);
      handleError(err as any);
      setRows([]);
      setTotalCount(0);
      setError("조회 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  // 초기 로드 + UI 변경 시 재조회
  useEffect(() => {
    fetchList("page");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sort.key, sort.dir]);

  // 검색 버튼 눌렀을 때
  const handleSearchSubmit = () => {
    dbg("SUBMIT: 검색 → page=1 리셋 + fetch");
    setPage(1);
    fetchList("search");
  };

  const handleReset = () => {
    dbg("SUBMIT: 초기화");
    setFilter({});
    setPage(1);
    fetchList("reset");
  };

  // CSV 다운로드
  const handleDownloadCSV = () => {
    dbg("CSV export 시작");
    const cols = ALL_HEADERS.filter((h) => visibleKeys.has(h.key)).map(
      (h) => h.key as keyof Row,
    );
    const headerLine = ["id", ...cols].join(",");
    const lines = rows.map((r) =>
      ['"' + r.id + '"', ...cols.map((k) => `"${String(r[k]).replaceAll('"', '""')}"`)].join(
        ",",
      ),
    );
    const csv = [headerLine, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `inbound_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    dbg("CSV export 완료");
  };

  // 수정 버튼 클릭 → 모달 오픈
  const handleEdit = (selectedIds: string[]) => {
    if (selectedIds.length !== 1) return;
    const target = rows.find((r) => r.id === selectedIds[0]);
    if (!target) {
      alert("선택한 행을 찾을 수 없습니다.");
      return;
    }

    setEditTarget(target);
    setEditForm({
      qty: String(target.qty),
      totalPrice: String(target.totalPrice),
      supplier: target.supplier,
    });
  };

  // 수정 모달 저장
  const handleEditSubmit = async () => {
    if (!editTarget) return;

    const nextQty = Number(editForm.qty);
    if (!Number.isFinite(nextQty) || nextQty <= 0) {
      alert("입고 수량은 1 이상 숫자여야 합니다.");
      return;
    }

    const nextTotal = Number(editForm.totalPrice);
    if (!Number.isFinite(nextTotal) || nextTotal < 0) {
      alert("총 단가는 0 이상 숫자여야 합니다.");
      return;
    }

    const supplierName = editForm.supplier.trim();

    setEditSaving(true);

    const payload = {
      item_id: editTarget.itemId,
      qty: nextQty,
      total_price: nextTotal,
      supplier_name: supplierName,
    } as const;

    try {
      const res = await inboundAdapter.registerQueryUpdate(payload);

      if (!res.ok) {
        handleError(res.error);
        return;
      }

      setEditTarget(null);
      await fetchList("edit");
      alert("수정이 완료되었습니다.");
    } catch (err) {
      console.error(err);
      handleError(err as any);
    } finally {
      setEditSaving(false);
    }
  };

  // 삭제
  const handleDelete = async (selectedIds: string[]) => {
    if (selectedIds.length === 0) return;

    const targets = rows.filter((r) => selectedIds.includes(r.id));
    if (targets.length === 0) return;

    if (
      !window.confirm(
        `선택된 ${targets.length}건을 삭제할까요?\n(실제 삭제 스펙은 백엔드 기준 soft delete)`,
      )
    ) {
      return;
    }

    const payload = {
      item_ids: targets.map((r) => r.itemId),
    } as const;

    try {
      const res = await inboundAdapter.registerQueryDelete(payload);

      if (!res.ok) {
        handleError(res.error);
        return;
      }

      await fetchList("delete");
      alert(`삭제가 완료되었습니다. (삭제 건수: ${res.data.deleted_count})`);
    } catch (err) {
      console.error(err);
      handleError(err as any);
    }
  };

  // 정렬 헬퍼
  const stripKey = (props: any) => {
    const { key: _skip, ...rest } = props ?? {};
    return rest;
  };

  const wrapHeaderProps = (orig: any, header: any) => {
    const onClick = (e: any) => {
      if (orig?.onClick) orig.onClick(e);
      const key = header.key as string;
      setSort((prev) => {
        const nextDir: "ASC" | "DESC" =
          prev.key !== key ? "ASC" : prev.dir === "ASC" ? "DESC" : "ASC";
        return { key, dir: nextDir };
      });
      setPage(1);
    };
    return { ...stripKey(orig), onClick };
  };

  const visibleHeaders = useMemo(
    () => ALL_HEADERS.filter((h) => visibleKeys.has(h.key)),
    [visibleKeys],
  );

  const rowsForCarbon = rows.map((r) => {
    const base: any = { id: r.id };
    for (const h of visibleHeaders) {
      const k = h.key as keyof Row;
      base[k] =
        k === "qty"
          ? fmtInt(r.qty)
          : k === "totalPrice"
          ? fmtInt(r.totalPrice)
          : k === "unitPrice"
          ? fmtInt(r.unitPrice)
          : (r as any)[k];
    }
    return base;
  });

  useEffect(() => {
    dbg("RENDER", {
      rowsLen: rows.length,
      visibleHeaders: visibleHeaders.length,
      loading,
      error,
      totalCount,
      page,
      pageSize,
      sort,
    });
  }, [rows, visibleHeaders, loading, error, totalCount, page, pageSize, sort]);

  const colWidth: Record<string, string> = {
    orderDate: "130px",
    sku: "260px",
    name: "240px",
    qty: "90px",
    totalPrice: "120px",
    unitPrice: "110px",
    supplier: "120px",
    orderNo: "150px",
  };

  const renderHeaderLabel = (headerKey: string, label: string) => {
    const isActive = sort.key === headerKey;
    const isDesc = isActive && sort.dir === "DESC";
    const icon = isActive ? (isDesc ? "▼" : "▲") : "▲";
    const colorCls = isActive ? (isDesc ? "text-blue-600" : "text-gray-500") : "text-gray-400";
    return (
      <span className="inline-flex items-center gap-1 select-none">
        <span>{label}</span>
        <span className={`text-[11px] leading-none ${colorCls}`} aria-hidden={true}>
          {icon}
        </span>
      </span>
    );
  };

  return (
    <div className="p-3">
      <AssistiveTextFix />

      <FilterBox
        value={filter}
        onChange={setFilter}
        onSubmit={handleSearchSubmit}
        onReset={handleReset}
      />

      <DataTable rows={rowsForCarbon} headers={visibleHeaders as any} useZebraStyles size="lg">
        {({ rows: carbonRows, headers, getHeaderProps, getRowProps, getSelectionProps }) => {
          const selectedIds = carbonRows.filter((r: any) => r.isSelected).map((r: any) => r.id);
          const selectedCount = selectedIds.length;

          return (
            <>
              <ButtonGroup
                selectedCount={selectedCount}
                visibleKeys={visibleKeys}
                onToggleKey={toggleKey}
                onEdit={() => handleEdit(selectedIds)}
                onDelete={() => handleDelete(selectedIds)}
                onDownload={handleDownloadCSV}
              />

              <TableContainer className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="max-h-[560px] overflow-auto">
                  <Table
                    aria-label="입고등록 조회 테이블"
                    className={[
                      "min-w-full w-full table-fixed border-collapse",
                      "[&>thead>tr>th]:sticky [&>thead>tr>th]:top-0 [&>thead>tr>th]:z-10",
                      "[&>thead>tr]:bg-gray-50 [&>thead>tr>th]:bg-gray-50 [&>thead>tr>th]:text-gray-800",
                      "[&>thead>tr>th]:border-b border-gray-200",
                      "[&>tbody>tr>td]:py-3 [&>thead>tr>th]:py-3",
                      "[&>thead>tr>th]:whitespace-nowrap",
                      "[&>thead>tr>th]:text-center [&>tbody>tr>td]:text-center",
                    ].join(" ")}
                  >
                    <colgroup>
                      <col style={{ width: "44px" }} />
                      {headers.map((h: any) => (
                        <col key={`col-${h.key}`} style={{ width: colWidth[h.key] ?? "auto" }} />
                      ))}
                    </colgroup>

                    <TableHead>
                      <TableRow>
                        <TableSelectAll {...getSelectionProps()} />
                        {headers.map((header: any) => {
                          const propsNoKey = stripKey(
                            getHeaderProps({ header, isSortable: true }),
                          );
                          return (
                            <TableHeader
                              key={header.key}
                              {...wrapHeaderProps(propsNoKey, header)}
                              className="text-gray-800 font-semibold text-base text-center"
                            >
                              {renderHeaderLabel(header.key, header.header)}
                            </TableHeader>
                          );
                        })}
                      </TableRow>
                    </TableHead>

                    <TableBody>
                      {loading &&
                        Array.from({ length: 6 }).map((_, i) => (
                          <TableRow key={`sk-${i}`} className="border-b border-gray-100">
                            <TableCell />
                            {headers.map((h: any) => (
                              <TableCell key={`sk-${i}-${h.key}`}>
                                <SkeletonText heading={false} lineCount={1} width="70%" />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}

                      {!loading && error && (
                        <TableRow>
                          <TableCell colSpan={(headers as any[]).length + 1}>
                            <div className="py-10 text-center text-red-600">
                              조회 중 오류가 발생했어요: <b>{String(error)}</b>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}

                      {!loading &&
                        !error &&
                        carbonRows.map((row: any) => (
                          <TableRow
                            {...getRowProps({ row })}
                            className="border-b border-gray-100 hover:bg-gray-50"
                            key={row.id}
                          >
                            <TableSelectRow {...getSelectionProps({ row })} />
                            {row.cells.map((cell: any, idx: number) => {
                              const key = (headers as any[])[idx]?.key as string | undefined;
                              const cls =
                                key === "name"
                                  ? "text-center text-sm ellipsis"
                                  : key === "sku" || key === "orderNo"
                                  ? "text-center text-sm font-mono ellipsis-sku"
                                  : "text-center text-sm";
                              return (
                                <TableCell key={cell.id} className={cls}>
                                  {cell.value}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}

                      {!loading && !error && carbonRows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={(headers as any[]).length + 1}>
                            <div className="py-10 text-center text-gray-500">
                             입고 내역이 없습니다.
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-2 border-top border-gray-100 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-gray-600">
                    총 <b>{fmtInt(totalCount)}</b>건 · 현재 페이지 수량{" "}
                    <b>{fmtInt(summary.qty)}</b> · 금액 <b>{fmtInt(summary.amount)}</b>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="rounded-md border px-2 py-1 text-sm"
                      value={pageSize}
                      onChange={(e) => {
                        const ps = Number(e.target.value) as 10 | 25;
                        setPageSize(ps);
                        setPage(1);
                      }}
                    >
                      <option value={10}>10개씩</option>
                      <option value={25}>25개씩</option>
                    </select>
                    <div className="flex items-center gap-1 text-sm text-gray-700">
                      <button
                        className="rounded-md border px-2 py-1 disabled:opacity-40"
                        disabled={page <= 1 || loading}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        이전
                      </button>
                      <span className="px-2">
                        {page} / {maxPage}
                      </span>
                      <button
                        className="rounded-md border px-2 py-1 disabled:opacity-40"
                        disabled={page >= maxPage || loading}
                        onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                      >
                        다음
                      </button>
                    </div>
                  </div>
                </div>
              </TableContainer>

              {/* 수정 모달 렌더링 */}
              <EditModal
                open={!!editTarget}
                target={editTarget}
                form={editForm}
                saving={editSaving}
                onChange={setEditForm}
                onClose={() => {
                  if (!editSaving) setEditTarget(null);
                }}
                onSubmit={handleEditSubmit}
              />
            </>
          );
        }}
      </DataTable>
    </div>
  );
}
