// C:\dev\stock-app\stock-gui\src\pages\Product\Create\CreatePage.tsx
// 상품관리 > 상품 등록/조회 페이지
// ✅ 변경(2025-12-26):
// - 상단 단일 등록 폼/등록 버튼/등록 로직 제거
// - 상단을 검색폼으로 변경
// - ✅ 대량등록(템플릿 다운로드/엑셀 업로드) 버튼은 유지
// - 하단: 조회 전용 테이블 + 묶음설정/선택수정

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import {
  productsAdapter,
  type ProductListItem,
  type ProductUpdatePayload,
} from "@/api/adapters/products.adapter";
import { handleError } from "@/utils/handleError";

// ───────────────────────────────────────────────
// 타입 / 유틸
// ───────────────────────────────────────────────

type RowItem = {
  id: string;
  sku: string;
  name: string;
  unitPrice: number | "";
  barcode: string;
  status: boolean;
  bundleQty: number | "";
};

type BundleRow = {
  id: string;
  componentSku: string;
  componentQty: string;
};

type BulkRow = {
  sku: string;
  name: string;
  barcode?: string;
  weight_g?: number;
  unit_price?: number;
  status?: boolean;
};

const uuid = () => Math.random().toString(36).slice(2, 10);

const stripComma = (s: string) => s.replace(/[, ]+/g, "");
const toInt = (v: number | string | "") => {
  if (v === "" || v === undefined || v === null) return 0;
  const raw = typeof v === "string" ? v.replace(/[^\d]/g, "") : v;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const toFloat = (v: number | string | "") => {
  if (v === "" || v === undefined || v === null) return 0;
  const raw = typeof v === "string" ? stripComma(v) : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const fmtInt = (n: number) =>
  new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(n);

const makeEmptyBundleRow = (): BundleRow => ({
  id: uuid(),
  componentSku: "",
  componentQty: "1",
});

// ───────────────────────────────────────────────
// ✅ 대량등록 양식(xlsx) 다운로드
// ───────────────────────────────────────────────

const BULK_TEMPLATE_URL = "/templates/상품대량등록_양식.xlsx";
const BULK_TEMPLATE_BASENAME = "상품대량등록_양식";
const BULK_TEMPLATE_SEQ = "01";

function ymd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

async function downloadXlsxWithName(url: string, baseName: string, seq: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("양식 파일을 불러오지 못했어요.");
  const blob = await res.blob();

  const filename = `${baseName}_${ymd()}_${seq}.xlsx`;

  const a = document.createElement("a");
  const objUrl = URL.createObjectURL(blob);
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

// ───────────────────────────────────────────────
// ✅ 템플릿 xlsx 파서
// ───────────────────────────────────────────────

function cellStr(v: any) {
  return String(v ?? "").trim();
}

function cellNum(v: any) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  const cleaned = s.replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

async function parseProductTemplateXlsx(file: File): Promise<BulkRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(buf), { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "" });

  const headerIdx = rows.findIndex((r) => {
    const s = (r ?? []).map((v: any) => cellStr(v));
    return (
      s.includes("번호") &&
      s.includes("SKU") &&
      s.includes("상품명") &&
      s.includes("바코드") &&
      s.includes("중량") &&
      s.includes("입고단가")
    );
  });
  if (headerIdx === -1) {
    throw new Error(
      "템플릿 헤더(번호/SKU/상품명/바코드/중량/입고단가) 줄을 찾지 못했어요.",
    );
  }

  const header = (rows[headerIdx] ?? []).map((v: any) => cellStr(v));
  const cNo = header.indexOf("번호");
  const cSku = header.indexOf("SKU");
  const cName = header.indexOf("상품명");
  const cBarcode = header.indexOf("바코드");
  const cWeight = header.indexOf("중량");
  const cPrice = header.indexOf("입고단가");

  const out: BulkRow[] = [];

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i] ?? [];

    const no = cellStr(r[cNo]);
    if (!/^\d+$/.test(no)) continue;

    const sku = cellStr(r[cSku]);
    const name = cellStr(r[cName]);
    if (!sku || !name) continue;

    const barcode = cellStr(r[cBarcode]) || undefined;
    const weight_g = cellNum(r[cWeight]);
    const unit_price = cellNum(r[cPrice]);

    out.push({
      sku,
      name,
      barcode,
      weight_g,
      unit_price,
      status: true,
    });
  }

  return out;
}

function csvEscape(v: any) {
  const s = String(v ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildBulkCsvText(items: BulkRow[]) {
  const header = ["sku", "name", "barcode", "weight_g", "unit_price", "status"].join(
    ",",
  );
  const lines = items.map((it) =>
    [
      csvEscape(it.sku),
      csvEscape(it.name),
      csvEscape(it.barcode ?? ""),
      csvEscape(it.weight_g ?? 0),
      csvEscape(it.unit_price ?? 0),
      csvEscape(it.status === false ? 0 : 1),
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

// 어댑터 → 화면 Row
const mapFromAdapter = (p: ProductListItem): RowItem => ({
  id: String(p.id ?? p.sku),
  sku: p.sku,
  name: p.name,
  unitPrice: p.unit_price ?? 0,
  barcode: p.barcode ?? "",
  status: p.status ?? p.is_active ?? true,
  bundleQty: p.bundle_qty ?? 1,
});

// 수정 payload
const makeUpdatePayloadFromEdit = (
  name: string,
  barcode: string,
  isActive: boolean,
): ProductUpdatePayload => {
  return {
    name: name.trim(),
    barcode: barcode.trim(),
    is_active: isActive,
  };
};

export default function CreatePage() {
  const isAdmin = true;

  // ✅ 상단 검색 폼
  const [search, setSearch] = useState({
    sku: "",
    name: "",
    barcode: "",
    status: "all" as "all" | "active" | "inactive",
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  // ✅ 서버에서 받은 전체 목록
  const [allRows, setAllRows] = useState<RowItem[]>([]);

  // ✅ 현재 화면 rows 기준 체크
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const pasteTargetRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 선택 수정 모달
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editSku, setEditSku] = useState("");
  const [editName, setEditName] = useState("");
  const [editBarcode, setEditBarcode] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  // 묶음설정 모달
  const [bundleModalOpen, setBundleModalOpen] = useState(false);
  const [bundleTargetSku, setBundleTargetSku] = useState("");
  const [bundleRows, setBundleRows] = useState<BundleRow[]>([
    makeEmptyBundleRow(),
  ]);

  useEffect(() => {
    pasteTargetRef.current?.focus();
    loadList();
  }, []);

  async function loadList() {
    const res = await productsAdapter.fetchList();
    if (!res.ok || !res.data) {
      console.error("상품 목록 조회 실패", res.error);
      if (!res.ok && res.error) handleError(res.error);
      setAllRows([]);
      setChecked(new Set());
      return;
    }
    const items = res.data.items.map(mapFromAdapter);
    setAllRows(items);
    setChecked(new Set());
  }

  // ✅ 검색 필터(클라이언트)
  const rows = useMemo(() => {
    const skuQ = search.sku.trim().toLowerCase();
    const nameQ = search.name.trim().toLowerCase();
    const bcQ = search.barcode.trim().toLowerCase();
    const statusQ = search.status;

    return allRows.filter((r) => {
      if (skuQ && !r.sku.toLowerCase().includes(skuQ)) return false;
      if (nameQ && !r.name.toLowerCase().includes(nameQ)) return false;
      if (bcQ && !(r.barcode ?? "").toLowerCase().includes(bcQ)) return false;

      if (statusQ === "active" && !r.status) return false;
      if (statusQ === "inactive" && r.status) return false;

      return true;
    });
  }, [allRows, search]);

  const toggleOne = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setChecked((prev) => {
      if (rows.length > 0 && prev.size === rows.length) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  };

  // 묶음설정 모달 열기
  const onBulkBundle = () => {
    if (!isAdmin) return;

    if (checked.size === 0) {
      alert("묶음으로 설정할 상품을 한 건 선택해 주세요.");
      return;
    }

    if (checked.size > 1) {
      alert("묶음설정은 한 번에 한 상품만 설정할 수 있어요.");
      return;
    }

    const targetId = Array.from(checked)[0];
    const target = rows.find((r) => r.id === targetId);
    if (!target) {
      alert("선택한 상품을 찾을 수 없어요.");
      return;
    }

    setBundleTargetSku(target.sku);
    setBundleRows([makeEmptyBundleRow()]);
    setBundleModalOpen(true);
  };

  const onChangeBundleCell = (
    id: string,
    field: "componentSku" | "componentQty",
    value: string,
  ) => {
    setBundleRows((prev) =>
      prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
    );
  };

  const onAddBundleRow = () => {
    setBundleRows((prev) => [...prev, makeEmptyBundleRow()]);
  };

  const onRemoveBundleRow = (id: string) => {
    setBundleRows((prev) => {
      if (prev.length === 1) return [makeEmptyBundleRow()];
      return prev.filter((row) => row.id !== id);
    });
  };

  const onCloseBundleModal = () => {
    setBundleModalOpen(false);
    setBundleTargetSku("");
    setBundleRows([makeEmptyBundleRow()]);
  };

  const onSaveBundleModal = async () => {
    if (!bundleTargetSku) {
      alert("묶음 SKU가 비어 있어요.");
      return;
    }

    const items = bundleRows
      .map((row) => {
        const sku = row.componentSku.trim();
        const qty = toInt(row.componentQty);
        return { component_sku: sku, component_qty: qty };
      })
      .filter((item) => item.component_sku && item.component_qty > 0);

    if (items.length === 0) {
      alert("구성품 SKU와 수량을 1개 이상 입력해 주세요.");
      return;
    }

    const res = await productsAdapter.updateBundleMapping({
      bundle_sku: bundleTargetSku,
      items,
    });

    if (!res.ok) {
      console.error("묶음설정 저장 실패", res.error);
      if (res.error) handleError(res.error);
      return;
    }

    if (res.data?.ok) {
      alert("묶음 구성이 저장됐어요.\n(기존 구성은 새 구성으로 교체됩니다.)");
    }

    onCloseBundleModal();
    await loadList();
  };

  // 선택 수정 모달
  const onOpenEditModal = () => {
    if (!isAdmin) return;
    if (checked.size === 0) return;

    if (checked.size > 1) {
      alert("선택 수정은 한 번에 한 건만 가능해요.\n수정할 상품만 선택해 주세요.");
      return;
    }

    const targetId = Array.from(checked)[0];
    const target = rows.find((r) => r.id === targetId);
    if (!target) return;

    setEditTargetId(target.id);
    setEditSku(target.sku);
    setEditName(target.name);
    setEditBarcode(target.barcode);
    setEditIsActive(target.status);

    setEditModalOpen(true);
  };

  const onCloseEditModal = () => {
    if (isSubmitting) return;
    setEditModalOpen(false);
    setEditTargetId(null);
  };

  const onSaveEditModal = async () => {
    if (!editTargetId) return;
    if (!editSku.trim()) {
      alert("SKU가 비어 있습니다.");
      return;
    }
    if (!editName.trim()) {
      alert("상품명을 입력해 주세요.");
      return;
    }

    const payload = makeUpdatePayloadFromEdit(editName, editBarcode, editIsActive);

    const res = await productsAdapter.updateOne(editSku, payload);
    if (!res.ok) {
      console.error("상품 수정 실패", res.error);
      if (res.error) handleError(res.error);
      return;
    }

    setEditModalOpen(false);
    setEditTargetId(null);
    await loadList();
  };

  // ✅ 템플릿 다운로드
  const onDownloadBulkTemplate = async () => {
    try {
      await downloadXlsxWithName(
        BULK_TEMPLATE_URL,
        BULK_TEMPLATE_BASENAME,
        BULK_TEMPLATE_SEQ,
      );
    } catch (e: any) {
      console.error(e);
      alert(`양식 다운로드에 실패했어요.\n사유: ${String(e?.message || e)}`);
    }
  };

  // ✅ 엑셀 업로드
  const onClickBulkUpload = () => {
    if (!isAdmin) return;
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const name = file.name.toLowerCase();

    try {
      let text = "";

      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const items = await parseProductTemplateXlsx(file);
        if (items.length === 0) {
          alert("엑셀에서 등록할 데이터가 없어요. (번호/SKU/상품명 확인)");
          return;
        }
        text = buildBulkCsvText(items);
      } else {
        text = await file.text();
      }

      setIsSubmitting(true);
      const res = await productsAdapter.bulkUploadFromText(text);
      if (!res.ok) {
        console.error("대량등록 실패", res.error);
        if (res.error) handleError(res.error);
        return;
      }

      const count = res.data?.count ?? 0;
      alert(`대량 등록이 완료됐어요. 총 ${count}건`);
      await loadList();
    } catch (err: any) {
      console.error(err);
      alert(`대량등록 중 오류가 발생했어요.\n사유: ${String(err?.message || err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const summary = useMemo(() => ({ count: rows.length }), [rows]);

  const displayUnitPrice = (v: RowItem["unitPrice"]) =>
    v === "" ? "" : fmtInt(Number(v));
  const displayBundle = (v: RowItem["bundleQty"]) => (v === "" ? "" : String(v));

  const onResetSearch = () => {
    setSearch({ sku: "", name: "", barcode: "", status: "all" });
    setChecked(new Set());
  };

  return (
    <div className="w-full h-full flex flex-col gap-4 p-3">
      {/* 상단 우측 액션바 (대량등록 유지) */}
      <div className="flex items-center justify-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv,.tsv,.txt"
          className="hidden"
          onChange={onFileChange}
        />

        <button
          onClick={onDownloadBulkTemplate}
          disabled={!isAdmin || isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm ${
            !isAdmin || isSubmitting ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title="대량등록 xlsx 양식 다운로드(파일명 자동)"
        >
          대량등록 템플릿
        </button>

        <button
          onClick={onClickBulkUpload}
          disabled={!isAdmin || isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm ${
            !isAdmin || isSubmitting ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title="xlsx 템플릿 또는 CSV/TSV 업로드"
        >
          엑셀 대량등록
        </button>

        <button
          onClick={onResetSearch}
          disabled={isSubmitting}
          className="px-3 py-2 rounded-lg border text-sm"
          title="검색 조건 초기화"
        >
          검색 초기화
        </button>
      </div>

      {/* 상단: 검색 폼 */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="overflow-auto">
          <table className="min-w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-sm text-gray-600 border-b bg-gray-50">
                <th className="px-4 py-3 w-[220px] text-center">SKU 검색</th>
                <th className="px-4 py-3 text-center">상품명 검색</th>
                <th className="px-4 py-3 w-[180px]">바코드 검색</th>
                <th className="px-4 py-3 w-[170px] text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b last:border-0">
                <td className="px-4 py-2 text-center">
                  <input
                    type="text"
                    value={search.sku}
                    onChange={(e) => setSearch((p) => ({ ...p, sku: e.target.value }))}
                    className="w-full border rounded-lg px-2 py-1 text-sm font-mono text-center"
                    disabled={isSubmitting}
                    placeholder="예: SKU-001"
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="text"
                    value={search.name}
                    onChange={(e) => setSearch((p) => ({ ...p, name: e.target.value }))}
                    className="w-full border rounded-lg px-2 py-1 text-sm text-center"
                    disabled={isSubmitting}
                    placeholder="예: 닭가슴살"
                  />
                </td>
                <td className="px-4 py-2">
                  <input
                    type="text"
                    value={search.barcode}
                    onChange={(e) =>
                      setSearch((p) => ({ ...p, barcode: e.target.value }))
                    }
                    className="w-full border rounded-lg px-2 py-1 text-sm"
                    disabled={isSubmitting}
                    placeholder="예: 880..."
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <select
                    value={search.status}
                    onChange={(e) =>
                      setSearch((p) => ({
                        ...p,
                        status: e.target.value as "all" | "active" | "inactive",
                      }))
                    }
                    className="w-full border rounded-lg px-2 py-1 text-sm text-center"
                    disabled={isSubmitting}
                  >
                    <option value="all">전체</option>
                    <option value="active">사용</option>
                    <option value="inactive">미사용</option>
                  </select>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t text-sm flex justify-between items-center">
          <div className="text-gray-500">
            검색어를 입력하면 하단 목록이 즉시 필터링됩니다. (등록은 엑셀 대량등록만 사용)
          </div>
          <button
            onClick={loadList}
            disabled={isSubmitting}
            className="px-3 py-2 rounded-lg border text-sm"
          >
            목록 새로고침
          </button>
        </div>
      </div>

      {/* 하단: 조회 전용 테이블 */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col max-h-[520px]">
        <div className="border-b border-gray-100 px-4 py-3 text-sm text-gray-600">
          하단 표는 조회·조정용입니다. 셀은 수정 불가이며, 선택 후 상단 버튼으로 묶음설정·선택수정을 할 수 있어요.
        </div>

        {/* 버튼 그룹 */}
        <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
          <button
            className={`rounded-xl px-4 py-2 text-sm ${
              checked.size !== 1 || !isAdmin
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-gray-900 text-white"
            }`}
            disabled={checked.size !== 1 || !isAdmin}
            onClick={onBulkBundle}
          >
            묶음설정
          </button>
          <button
            className={`rounded-xl px-4 py-2 text-sm ${
              checked.size !== 1 || !isAdmin
                ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                : "bg-blue-600 text-white"
            }`}
            disabled={checked.size !== 1 || !isAdmin}
            onClick={onOpenEditModal}
          >
            선택 수정
          </button>
          <button
            className="rounded-xl border px-4 py-2 text-sm hover:bg-gray-50"
            onClick={loadList}
          >
            새로고침
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: "44px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "220px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "180px" }} />
              <col style={{ width: "110px" }} />
              <col style={{ width: "130px" }} />
            </colgroup>
            <thead className="bg-gray-50">
              <tr className="border-b border-gray-200 text-center text-[13px] text-gray-700">
                <th className="px-2 py-3">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && checked.size === rows.length}
                    onChange={toggleAll}
                  />
                </th>
                <th className="px-2 py-3">SKU</th>
                <th className="px-2 py-3">상품명</th>
                <th className="px-2 py-3">최근입고단가</th>
                <th className="px-2 py-3">바코드</th>
                <th className="px-2 py-3">상태</th>
                <th className="px-2 py-3">묶음여부(매핑여부)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr
                  key={r.id}
                  className={[
                    "border-b border-gray-100",
                    idx % 2 === 0 ? "bg-white" : "bg-gray-50",
                  ].join(" ")}
                >
                  <td className="px-2 py-2 text-center align-middle">
                    <input
                      type="checkbox"
                      checked={checked.has(r.id)}
                      onChange={() => toggleOne(r.id)}
                    />
                  </td>
                  <td className="px-2 py-2 text-center align-middle font-mono">
                    {r.sku}
                  </td>
                  <td className="px-2 py-2 text-center align-middle">{r.name}</td>
                  <td className="px-2 py-2 text-center align-middle">
                    {displayUnitPrice(r.unitPrice)}
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    {r.barcode || "-"}
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    <span
                      className={
                        r.status
                          ? "inline-flex rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700"
                          : "inline-flex rounded-full bg-red-100 px-2 py-0.5 text-[11px] text-gray-600"
                      }
                    >
                      {r.status ? "사용" : "미사용"}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    {displayBundle(r.bundleQty)}
                  </td>
                </tr>
              ))}

              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-10 text-center text-sm text-gray-500"
                  >
                    조건에 맞는 상품이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-sm text-gray-600">
          <div>
            총 <b>{fmtInt(summary.count)}</b>건
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span>10개씩</span>
            <span>이전</span>
            <span className="font-medium">1 / 1</span>
            <span>다음</span>
          </div>
        </div>
      </div>

      {/* 선택 수정 모달 */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-lg">
            <h2 className="mb-3 text-base font-semibold">상품 선택 수정</h2>

            <div className="space-y-3 text-sm">
              <div>
                <div className="mb-1 text-gray-600">SKU</div>
                <div className="rounded-lg border bg-gray-50 px-2 py-1 font-mono">
                  {editSku}
                </div>
              </div>

              <div>
                <div className="mb-1 text-gray-600">상품명</div>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full rounded-lg border px-2 py-1 text-sm"
                />
              </div>

              <div>
                <div className="mb-1 text-gray-600">바코드</div>
                <input
                  type="text"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                  className="w-full rounded-lg border px-2 py-1 text-sm"
                />
              </div>

              <div>
                <label className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={editIsActive}
                    onChange={(e) => setEditIsActive(e.target.checked)}
                  />
                  <span>{editIsActive ? "사용" : "미사용"}</span>
                </label>
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2 text-sm">
              <button
                type="button"
                onClick={onCloseEditModal}
                className="rounded-lg border px-3 py-1.5"
                disabled={isSubmitting}
              >
                닫기
              </button>
              <button
                type="button"
                onClick={onSaveEditModal}
                className="rounded-lg px-3 py-1.5 bg-black text-white"
                disabled={isSubmitting}
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 묶음설정 모달 */}
      {bundleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-4 shadow-lg">
            <h2 className="mb-3 text-base font-semibold">묶음 구성품 설정</h2>

            <div className="mb-3 text-sm">
              <div className="mb-1 text-gray-600">묶음 SKU</div>
              <div className="rounded-lg border bg-gray-50 px-2 py-1 font-mono">
                {bundleTargetSku}
              </div>
            </div>

            <div className="mb-2 text-sm text-gray-600">
              구성품 SKU와 수량을 입력하세요. 저장 시 기존 구성은 모두 교체돼요.
            </div>

            <div className="max-h-64 overflow-auto rounded-xl border mb-3">
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col style={{ width: "55%" }} />
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "20%" }} />
                </colgroup>
                <thead className="bg-gray-50">
                  <tr className="border-b border-gray-200 text-center text-[13px] text-gray-700">
                    <th className="px-2 py-2">구성품 SKU</th>
                    <th className="px-2 py-2">수량</th>
                    <th className="px-2 py-2">삭제</th>
                  </tr>
                </thead>
                <tbody>
                  {bundleRows.map((row, idx) => (
                    <tr
                      key={row.id}
                      className={`border-b border-gray-100 ${
                        idx % 2 === 0 ? "bg-white" : "bg-gray-50"
                      }`}
                    >
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          value={row.componentSku}
                          onChange={(e) =>
                            onChangeBundleCell(row.id, "componentSku", e.target.value)
                          }
                          className="w-full rounded-lg border px-2 py-1 text-sm font-mono"
                          placeholder="구성품 SKU"
                        />
                      </td>
                      <td className="px-2 py-1">
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.componentQty}
                          onChange={(e) =>
                            onChangeBundleCell(
                              row.id,
                              "componentQty",
                              e.target.value.replace(/[^\d]/g, ""),
                            )
                          }
                          className="w-full rounded-lg border px-2 py-1 text-sm text-right"
                          placeholder="1"
                        />
                      </td>
                      <td className="px-2 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => onRemoveBundleRow(row.id)}
                          className="rounded-lg border px-2 py-1 text-xs text-gray-700 hover:bg-gray-100"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-3 flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={onAddBundleRow}
                className="rounded-lg border px-3 py-1.5 hover:bg-gray-50"
              >
                행 추가
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onCloseBundleModal}
                  className="rounded-lg border px-3 py-1.5"
                >
                  닫기
                </button>
                <button
                  type="button"
                  onClick={onSaveBundleModal}
                  className="rounded-lg bg-black px-3 py-1.5 text-white"
                >
                  저장
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div ref={pasteTargetRef} className="sr-only" tabIndex={-1} />
    </div>
  );
}
