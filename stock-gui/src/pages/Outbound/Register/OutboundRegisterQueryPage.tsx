/**
 * UI Components based on Carbon Design System by IBM.
 * Licensed under the Apache License 2.0
 * http://www.apache.org/licenses/LICENSE-2.0
 */

// src/pages/outbound/register/OutboundRegisterQueryPage.tsx
// 출고관리 -> 출고등록 -> 조회탭

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

/* ────────────────────────────────────────────────────────────────
 * 타입, 헤더 정의
 * ────────────────────────────────────────────────────────────────*/
type Row = {
  id: string;         // Carbon row id (itemId 문자열)
  headerId: number;   // header_id
  itemId: number;     // item_id
  country: string;    // 국가
  orderNo: string;    // 주문번호
  trackingNo: string; // 트래킹번호
  sku: string;        // SKU 코드
  name: string;       // 상품명
  quantity: number;   // 출고수량
  totalPrice: number; // 총 가격(숫자)
  status: string;     // 상태(draft, picking, completed, canceled 등) - 표시용은 아님
};

const ALL_HEADERS = [
  { key: "country", header: "국가" },
  { key: "orderNo", header: "주문번호" },
  { key: "trackingNo", header: "트래킹번호" },
  { key: "sku", header: "SKU" },
  { key: "name", header: "상품명" },
  { key: "quantity", header: "출고수량" },
  { key: "totalPrice", header: "총 가격" },
] as const;

/** 숫자 세 자리 콤마 포맷터 */
const fmtInt = (n: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n);

/* ────────────────────────────────────────────────────────────────
 * 필터 박스
 * ────────────────────────────────────────────────────────────────*/
function FilterBox(props: {
  value: { keyword?: string };
  onChange: (v: { keyword?: string }) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const { value, onChange, onSubmit, onReset } = props;

  return (
    <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
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
        <div className="flex items-end gap-2">
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
 * 상단 우측 액션 버튼
 * ────────────────────────────────────────────────────────────────*/
function ButtonGroup(props: {
  selectedCount: number;
  visibleKeys: Set<string>;
  onToggleKey: (k: string) => void;
  onEdit?: () => void;
  onDelete?: () => void;
  onDownload?: () => void;
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
        다운로드(xlsx)
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
 * 스타일
 * ────────────────────────────────────────────────────────────────*/
const AssistiveTextFix = () => (
  <style>{`
    :root .cds--assistive-text,
    :root .cds--table-sort__description {
      position: absolute !important;
      width: 1px !important;
      height: 1px !important;
      overflow: hidden !important;
      clip: rect(1px, 1px, 1px) !important;
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
export default function RegisterQueryPage() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [filter, setFilter] = useState<{ keyword?: string }>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25>(10);
  const [sort, setSort] = useState<{ key?: string; dir?: "ASC" | "DESC" }>({
    key: "orderNo",
    dir: "DESC",
  });

  // ✅ DataTable 강제 리마운트용 키 (수정/삭제 후 선택 상태 초기화)
  const [reloadKey, setReloadKey] = useState(0);

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(
    new Set(ALL_HEADERS.map((h) => h.key))
  );
  const toggleKey = (k: string) =>
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  const rowMap = useMemo(
    () => new Map(rows.map((r) => [r.id, r])),
    [rows]
  );

  // sort key → 백엔드 sort_by 매핑
  const mapSortKeyToBackend = (key?: string): string | undefined => {
    switch (key) {
      case "country":
        return "country";
      case "orderNo":
        return "order_number";
      case "trackingNo":
        return "tracking_number";
      case "sku":
        return "sku";
      case "name":
        return "product_name";
      case "quantity":
        return "qty";
      case "totalPrice":
        return "total_price";
      default:
        return undefined;
    }
  };

  /** 목록 조회 */
  async function fetchList(args?: {
    page?: number;
    pageSize?: number;
    sort?: { key?: string; dir?: "ASC" | "DESC" };
    filter?: { keyword?: string };
  }) {
    const nextPage = args?.page ?? page;
    const nextSize = args?.pageSize ?? pageSize;
    const nextSort = args?.sort ?? sort;
    const nextFilter = args?.filter ?? filter;

    setLoading(true);
    try {
      const sort_by = mapSortKeyToBackend(nextSort.key);
      const sort_dir =
        nextSort.dir === "DESC"
          ? ("desc" as const)
          : nextSort.dir === "ASC"
          ? ("asc" as const)
          : undefined;

      const res = await outboundAdapter.fetchRegisterList({
        keyword: nextFilter.keyword || undefined,
        page: nextPage,
        size: nextSize,
        sort_by,
        sort_dir,
      });

      if (!res.ok) {
        return handleError(res.error);
      }
      if (!res.data) {
        return handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
        } as any);
      }

      const raw: any = res.data;
      const result = (raw.result ?? raw) as {
        items?: any[];
        total_count?: number;
        page?: number;
        size?: number;
      };

      const items = result.items ?? [];

      const getStatus = (it: any): string => {
        const rawStatus =
          it.status ??
          it.header_status ??
          it.headerStatus ??
          it.item_status ??
          it.itemStatus ??
          "";
        return String(rawStatus).toLowerCase();
      };

      const mapped: Row[] = items.map((it) => {
        const status = getStatus(it);
        return {
          id: String(it.item_id),
          headerId: it.header_id,
          itemId: it.item_id,
          country: it.country,
          orderNo: it.order_number,
          trackingNo: it.tracking_number ?? "",
          sku: it.sku,
          name: it.product_name,
          quantity: it.qty,
          totalPrice: Number(it.total_price),
          status,
        };
      });

      setRows(mapped);
      setTotalCount(mapped.length);
    } catch (err: any) {
      console.error(err);
      handleError(err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchList({ page, pageSize, sort, filter });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sort, filter]);

  // xlsx 다운로드
  const handleDownloadXlsx = async (selectedItemIds: number[]) => {
    if (selectedItemIds.length === 0) return;
    try {
      const res = await outboundAdapter.exportRegisterItems({
        action: "export",
        ids: selectedItemIds,
        payload: {},
      });

      if (!res.ok) {
        return handleError(res.error);
      }
      if (!res.data) {
        return handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
        } as any);
      }

      const blob = res.data;
      const url = URL.createObjectURL(blob);
      const today = new Date().toISOString().slice(0, 10);
      const a = document.createElement("a");
      a.href = url;
      a.download = `outbound-register-${today}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      console.error(err);
      handleError(err);
    }
  };

  // 수정(단건)
  const handleEditOne = async (row: Row) => {
    const nextCountry =
      window.prompt("국가 코드를 입력하세요.", row.country) ?? row.country;
    const nextOrderNo =
      window.prompt("주문번호를 입력하세요.", row.orderNo) ?? row.orderNo;
    const nextTrackingNo =
      window.prompt("트래킹번호를 입력하세요.", row.trackingNo) ??
      row.trackingNo;
    const nextSku =
      window.prompt("SKU를 입력하세요.", row.sku) ?? row.sku;
    const qtyStr =
      window.prompt("출고수량을 입력하세요.", String(row.quantity)) ??
      String(row.quantity);
    const totalPriceStr =
      window.prompt(
        "총 가격(숫자 또는 1500.00 형태)을 입력하세요.",
        String(row.totalPrice)
      ) ?? String(row.totalPrice);

    const qty = Number(qtyStr);
    if (Number.isNaN(qty) || qty <= 0) {
      window.alert("출고수량은 1 이상 숫자만 가능합니다.");
      return;
    }

    try {
      const res = await outboundAdapter.updateRegisterItem({
        action: "update",
        ids: [row.itemId],
        payload: {
          country: nextCountry,
          order_number: nextOrderNo,
          tracking_number: nextTrackingNo,
          sku: nextSku,
          qty,
          total_price: totalPriceStr,
        },
      });

      if (!res.ok) {
        return handleError(res.error);
      }
      if (!res.data) {
        return handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
        } as any);
      }

      window.alert("출고정보가 수정되었습니다.");

      // ✅ 수정 후: 첫 페이지로 이동 + DataTable 리마운트 + 목록 새로 조회
      setPage(1);
      setReloadKey((k) => k + 1);
      fetchList({ page: 1, pageSize, sort, filter });
    } catch (err: any) {
      console.error(err);
      handleError(err);
    }
  };

  // 삭제(다건)
  const handleDeleteMany = async (selectedItemIds: number[]) => {
    if (selectedItemIds.length === 0) return;
    if (!window.confirm(`선택한 ${selectedItemIds.length}건을 삭제할까요?`)) {
      return;
    }

    try {
      const res = await outboundAdapter.deleteRegisterItems({
        action: "delete",
        ids: selectedItemIds,
        payload: {},
      });

      if (!res.ok) {
        return handleError(res.error);
      }
      if (!res.data) {
        return handleError({
          code: "FRONT-UNEXPECTED-001",
          message: "처리 중 오류가 발생했습니다. 다시 시도해 주세요.",
        } as any);
      }

      const deletedCount = res.data.result.deleted_count ?? 0;
      window.alert(`총 ${deletedCount}건이 삭제되었습니다.`);

      const remain = rows.length - deletedCount;
      const nextPage = remain <= 0 && page > 1 ? page - 1 : page;

      // ✅ 삭제 후: 페이지 재계산 + DataTable 리마운트 + 목록 새로 조회
      setPage(nextPage);
      setReloadKey((k) => k + 1);
      fetchList({ page: nextPage, pageSize, sort, filter });
    } catch (err: any) {
      console.error(err);
      handleError(err);
    }
  };

  // 표시 중인 헤더만 사용
  const visibleHeaders = useMemo(
    () => ALL_HEADERS.filter((h) => visibleKeys.has(h.key)),
    [visibleKeys]
  );

  // Carbon rows 변환
  const rowsForCarbon = rows.map((r) => {
    const base: any = { id: r.id };
    for (const h of visibleHeaders) {
      const k = h.key as keyof Row;
      base[k] =
        k === "quantity"
          ? fmtInt(r.quantity)
          : k === "totalPrice"
          ? fmtInt(r.totalPrice)
          : (r as any)[k];
    }
    return base;
  });

  const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));

  // key 경고 제거 + 정렬 토글
  const wrapHeaderProps = (orig: any, header: any) => {
    const { key, ...rest } = orig || {};
    const onClick = (e: any) => {
      if (rest?.onClick) rest.onClick(e);
      const k = header.key as string;
      setSort((prev) => {
        const nextDir =
          prev.key !== k ? "ASC" : prev.dir === "ASC" ? "DESC" : "ASC";
        return { key: k, dir: nextDir };
      });
      setPage(1);
    };
    return { ...rest, onClick };
  };

  // 컬럼 폭
  const colWidth: Record<string, string> = {
    country: "90px",
    orderNo: "180px",
    trackingNo: "200px",
    sku: "260px",
    name: "240px",
    quantity: "90px",
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
      <span className="inline-flex items-center gap-1 select-none">
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
        key={reloadKey} // ✅ 수정/삭제 후 리마운트용
        rows={rowsForCarbon}
        headers={visibleHeaders as any}
        useZebraStyles
        size="lg"
      >
        {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps }) => {
          const selectedCarbonRows = rows.filter((r: any) => r.isSelected);
          const selectedCount = selectedCarbonRows.length;
          const selectedDataRows: Row[] = selectedCarbonRows
            .map((r: any) => rowMap.get(r.id) || null)
            .filter((r): r is Row => r !== null);
          const selectedItemIds = selectedDataRows.map((r) => r.itemId);

          return (
            <>
              <ButtonGroup
                selectedCount={selectedCount}
                visibleKeys={visibleKeys}
                onToggleKey={toggleKey}
                onEdit={() => {
                  if (selectedDataRows.length === 1) {
                    handleEditOne(selectedDataRows[0]);
                  }
                }}
                onDelete={() => handleDeleteMany(selectedItemIds)}
                onDownload={() => handleDownloadXlsx(selectedItemIds)}
              />

              <TableContainer className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="max-h-[560px] overflow-auto">
                  <Table
                    aria-label="출고등록 조회 테이블"
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
                          const hp = getHeaderProps({
                            header,
                            isSortable: true,
                          });
                          const wrapped = wrapHeaderProps(hp, header);
                          return (
                            <TableHeader
                              key={header.key}
                              {...wrapped}
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
                            <TableSelectRow {...getSelectionProps({ row })} />
                            {row.cells.map((cell: any, idx: number) => {
                              const key = (headers as any[])[idx]?.key as
                                | string
                                | undefined;
                              const cls =
                                key === "name"
                                  ? "text-center text-sm ellipsis"
                                  : key === "sku"
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

                <div className="flex flex-col gap-2 border-t border-gray-100 p-3 md:flex-row md:items-center md:justify-between">
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
