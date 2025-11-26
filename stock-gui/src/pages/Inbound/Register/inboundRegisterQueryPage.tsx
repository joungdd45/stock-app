/* ============================================================================
 * 📄 C:\dev\stock-app\stock-gui\src\pages\Inbound\Register\inboundRegisterQueryPage.tsx
 * 입고관리 → 입고등록 → 조회탭
 *
 * 임시 버전:
 * - useTableConnector / hub 완전 비활성화
 * - 로컬 상태 + 빈 rows 기준으로만 렌더 (Docker 빌드 통과용)
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

// ✅ 허브 연결 (임시 완전 비활성화)
// import useTableConnector from "../../../lib/connectors/useTableConnector";

/* ────────────────────────────────────────────────────────────────
 * 디버그 유틸
 * ────────────────────────────────────────────────────────────────*/
const DEBUG = true;
const dbg = (...args: any[]) => DEBUG && console.log("[InboundRegisterQuery]", ...args);

/* ────────────────────────────────────────────────────────────────
 * 타입, 헤더 정의 (UI 표준 행 형태)
 * ────────────────────────────────────────────────────────────────*/
type Row = {
  id: string;           // 행 고유 ID
  orderDate: string;    // 주문일자 YYYY-MM-DD
  sku: string;          // SKU 코드
  name: string;         // 상품명
  qty: number;          // 입고 수량
  totalPrice: number;   // 총단가
  unitPrice: number;    // 개당단가
  supplier: string;     // 공급처(입고처)
  orderNumber: string;  // 주문번호
};

const ALL_HEADERS = [
  { key: "orderDate", header: "주문일자" },
  { key: "sku", header: "SKU" },
  { key: "name", header: "상품명" },
  { key: "qty", header: "입고 수량" },
  { key: "totalPrice", header: "총 단가" },
  { key: "unitPrice", header: "개당 단가" },
  { key: "supplier", header: "입고처" },
  { key: "orderNumber", header: "주문번호" },
] as const;

/** 숫자 세 자리 콤마 포맷터 */
const fmtInt = (n: number) => new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n);

/* ────────────────────────────────────────────────────────────────
 * 필터 박스 (상태 필터 없음) — 디버그 로그 포함
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
          <span className="mb-1 text-gray-600">기간 시작</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.from ?? ""}
            onChange={(e) => {
              const next = { ...value, from: e.target.value };
              dbg("Filter change: from", next.from);
              onChange(next);
            }}
          />
        </label>
        <label className="flex flex-col text-sm">
          <span className="mb-1 text-gray-600">기간 종료</span>
          <input
            type="date"
            className="rounded-lg border px-3 py-2"
            value={value.to ?? ""}
            onChange={(e) => {
              const next = { ...value, to: e.target.value };
              dbg("Filter change: to", next.to);
              onChange(next);
            }}
          />
        </label>
        <label className="flex flex-col text-sm md:col-span-2">
          <span className="mb-1 text-gray-600">SKU 또는 상품명</span>
          <input
            type="text"
            placeholder="SKU, 상품명, 공급처 검색"
            className="rounded-lg border px-3 py-2"
            value={value.keyword ?? ""}
            onChange={(e) => {
              const next = { ...value, keyword: e.target.value };
              dbg("Filter change: keyword", next.keyword);
              onChange(next);
            }}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={() => {
              dbg("UI: 초기화 클릭");
              onReset();
            }}
          >
            초기화
          </button>
          <button
            type="button"
            className="rounded-xl bg-black px-4 py-2 text-sm text-white"
            onClick={() => {
              dbg("UI: 검색 클릭", { value });
              onSubmit();
            }}
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
        className={`rounded-xl px-4 py-2 text-sm ${disNotOne ? "bg-gray-200 text-gray-500" : "bg-blue-600 text-white"}`}
        disabled={disNotOne}
        onClick={() => {
          dbg("UI: 수정 클릭");
          props.onEdit?.();
        }}
      >
        수정
      </button>
      <button
        className={`rounded-xl px-4 py-2 text-sm ${disNone ? "bg-gray-200 text-gray-500" : "bg-red-600 text-white"}`}
        disabled={disNone}
        onClick={() => {
          dbg("UI: 삭제 클릭");
          props.onDelete?.();
        }}
      >
        삭제
      </button>
      <button
        className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
        onClick={() => {
          dbg("UI: 다운로드(CSV) 클릭");
          props.onDownload?.();
        }}
      >
        다운로드(CSV)
      </button>

      <div className="relative" ref={menuRef}>
        <button
          className="rounded-xl border px-3 py-2 text-sm hover:bg-gray-50"
          onClick={() => {
            const next = !open;
            dbg("UI: 열 보이기 토글", next);
            setOpen(next);
          }}
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
                  onChange={() => {
                    dbg("UI: 열 토글", h.key);
                    props.onToggleKey(h.key);
                  }}
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
 * 스타일: Carbon 정렬 아이콘 숨김 + 체크박스 라벨 숨김
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
    :root .cds--table-sort__icon-unsorted { display: none !important; }
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
  // ✅ 로컬 UI 상태(필터·정렬·페이지)
  const [filter, setFilter] = useState<{ from?: string; to?: string; keyword?: string }>({});
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 25>(10);
  const [sort, setSort] = useState<{ key?: string; dir?: "ASC" | "DESC" }>({ key: "orderDate", dir: "DESC" });

  // ✅ 허브 연결 (ledger 도메인) - 임시 비활성화
  /*
  const hub = useTableConnector({ domain: "ledger" });
  */

  // window 디버그 핸들 배치 (허브 없이 UI 상태만 노출)
  useEffect(() => {
    (window as any).__inbound = {
      setFilter,
      setPage,
      setPageSize,
      setSort,
      get ui() {
        return { filter, page, pageSize, sort };
      },
    };
    dbg("window.__inbound 준비 완료 (허브 비활성 상태)");
  }, [filter, page, pageSize, sort]);

  // 허브 상태 관찰 useEffect 완전 비활성화
  /*
  useEffect(() => {
    dbg("HUB STATE 변화", {
      loading: hub.loading,
      error: hub.error,
      total: hub.total,
      rowsLen: hub.rows?.length ?? 0,
      page: hub.page,
      pageSize: hub.pageSize,
      sort: hub.sort,
      filters: hub.filters,
    });
  }, [hub.loading, hub.error, hub.total, hub.rows, hub.page, hub.pageSize, hub.sort, hub.filters]);
  */

  // 표시 컬럼 ON/OFF
  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(new Set(ALL_HEADERS.map((h) => h.key)));
  const toggleKey = (k: string) =>
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  /* ────────────────────────────────────────────────────────────────
   * 데이터 조회 트리거: 허브 사용 로직 전체 비활성화
   * ────────────────────────────────────────────────────────────────*/
  /*
  useEffect(() => {
    dbg("TRIGGER: UI 변화 → 허브 상태 주입 시작", { page, pageSize, sort, filter });

    hub.setSort(sort);
    hub.setPage(page);
    hub.setPageSize(pageSize);
    hub.setFilters({
      from: filter.from,
      to: filter.to,
      q: filter.keyword,
      status: "PENDING",
      flow: "INBOUND",
    });

    dbg("TRIGGER: hub.fetch 호출");
    Promise.resolve(hub.fetch())
      .then(() => {
        dbg("TRIGGER: hub.fetch 완료", {
          rowsLen: hub.rows?.length ?? 0,
          total: hub.total,
          loading: hub.loading,
          error: hub.error,
        });
      })
      .catch((e) => {
        dbg("TRIGGER: hub.fetch 예외", e);
      });
  }, [page, pageSize, sort, filter]);
  */

  // ✅ 허브 제거용 임시 더미 상태
  const [rowsState] = useState<Row[]>([]);
  const loading = false;
  const error: string | null = null;
  const totalCount = rowsState.length;

  // 어댑터 표준행 가정: 현재는 rowsState 그대로 사용
  const rawRows: Row[] = rowsState;

  // 현재 페이지 합계
  const summary = useMemo(() => {
    const qty = rawRows.reduce((s, r) => s + (r.qty || 0), 0);
    const amount = rawRows.reduce((s, r) => s + (r.totalPrice || 0), 0);
    return { qty, amount };
  }, [rawRows]);

  // CSV 다운로드(표시 컬럼 기준)
  const handleDownloadCSV = () => {
    dbg("CSV export 시작");
    const cols = ALL_HEADERS.filter((h) => visibleKeys.has(h.key)).map((h) => h.key as keyof Row);
    const headerLine = ["id", ...cols].join(",");
    const lines = rawRows.map((r) =>
      ['"' + r.id + '"', ...cols.map((k) => `"${String((r as any)[k]).replaceAll('"', '""')}"`)].join(",")
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

  // 표시 중인 헤더만 사용
  const visibleHeaders = useMemo(() => ALL_HEADERS.filter((h) => visibleKeys.has(h.key)), [visibleKeys]);

  // Carbon rows로 변환(숫자 포맷 반영)
  const rowsForCarbon = rawRows.map((r) => {
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

  // 총 페이지(서버 total 기준, 페이지네이션은 클라이언트에서 유지)
  const maxPage = Math.max(1, Math.ceil(totalCount / pageSize));

  // 헤더 클릭 시 정렬 상태 토글
  // ⚠️ React 경고 방지: getHeaderProps가 반환하는 객체에서 key 제거 후 스프레드
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

  // 렌더 타이밍 디버그
  useEffect(() => {
    dbg("RENDER: rowsForCarbon", rowsForCarbon.length, "visibleHeaders", visibleHeaders.length, {
      loading,
      error,
      totalCount,
      page,
      pageSize,
      sort,
    });
  }, [rowsForCarbon, visibleHeaders, loading, error, totalCount, page, pageSize, sort]);

  // 컬럼 폭
  const colWidth: Record<string, string> = {
    orderDate: "130px",
    sku: "260px",
    name: "240px",
    qty: "90px",
    totalPrice: "120px",
    unitPrice: "110px",
    supplier: "120px",
    orderNumber: "150px",
  };

  // 헤더 아이콘(색상 규칙 동일 유지)
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
        onChange={(v) => setFilter(v)}
        onSubmit={() => {
          dbg("SUBMIT: 검색 → page=1 리셋");
          setPage(1);
        }}
        onReset={() => {
          dbg("SUBMIT: 초기화 → 필터 초기화 + page=1");
          setFilter({});
          setPage(1);
        }}
      />

      <DataTable rows={rowsForCarbon} headers={visibleHeaders as any} useZebraStyles size="lg">
        {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps }) => {
          const selectedCount = rows.filter((r: any) => r.isSelected).length;

          return (
            <>
              <ButtonGroup
                selectedCount={selectedCount}
                visibleKeys={visibleKeys}
                onToggleKey={toggleKey}
                onEdit={() => alert("수정 기능은 API 연결 후 활성화됩니다")}
                onDelete={() => alert("삭제 기능은 API 연결 후 활성화됩니다")}
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
                          const propsNoKey = stripKey(getHeaderProps({ header, isSortable: true }));
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
                      {/* 로딩 스켈레톤 */}
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

                      {/* 에러 표시 */}
                      {!loading && error && (
                        <TableRow>
                          <TableCell colSpan={(headers as any[]).length + 1}>
                            <div className="py-10 text-center text-red-600">
                              조회 중 오류가 발생했어요: <b>{String(error)}</b>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}

                      {/* 데이터 렌더 */}
                      {!loading &&
                        !error &&
                        rows.map((row: any) => (
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
                                  : key === "sku" || key === "orderNumber"
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

                      {/* 비어있음 */}
                      {!loading && !error && rows.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={(headers as any[]).length + 1}>
                            <div className="py-10 text-center text-gray-500">조건에 맞는 결과가 없습니다.</div>
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-col gap-2 border-top border-gray-100 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="text-sm text-gray-600">
                    총 <b>{fmtInt(totalCount)}</b>건 · 현재 페이지 수량 <b>{fmtInt(summary.qty)}</b> · 금액{" "}
                    <b>{fmtInt(summary.amount)}</b>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="rounded-md border px-2 py-1 text-sm"
                      value={pageSize}
                      onChange={(e) => {
                        const ps = Number(e.target.value) as 10 | 25;
                        dbg("UI: pageSize 변경", ps);
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
                        onClick={() => {
                          const np = Math.max(1, page - 1);
                          dbg("UI: 이전 페이지", { from: page, to: np });
                          setPage(np);
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
                          const np = page + 1;
                          dbg("UI: 다음 페이지", { from: page, to: np });
                          setPage(np);
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
