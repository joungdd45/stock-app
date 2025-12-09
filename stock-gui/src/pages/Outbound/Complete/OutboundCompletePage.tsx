/**
 * 📄 src/pages/outbound/Complete/CompletePage.tsx
 * 출고관리 > 출고 완료 (조회 + 출고취소/엑셀 내보내기)
 * - 출고일자 열을 국가보다 앞에 배치
 * - 중량(g) 열 추가
 * - 하단 요약: 총 건수만 표시
 */

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
import { outboundAdapter } from "@/api/adapters/outbound.adapter";
import { handleError } from "@/utils/handleError";
import type { ApiError } from "@/api/hub/apiHub";

/* ────────────────────────────────────────────────────────────────
 * 타입
 * ────────────────────────────────────────────────────────────────*/
type Row = {
  id: string;
  outboundDate: string; // 출고일자 YYYY-MM-DD
  country: string; // 국가 (SG, MY, PH 등)
  orderNo: string; // 주문번호
  trackingNo: string; // 트래킹번호
  sku: string; // SKU
  name: string; // 상품명
  quantity: number; // 출고수량
  weight: number; // 중량(g)
  totalPrice: number; // 총가격
};

/* ✅ 헤더 순서:
 * 출고일자 → 국가 → 주문번호 → 트래킹번호 → SKU → 상품명 → 출고수량 → 중량(g) → 총가격
 */
const ALL_HEADERS = [
  { key: "outboundDate", header: "출고일자" },
  { key: "country", header: "국가" },
  { key: "orderNo", header: "주문번호" },
  { key: "trackingNo", header: "트래킹번호" },
  { key: "sku", header: "SKU" },
  { key: "name", header: "상품명" },
  { key: "quantity", header: "출고수량" },
  { key: "weight", header: "중량(g)" },
  { key: "totalPrice", header: "총가격" },
] as const;

const SORT_KEY_MAP: Record<string, string> = {
  outboundDate: "outbound_date",
  country: "country",
  orderNo: "order_number",
  trackingNo: "tracking_number",
  sku: "sku",
  name: "product_name",
  quantity: "qty",
  weight: "weight_g",
  totalPrice: "sales_total",
};

const fmtInt = (n: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n);

/* ────────────────────────────────────────────────────────────────
 * 필터 박스
 * ────────────────────────────────────────────────────────────────*/
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
          <span className="mb-1 text-gray-600">출고일 시작</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.from ?? ""}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">출고일 종료</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.to ?? ""}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
          />
        </label>
        <label className="flex flex-col text-sm md:col-span-2">
          <span className="mb-1 text-gray-600">키워드</span>
          <input
            type="text"
            placeholder="국가, 주문번호, 트래킹번호, SKU, 상품명"
            className="rounded-lg border px-3 py-2"
            value={value.keyword ?? ""}
            onChange={(e) => onChange({ ...value, keyword: e.target.value })}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="ml-auto flex gap-2">
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={onReset}
          >
            초기화
          </button>
          <button
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

/* ────────────────────────────────────────────────────────────────
 * 버튼 그룹 (출고취소 / 엑셀 내보내기)
 * ────────────────────────────────────────────────────────────────*/
function ButtonGroup(props: {
  selectedCount: number;
  selectedIds: string[];
  visibleKeys: Set<string>;
  onToggleKey: (k: string) => void;
  onCancelOutbound?: (ids: string[]) => void;
  onExport?: (ids: string[]) => void;
}) {
  const disCancel = props.selectedCount !== 1; // 한 건만 허용
  const disExport = props.selectedCount === 0;

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
          disCancel ? "bg-gray-200 text-gray-500" : "bg-emerald-600 text-white"
        }`}
        disabled={disCancel}
        onClick={() => props.onCancelOutbound?.(props.selectedIds)}
      >
        출고취소
      </button>

      <button
        className={`rounded-xl px-4 py-2 text-sm ${
          disExport ? "bg-gray-200 text-gray-500" : "bg-gray-900 text-white"
        }`}
        disabled={disExport}
        onClick={() => props.onExport?.(props.selectedIds)}
      >
        엑셀 내보내기
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
              <label
                key={h.key}
                className="flex items-center gap-2 p-1 text-sm"
              >
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

/* ────────────────────────────────────────────────────────────────
 * 스타일 보정
 * ────────────────────────────────────────────────────────────────*/
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
    :root .cds--table-sort__icon-unsorted {
      display: none !important;
    }
    th .cds--checkbox-label, td .cds--checkbox-label { display: none !important; }
    th.cds--table-column-checkbox, td.cds--table-column-checkbox,
    th:first-child, td:first-child { text-align: center !important; }
    th:first-child .cds--checkbox-wrapper, td:first-child .cds--checkbox-wrapper { margin: 0 auto !important; }

    .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 420px; }
    .ellipsis-sku { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 360px; }
  `}</style>
);

/* ────────────────────────────────────────────────────────────────
 * 메인 컴포넌트
 * ────────────────────────────────────────────────────────────────*/
export default function CompletePage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [filter, setFilter] = useState<{
    from?: string;
    to?: string;
    keyword?: string;
  }>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25>(25);
  const [sort, setSort] = useState<{ key?: string; dir?: "ASC" | "DESC" }>({
    key: "outboundDate",
    dir: "DESC",
  });

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(
    new Set(ALL_HEADERS.map((h) => h.key)),
  );
  const toggleKey = (k: string) =>
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  /* 목록 조회: 백엔드 /api/outbound/complete/list 연동 */
  async function fetchList(params: {
    page: number;
    pageSize: number;
    sort?: { key?: string; dir?: "ASC" | "DESC" };
    filter?: { from?: string; to?: string; keyword?: string };
  }) {
    setLoading(true);
    try {
      const { page, pageSize, sort, filter } = params;

      const sortKey = sort?.key ? SORT_KEY_MAP[sort.key] : undefined;
      const sortDir =
        sort?.dir === "DESC" ? "desc" : sort?.dir === "ASC" ? "asc" : undefined;

      const res = await outboundAdapter.fetchCompleteList({
        from_date: filter?.from || undefined,
        to_date: filter?.to || undefined,
        q: filter?.keyword || undefined,
        page,
        size: pageSize,
        sort_by: sortKey,
        sort_dir: sortDir,
      });

      if (!res.ok) {
        handleError(res.error as ApiError);
        setRows([]);
        setTotalCount(0);
        return;
      }
      if (!res.data) {
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "출고 완료 목록 조회에 실패했습니다.",
        } as ApiError);
        setRows([]);
        setTotalCount(0);
        return;
      }

      // ✅ 여기 한 줄 추가
      console.log("outbound-complete raw data >>>", res.data);      

      const payload: any = res.data;
      const result = payload.result ?? payload;

      if (!result || !Array.isArray(result.items)) {
        console.error("unexpected outbound-complete list payload", payload);
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "출고 완료 목록 응답 형식이 예상과 다릅니다.",
        } as ApiError);
        setRows([]);
        setTotalCount(0);
        return;
      }

      setRows(
        result.items.map((item: any) => ({
          id: String(item.item_id),
          outboundDate: item.outbound_date,
          country: item.country,
          orderNo: item.order_number,
          trackingNo: item.tracking_number,
          sku: item.sku,
          name: item.product_name,
          quantity: item.qty,
          weight: item.weight_g,
          totalPrice: item.sales_total,
        })),
      );
      setTotalCount(result.count ?? result.items.length);
    } catch (e) {
      console.error(e);
      handleError(e as ApiError);
      setRows([]);
      setTotalCount(0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchList({ page, pageSize, sort, filter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sort, filter]);

  const visibleHeaders = useMemo(
    () => ALL_HEADERS.filter((h) => visibleKeys.has(h.key)),
    [visibleKeys],
  );

  const rowsForCarbon = rows.map((r) => {
    const base: any = { id: r.id };
    for (const h of visibleHeaders) {
      const k = h.key as keyof Row;
      base[k] =
        k === "quantity"
          ? fmtInt(r.quantity)
          : k === "totalPrice"
          ? fmtInt(r.totalPrice)
          : k === "weight"
          ? fmtInt(r.weight)
          : (r as any)[k];
    }
    return base;
  });

  const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));

  const wrapHeaderProps = (orig: any, header: any) => {
    const onClick = (e: any) => {
      if (orig?.onClick) orig.onClick(e);
      const key = header.key as string;
      setSort((prev) => {
        const nextDir =
          prev.key !== key ? "ASC" : prev.dir === "ASC" ? "DESC" : "ASC";
        return { key, dir: nextDir };
      });
      setPage(1);
    };
    const { key, ...rest } = orig || {};
    return { ...rest, onClick };
  };

  const colWidth: Record<string, string> = {
    outboundDate: "130px",
    country: "90px",
    orderNo: "180px",
    trackingNo: "200px",
    sku: "260px",
    name: "240px",
    quantity: "90px",
    weight: "100px",
    totalPrice: "120px",
  };

  const renderHeaderLabel = (headerKey: string, label: string) => {
    const isActive = sort.key === headerKey;
    const isDesc = isActive && sort.dir === "DESC";
    const icon = isActive ? (isDesc ? "▼" : "▲") : "▲";
    const colorCls = isActive
      ? isDesc
        ? "text-blue-600"
        : "text-gray-500"
      : "text-gray-400";
    return (
      <span className="inline-flex select-none items-center gap-1">
        <span>{label}</span>
        <span
          className={`text-[11px] leading-none ${colorCls}`}
          aria-hidden="true"
        >
          {icon}
        </span>
      </span>
    );
  };

  const handleExport = async (selectedIds: string[]) => {
    if (!selectedIds.length) return;

    const ids = selectedIds
      .map((id) => Number(id))
      .filter((n) => !Number.isNaN(n));

    if (!ids.length) {
      alert("선택한 행의 ID가 올바르지 않습니다.");
      return;
    }

    try {
      setLoading(true);
      const res = await outboundAdapter.exportComplete({ ids });
      if (!res.ok) {
        handleError(res.error as ApiError);
        return;
      }
      if (!res.data) {
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "엑셀 내보내기에 실패했습니다.",
        } as ApiError);
        return;
      }

      const payload: any = res.data;
      const result = payload.result ?? payload;

      const { file_name, content_type, content_base64, count } = result;

      if (!content_base64) {
        alert("엑셀 파일 내용이 비어 있습니다.");
        return;
      }

      const byteCharacters = atob(content_base64);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], {
        type:
          content_type ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        file_name ||
        `outbound_complete_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (typeof count === "number") {
        console.log(`엑셀 내보내기: ${count}건`);
      }
    } catch (e) {
      console.error(e);
      handleError(e as ApiError);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelOutbound = async (selectedIds: string[]) => {
    if (selectedIds.length !== 1) {
      alert("출고취소는 한 건만 선택해서 처리할 수 있습니다.");
      return;
    }
    const idNum = Number(selectedIds[0]);
    if (Number.isNaN(idNum)) {
      alert("선택한 행의 ID가 올바르지 않습니다.");
      return;
    }
    if (!window.confirm("선택한 출고를 취소하시겠습니까?")) return;

    try {
      const res = await outboundAdapter.cancelComplete({
        ids: [idNum],
        reason: "사용자 요청 출고취소",
      });
      if (!res.ok) {
        handleError(res.error as ApiError);
        return;
      }
      if (!res.data) {
        handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "출고취소 처리에 실패했습니다.",
        } as ApiError);
        return;
      }
      alert("출고취소가 완료되었습니다.");
      fetchList({ page, pageSize, sort, filter });
    } catch (e) {
      console.error(e);
      handleError(e as ApiError);
    }
  };

  return (
    <div className="p-3">
      <AssistiveTextFix />

      <FilterBox
        value={filter}
        onChange={(v) => setFilter(v)}
        onSubmit={() => setPage(1)}
        onReset={() => {
          setFilter({});
          setPage(1);
        }}
      />

      <DataTable
        rows={rowsForCarbon}
        headers={visibleHeaders as any}
        useZebraStyles
        size="lg"
      >
        {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps }) => {
          const selectedRows = rows.filter((r: any) => r.isSelected);
          const selectedCount = selectedRows.length;
          const selectedIds = selectedRows.map((r: any) => String(r.id));

          return (
            <>
              <ButtonGroup
                selectedCount={selectedCount}
                selectedIds={selectedIds}
                visibleKeys={visibleKeys}
                onToggleKey={(k) =>
                  setVisibleKeys((prev) => {
                    const next = new Set(prev);
                    next.has(k) ? next.delete(k) : next.add(k);
                    return next;
                  })
                }
                onCancelOutbound={handleCancelOutbound}
                onExport={handleExport}
              />

              <TableContainer className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="max-h-[560px] overflow-auto">
                  <Table
                    aria-label="출고 완료 조회 테이블"
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
                        <col
                          key={`col-${h.key}`}
                          style={{ width: colWidth[h.key] ?? "auto" }}
                        />
                      ))}
                    </colgroup>

                    <TableHead>
                      <TableRow>
                        <TableSelectAll {...getSelectionProps()} />
                        {headers.map((header: any) => {
                          const hpRaw = getHeaderProps({
                            header,
                            isSortable: true,
                          });
                          const { key, ...hp } = hpRaw;
                          return (
                            <TableHeader
                              key={header.key}
                              {...wrapHeaderProps(hp, header)}
                              className="text-center text-base font-semibold text-gray-800"
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
                          <TableRow
                            key={`sk-${i}`}
                            className="border-b border-gray-100"
                          >
                            <TableCell />
                            {headers.map((h: any) => (
                              <TableCell key={`sk-${i}-${h.key}`}>
                                <SkeletonText
                                  heading={false}
                                  lineCount={1}
                                  width="70%"
                                />
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}

                      {!loading &&
                        rows.map((row: any) => (
                          <TableRow
                            {...getRowProps({ row })}
                            className="border-b border-gray-100 hover:bg-gray-50"
                            key={row.id}
                          >
                            <TableSelectRow
                              {...getSelectionProps({ row })}
                            />
                            {row.cells.map((cell: any, idx: number) => {
                              const key = (headers as any[])[idx]?.key as
                                | string
                                | undefined;
                              const cls =
                                key === "name"
                                  ? "ellipsis text-center text-sm"
                                  : key === "sku"
                                  ? "ellipsis-sku text-center text-sm font-mono"
                                  : "text-center text-sm";

                              return (
                                <TableCell key={cell.id} className={cls}>
                                  {cell.value}
                                </TableCell>
                              );
                            })}
                          </TableRow>
                        ))}

                      {!loading && rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={(headers as any[]).length + 1}>
                            <div className="py-10 text-center text-gray-500">
                              조건에 맞는 결과가 없습니다.
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-2 border-top border-gray-100 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-gray-600">
                    총 <b>{fmtInt(totalCount)}</b>건
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
                        onClick={() => setPage((p) => p + 1)}
                      >
                        다음
                      </button>
                    </div>
                  </div>
                </div>
              </TableContainer>
            </>
          );
        }}
      </DataTable>
    </div>
  );
}
