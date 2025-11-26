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

/* ────────────────────────────────────────────────────────────────
 * 타입, 더미 데이터, 헤더 정의
 * ────────────────────────────────────────────────────────────────*/
type Row = {
  id: string;           // 행 고유 ID
  country: string;      // 국가 (예: SG, MY 등)
  orderNo: string;      // 주문번호
  trackingNo: string;   // 트래킹번호
  sku: string;          // SKU 코드
  name: string;         // 상품명
  quantity: number;     // 출고수량
  totalPrice: number;   // 총 가격
};

const MOCK_ROWS: Row[] = [
  { id: "O-250001", country: "SG", orderNo: "SG20251022001", trackingNo: "SING-TRK-10001", sku: "FD_SAMY_BULDAKSA02_0200", name: "불닭사리 200g", quantity: 3, totalPrice: 9000 },
  { id: "O-250002", country: "MY", orderNo: "MY20251023007", trackingNo: "MY-EXP-883201", sku: "FD_DSFS_MAXIMKAN05_MILDLOS030", name: "맥심 모카라떼 30T", quantity: 2, totalPrice: 18000 },
  { id: "O-250003", country: "PH", orderNo: "PH20251023054", trackingNo: "PH-LBC-776502", sku: "FD_LOTTE_CHOCO_PIE12", name: "초코파이 12입", quantity: 1, totalPrice: 4500 },
  { id: "O-250004", country: "SG", orderNo: "SG20251024012", trackingNo: "SING-TRK-10028", sku: "FD_SAMLIP_MINI_YAKGWA", name: "삼립 미니약과", quantity: 5, totalPrice: 12500 },
  { id: "O-250005", country: "TH", orderNo: "TH20251024002", trackingNo: "TH-KERRY-553001", sku: "FD_OTTOGI_JINRAMEN_MILD5", name: "진라면 순한맛 5입", quantity: 2, totalPrice: 6000 },
];

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
 * 필터 박스 (간단 검색)
 *  - 키워드: 국가, 주문번호, 트래킹번호, SKU, 상품명 부분 일치
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
 *  - 수정: 1건만 가능
 *  - 삭제: 다건 가능
 *  - 열 보이기 토글 + CSV 다운로드
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

  const [visibleKeys, setVisibleKeys] = useState<Set<string>>(
    new Set(ALL_HEADERS.map((h) => h.key))
  );
  const toggleKey = (k: string) =>
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      next.has(k) ? next.delete(k) : next.add(k);
      return next;
    });

  /** 목록 조회 (현재는 더미 데이터 가공) */
  async function fetchList(params: {
    page: number;
    pageSize: number;
    sort?: { key?: string; dir?: "ASC" | "DESC" };
    filter?: { keyword?: string };
  }) {
    setLoading(true);
    await new Promise((r) => setTimeout(r, 300));

    let data = [...MOCK_ROWS];

    // 키워드(부분 일치): 국가 | 주문번호 | 트래킹번호 | SKU | 상품명
    const f = params.filter ?? {};
    if (f.keyword) {
      const q = f.keyword.toLowerCase();
      data = data.filter(
        (r) =>
          r.country.toLowerCase().includes(q) ||
          r.orderNo.toLowerCase().includes(q) ||
          r.trackingNo.toLowerCase().includes(q) ||
          r.sku.toLowerCase().includes(q) ||
          r.name.toLowerCase().includes(q)
      );
    }

    // 정렬
    const s = params.sort;
    if (s?.key) {
      data.sort((a: any, b: any) => {
        const av = a[s.key!];
        const bv = b[s.key!];
        if (av === bv) return 0;
        const base = av > bv ? 1 : -1;
        return s.dir === "DESC" ? -base : base;
      });
    }

    // 페이징
    const total = data.length;
    const start = (params.page - 1) * params.pageSize;
    setRows(data.slice(start, start + params.pageSize));
    setTotalCount(total);

    setLoading(false);
  }

  useEffect(() => {
    fetchList({ page, pageSize, sort, filter });
  }, [page, pageSize, sort, filter]);

  // CSV 다운로드(표시 컬럼 기준)
  const handleDownloadCSV = () => {
    const cols = ALL_HEADERS.filter((h) => visibleKeys.has(h.key)).map(
      (h) => h.key as keyof Row
    );
    const headerLine = ["id", ...cols].join(",");
    const lines = rows.map((r) =>
      [
        '"' + r.id + '"',
        ...cols.map((k) =>
          `"${String((r as any)[k]).replaceAll('"', '""')}"`
        ),
      ].join(",")
    );
    const csv = [headerLine, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outbound_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // 표시 중인 헤더만 사용
  const visibleHeaders = useMemo(
    () => ALL_HEADERS.filter((h) => visibleKeys.has(h.key)),
    [visibleKeys]
  );

  // Carbon rows로 변환(숫자 포맷 반영)
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

  // 헤더 클릭 시 정렬 상태 토글
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

  // 헤더 아이콘(색상 규칙 동일 유지)
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
        rows={rowsForCarbon}
        headers={visibleHeaders as any}
        useZebraStyles
        size="lg"
      >
        {({ rows, headers, getHeaderProps, getRowProps, getSelectionProps }) => {
          const selectedCount = rows.filter((r: any) => r.isSelected).length;

          return (
            <>
              <ButtonGroup
                selectedCount={selectedCount}
                visibleKeys={visibleKeys}
                onToggleKey={toggleKey}
                onEdit={() => alert("더미: 수정은 1건만 가능합니다.")}
                onDelete={() =>
                  alert(`더미: 선택 ${selectedCount}건 삭제`)
                }
                onDownload={handleDownloadCSV}
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
                          return (
                            <TableHeader
                              key={header.key}
                              {...wrapHeaderProps(hp, header)}
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
