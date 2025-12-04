/* src/components/common/table/TableBase.tsx */
// ✅ Carbon DataTable 기반 공통 테이블 (안정판, Noah 패치 반영)
// - headers, rows undefined 방어
// - header.key 접근 시 완전 방어 처리
// - FilterBox 포함
// - Skeleton 로딩, 정렬, 페이지네이션 지원
// - [NOAH PATCH] 액션 버튼을 Carbon Table 바깥 상단으로 이동
// - [NOAH PATCH] 체크박스 보조텍스트("Select row" 등) 완전 숨김(구/신 prefix 동시 대응)
// - [NOAH PATCH] onSelectionChange 지원 (선택된 row.id 목록을 상위로 전달)

import React, { useMemo, useRef } from "react";
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
import FilterBox from "../FilterBox";
import type { FilterValue } from "../FilterBox";

type SortDir = "ASC" | "DESC";
type SortState = { key?: string; dir?: SortDir };

export type TableHeaderDef = {
  key: string;
  header: string;
  width?: string;
  sortable?: boolean; // 기본 true 취급
};

type Props = {
  rows: Array<Record<string, any>>;
  headers: TableHeaderDef[];
  loading?: boolean;

  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (ps: number) => void;

  sort: SortState;
  onSortChange: (next: SortState) => void;

  filter: FilterValue;
  onFilterChange: (v: FilterValue) => void;

  actions?: React.ReactNode; // [NOAH PATCH] 외부 상단 액션 영역으로 렌더

  // 선택된 row.id 목록 전달용 (선택 없으면 [])
  onSelectionChange?: (ids: string[]) => void;
};

// [NOAH PATCH] 보조텍스트/선택라벨 숨김 + 정렬아이콘 숨김(구/신 prefix 동시대응)
// 스코프 한정: .noah-tablebase 하위에만 적용
const AssistiveTextFix = () => (
  <style>{`
    .noah-tablebase .cds--assistive-text,
    .noah-tablebase .bx--assistive-text,
    .noah-tablebase .cds--table-sort__description,
    .noah-tablebase .bx--table-sort__description {
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
    .noah-tablebase .cds--table-sort__icon,
    .noah-tablebase .cds--table-sort__icon-unsorted,
    .noah-tablebase .bx--table-sort__icon,
    .noah-tablebase .bx--table-sort__icon--unsorted {
      display: none !important;
    }
    /* 체크박스 라벨 안의 텍스트 제거(구/신 prefix 동시대응) */
    .noah-tablebase .cds--table-column-checkbox label,
    .noah-tablebase .bx--table-column-checkbox label {
      font-size: 0 !important;
      line-height: 0 !important;
    }
  `}</style>
);

export default function TableBase({
  rows = [],
  headers = [],
  loading = false,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  filter,
  onFilterChange,
  actions,
  onSelectionChange,
}: Props) {
  const safeHeaders = useMemo(
    () => (headers ?? []).filter((h) => !!h && !!h.key),
    [headers]
  );

  const sortableMap = useMemo(
    () => Object.fromEntries(safeHeaders.map((h) => [h.key, h.sortable !== false])),
    [safeHeaders]
  );

  // ✅ 헤더 라벨 (undefined 완전 방어)
  const renderHeaderLabel = (headerKey?: string, label?: string) => {
    if (!headerKey || !label) return null;
    const isActive = sort.key === headerKey;
    const isDesc = isActive && sort.dir === "DESC";
    const icon = isActive ? (isDesc ? "▼" : "▲") : "▲";
    const colorCls = isActive ? (isDesc ? "text-blue-600" : "text-gray-500") : "text-gray-400";
    return (
      <span className="inline-flex items-center gap-1 select-none">
        <span>{label}</span>
        <span className={`text-[11px] leading-none ${colorCls}`} aria-hidden="true">
          {icon}
        </span>
      </span>
    );
  };

  const colWidths = useMemo(
    () => safeHeaders.map((h) => h.width ?? "auto"),
    [safeHeaders]
  );

  const carbonRows = useMemo(
    () =>
      rows.map((r) => ({
        id: String(r.id ?? crypto.randomUUID()),
        ...r,
      })),
    [rows]
  );

  // React key 경고 방지: getHeaderProps가 반환하는 key는 제거하고 직접 key를 넣는다.
  const wrapHeaderProps = (orig: any, header: { key: string }) => {
    const { key: _ignoredKey, onClick: origOnClick, ...rest } = orig ?? {};

    const onClick = (e: any) => {
      if (typeof origOnClick === "function") {
        origOnClick(e);
      }
      const colKey = header.key;
      if (!sortableMap[colKey]) return;
      const nextDir: SortDir =
        sort.key !== colKey ? "ASC" : sort.dir === "ASC" ? "DESC" : "ASC";
      onSortChange({ key: colKey, dir: nextDir });
      onPageChange(1);
    };

    return { ...rest, onClick };
  };

  // 선택 상태 변경 감지용
  const selectionKeyRef = useRef<string>("");

  const reportSelectionIfChanged = (cRows: any[]) => {
    if (!onSelectionChange) return;

    const ids = cRows
      .filter((r) => r.isSelected)
      .map((r) => String(r.id));

    const key = ids.join("|");
    if (key !== selectionKeyRef.current) {
      selectionKeyRef.current = key;
      onSelectionChange(ids);
    }
  };

  return (
    <div className="noah-tablebase p-3">
      <AssistiveTextFix />

      {/* 필터 박스 (테이블 바깥) */}
      <FilterBox
        value={filter}
        onChange={(v) => onFilterChange(v)}
        onSubmit={() => onPageChange(1)}
        onReset={() => {
          onFilterChange({});
          onPageChange(1);
        }}
        placeholders={{
          from: "연도-월-일",
          to: "연도-월-일",
          keyword: "SKU, 상품명 등 검색",
        }}
      />

      {/* [NOAH PATCH] 액션 버튼을 테이블 '바깥' 상단 우측으로 이동 */}
      {actions && (
        <div className="mb-2 flex items-center justify-end gap-2">
          {actions}
        </div>
      )}

      <DataTable rows={carbonRows} headers={safeHeaders as any} useZebraStyles size="lg">
        {({
          rows: cRows = [],
          headers: cHeaders = [],
          getHeaderProps,
          getRowProps,
          getSelectionProps,
        }) => {
          // 선택 상태 상위 보고
          reportSelectionIfChanged(cRows);

          return (
            <TableContainer className="w-full overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <div className="max-h-[560px] overflow-auto">
                <Table
                  aria-label="공통 테이블"
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
                    {colWidths.map((w, i) => (
                      <col key={`col-${i}`} style={{ width: w }} />
                    ))}
                  </colgroup>

                  <TableHead>
                    <TableRow>
                      <TableSelectAll {...getSelectionProps()} />
                      {cHeaders
                        ?.filter((h: any) => !!h && !!h.key)
                        .map((header: any) => {
                          if (!header?.key) return null;

                          const hp = getHeaderProps({ header, isSortable: true });
                          const merged = wrapHeaderProps(hp, header);
                          const clickable = !!sortableMap[header.key];

                          return (
                            <TableHeader
                              key={header.key}
                              {...merged}
                              className={`text-gray-700 font-semibold text-base text-center ${
                                clickable ? "cursor-pointer select-none" : "opacity-60"
                              }`}
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
                          {cHeaders
                            ?.filter((h: any) => !!h && !!h.key)
                            .map((h: any) => (
                              <TableCell key={`sk-${i}-${h.key}`}>
                                <SkeletonText heading={false} lineCount={1} width="70%" />
                              </TableCell>
                            ))}
                        </TableRow>
                      ))}

                    {!loading &&
                      cRows.map((row: any) => (
                        <TableRow
                          {...getRowProps({ row })}
                          key={row.id}
                          className="border-b border-gray-100 hover:bg-gray-50"
                        >
                          <TableSelectRow {...getSelectionProps({ row })} />
                          {row.cells.map((cell: any) => (
                            <TableCell key={cell.id} className="text-center text-sm">
                              {cell.value}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}

                    {!loading && cRows.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={cHeaders.length + 1}>
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
                  총 <b>{total.toLocaleString()}</b>건
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="rounded-md border px-2 py-1 text-sm"
                    value={pageSize}
                    onChange={(e) => onPageSizeChange(Number(e.target.value))}
                  >
                    <option value={10}>10개씩</option>
                    <option value={25}>25개씩</option>
                    <option value={50}>50개씩</option>
                  </select>
                  <div className="flex items-center gap-1 text-sm text-gray-700">
                    <button
                      className="rounded-md border px-2 py-1 disabled:opacity-40"
                      disabled={page <= 1 || loading}
                      onClick={() => onPageChange(Math.max(1, page - 1))}
                    >
                      이전
                    </button>
                    <span className="px-2">
                      {page} / {Math.max(1, Math.ceil(total / pageSize))}
                    </span>
                    <button
                      className="rounded-md border px-2 py-1 disabled:opacity-40"
                      disabled={
                        page >= Math.max(1, Math.ceil(total / pageSize)) || loading
                      }
                      onClick={() => onPageChange(page + 1)}
                    >
                      다음
                    </button>
                  </div>
                </div>
              </div>
            </TableContainer>
          );
        }}
      </DataTable>
    </div>
  );
}
 