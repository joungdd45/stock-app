/* src/pages/outbound/cancel/OutboundCancelPage.tsx
 * 역할: 출고관리 > 출고취소 (조회 + 재출고/엑셀)
 *
 * 백엔드 연동:
 *  - GET  /api/outbound/cancel/list     → outboundAdapter.fetchCancelList
 *  - POST /api/outbound/cancel/reissue  → outboundAdapter.reissueFromCancel
 *  - GET  /api/outbound/cancel/export   → outboundAdapter.exportCancelExcel
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
import { useNavigate } from "react-router-dom";
import {
  outboundAdapter,
  type ActionEnvelope,
  type OutboundCancelListResult,
} from "@/api/adapters/outbound.adapter";
import { handleError } from "@/utils/handleError";

/* ────────────────────────────────────────────────────────────────
 * 타입, 헤더 정의
 * ────────────────────────────────────────────────────────────────*/
type Row = {
  id: string;
  headerId: number;
  itemId: number;
  country: string;
  orderNo: string;
  trackingNo: string;
  sku: string;
  name: string;
  quantity: number;
  totalPrice: number;
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
 * 날짜 범위 필터 박스 (From/To)
 * ────────────────────────────────────────────────────────────────*/
function DateFilterBox(props: {
  value: { from?: string; to?: string };
  onChange: (v: { from?: string; to?: string }) => void;
  onSubmit: () => void;
  onReset: () => void;
}) {
  const { value, onChange, onSubmit, onReset } = props;

  return (
    <div className="mb-3 rounded-2xl border border-gray-200 bg-white p-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">시작일 From</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.from ?? ""}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">종료일 To</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.to ?? ""}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
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
      <p className="mt-2 text-xs text-gray-500">
        날짜는 취소일 기준으로 필터링됩니다.
      </p>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────
 * 상단 우측 액션 버튼
 *  - 재출고: 한 건 선택 기준
 *  - 엑셀 내보내기: 선택된 헤더 기준
 *  - 열 보이기
 * ────────────────────────────────────────────────────────────────*/
function ButtonGroup(props: {
  selectedCount: number;
  visibleKeys: Set<string>;
  onToggleKey: (k: string) => void;
  onReopen?: () => void; // 재출고
  onDownload?: () => void; // 엑셀
}) {
  const disNone = props.selectedCount === 0;

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
          disNone ? "bg-gray-200 text-gray-500" : "bg-emerald-600 text-white"
        }`}
        disabled={disNone}
        onClick={props.onReopen}
      >
        재출고
      </button>
      <button
        className={`rounded-xl px-4 py-2 text-sm ${
          disNone ? "bg-gray-200 text-gray-500" : "border bg-white text-gray-800"
        }`}
        disabled={disNone}
        onClick={props.onDownload}
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
 * 스타일: 보조텍스트 숨김 + 정렬 아이콘 커스텀
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
export default function OutboundCancelPage() {
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<Row[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const [filter, setFilter] = useState<{ from?: string; to?: string }>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25>(10);
  const [sort, setSort] = useState<{ key?: string; dir?: "ASC" | "DESC" }>({
    key: "orderNo",
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

  /* Row id → Row 매핑 (headerId 가져오기용) */
  const rowMap = useMemo(() => {
    const m = new Map<string, Row>();
    rows.forEach((r) => m.set(r.id, r));
    return m;
  }, [rows]);

// ─────────────────────────────────────────────
// 목록 조회: /api/outbound/cancel/list
// ─────────────────────────────────────────────
async function fetchList(
  options?: Partial<{
    page: number;
    pageSize: number;
    filter: { from?: string; to?: string };
  }>,
) {
  const nextPage = options?.page ?? page;
  const nextPageSize = (options?.pageSize ?? pageSize) as 10 | 25;
  const f = options?.filter ?? filter;

  setLoading(true);
  try {
    const res = await outboundAdapter.fetchCancelList({
      from_date: f.from,
      to_date: f.to,
      page: nextPage,
      size: nextPageSize,
    });

    if (!res.ok || !res.data) {
      console.error("[OutboundCancel] list error", res.error);
      setRows([]);
      setTotalCount(0);
      if (res.error) handleError(res.error);
      return;
    }

    // 🔽 여기부터 수정
    const raw = res.data as any;
    const result = (raw.result ?? raw) as OutboundCancelListResult;

    if (!result || !Array.isArray(result.items)) {
      console.error("[OutboundCancel] invalid list payload", res.data);
      setRows([]);
      setTotalCount(0);
      handleError({
        code: "FRONT-UNEXPECTED-001",
        message: "출고취소 목록 응답 형식이 올바르지 않습니다.",
      } as any);
      return;
    }

    const mapped: Row[] = result.items.map((item) => ({
      id: `${item.header_id}-${item.item_id}`,
      headerId: item.header_id,
      itemId: item.item_id,
      country: item.country,
      orderNo: item.order_number,
      trackingNo: item.tracking_number,
      sku: item.sku,
      name: item.product_name,
      quantity: item.qty,
      totalPrice: item.total_price,
    }));

    setRows(mapped);
    setTotalCount(result.pagination?.count ?? mapped.length);
  } catch (err) {
    console.error("[OutboundCancel] list exception", err);
    setRows([]);
    setTotalCount(0);
    handleError({
      code: "FRONT-UNEXPECTED-001",
      message: "출고취소 목록 조회 중 오류가 발생했습니다.",
    } as any);
  } finally {
    setLoading(false);
  }
}

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 페이지 합계(for reference)
  const summary = useMemo(() => {
    const qty = rows.reduce((s, r) => s + (r.quantity || 0), 0);
    const amount = rows.reduce((s, r) => s + (r.totalPrice || 0), 0);
    return { qty, amount };
  }, [rows]);
  void summary; // for reference only

  // 표시 중인 헤더만 사용
  const visibleHeaders = useMemo(
    () => ALL_HEADERS.filter((h) => visibleKeys.has(h.key)),
    [visibleKeys],
  );

  // Carbon rows로 변환
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

  // 총 페이지
  const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));

  // 헤더 클릭 시 정렬 상태 토글(프론트 정렬만, 서버 정렬은 이후 필요 시 추가)
  const wrapHeaderProps = (orig: any, header: any) => {
    const onClick = (e: any) => {
      if (orig?.onClick) orig.onClick(e);
      const key = header.key as string;
      setSort((prev) => {
        const nextDir =
          prev.key !== key ? "ASC" : prev.dir === "ASC" ? "DESC" : "ASC";
        return { key, dir: nextDir };
      });
      // 정렬 바뀌면 1페이지로(지금은 프론트 정렬이지만 일단 재조회는 유지)
      fetchList({ page: 1 });
    };
    return { ...orig, onClick };
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

  // 헤더 아이콘
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

      <DateFilterBox
        value={filter}
        onChange={(v) => setFilter(v)}
        onSubmit={() => {
          setPage(1);
          fetchList({ page: 1, filter });
        }}
        onReset={() => {
          const empty: { from?: string; to?: string } = {};
          setFilter(empty);
          setPage(1);
          fetchList({ page: 1, filter: empty });
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
          const selectedHeaderIds = Array.from(
            new Set(
              selectedIds
                .map((id) => rowMap.get(id)?.headerId)
                .filter((v): v is number => typeof v === "number"),
            ),
          );

          // 재출고 클릭
          const handleClickReopen = async () => {
            if (selectedHeaderIds.length === 0) {
              alert("재출고할 대상을 선택하세요.");
              return;
            }
            if (selectedHeaderIds.length > 1) {
              alert("재출고는 한 번에 한 건씩만 가능합니다.");
              return;
            }
            const headerId = selectedHeaderIds[0];
            if (!window.confirm("선택한 출고취소 건을 재출고하시겠습니까?")) {
              return;
            }

            try {
              setLoading(true);
              const res = await outboundAdapter.reissueFromCancel({
                header_ids: [headerId],
                action: "reissue",
              });
              if (!res.ok || !res.data) {
                if (res.error) {
                  handleError(res.error);
                } else {
                  handleError({
                    code: "FRONT-UNEXPECTED-001",
                    message: "재출고 처리에 실패했습니다.",
                  } as any);
                }
                return;
              }

              const envelope = res.data;
              const result = envelope.result;
              const orderNo = result?.order_number ?? "";

              alert(
                orderNo
                  ? `주문번호 ${orderNo} 재출고 전표가 생성되었습니다.`
                  : "재출고 전표가 생성되었습니다.",
              );

              // 목록 새로고침 + 출고등록 조회로 이동
              fetchList({ page: 1 });
              navigate("/outbound/register/query");
            } catch (err) {
              console.error("[OutboundCancel] reissue exception", err);
              handleError({
                code: "FRONT-UNEXPECTED-001",
                message: "재출고 처리 중 오류가 발생했습니다.",
              } as any);
            } finally {
              setLoading(false);
            }
          };

          // 엑셀 내보내기 클릭
          const handleClickExport = async () => {
            if (selectedHeaderIds.length === 0) {
              alert("엑셀로 내보낼 출고취소 건을 선택해 주세요.");
              return;
            }

            const headerIdsStr = selectedHeaderIds.join(",");

            try {
              setLoading(true);
              const res = await outboundAdapter.exportCancelExcel({
                from_date: filter.from,
                to_date: filter.to,
                header_ids: headerIdsStr,
              });

              if (!res.ok || !res.data) {
                if (res.error) {
                  handleError(res.error);
                } else {
                  handleError({
                    code: "FRONT-UNEXPECTED-001",
                    message: "엑셀 내보내기에 실패했습니다.",
                  } as any);
                }
                return;
              }

              const blob = res.data; // Blob
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `outbound_cancel_${new Date()
                .toISOString()
                .slice(0, 10)}.xlsx`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch (err) {
              console.error("[OutboundCancel] export exception", err);
              handleError({
                code: "FRONT-UNEXPECTED-001",
                message: "엑셀 내보내기 중 오류가 발생했습니다.",
              } as any);
            } finally {
              setLoading(false);
            }
          };

          return (
            <>
              <ButtonGroup
                selectedCount={selectedCount}
                visibleKeys={visibleKeys}
                onToggleKey={toggleKey}
                onReopen={handleClickReopen}
                onDownload={handleClickExport}
              />

              <TableContainer className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <div className="max-h-[560px] overflow-auto">
                  <Table
                    aria-label="출고취소 조회 테이블"
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
                          const headerProps = getHeaderProps({
                            header,
                            isSortable: true,
                          });
                          const { key, ...restProps } = headerProps as any;

                          return (
                            <TableHeader
                              key={header.key}
                              {...wrapHeaderProps(restProps, header)}
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
                        fetchList({ page: 1, pageSize: ps });
                      }}
                    >
                      <option value={10}>10개씩</option>
                      <option value={25}>25개씩</option>
                    </select>
                    <div className="flex items-center gap-1 text-sm text-gray-700">
                      <button
                        className="rounded-md border px-2 py-1 disabled:opacity-40"
                        disabled={page <= 1 || loading}
                        onClick={() => {
                          const next = Math.max(1, page - 1);
                          setPage(next);
                          fetchList({ page: next });
                        }}
                      >
                        이전
                      </button>
                      <span className="px-2">
                        {page} / {maxPage}
                      </span>
                      <button
                        className="rounded-md border px-2 py-1 disabled:opacity-40"
                        disabled={page >= maxPage || loading}
                        onClick={() => {
                          const next = Math.min(maxPage, page + 1);
                          setPage(next);
                          fetchList({ page: next });
                        }}
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
