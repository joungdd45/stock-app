/* src/pages/product/Create/CreatePage.tsx
   ✅ 상품관리 > 상품등록 페이지 (요구사항 반영)
   1) 필터 박스 제거
   2) 상단: 등록용 표(1건만 입력/등록)
   3) 하단: 조회/조정용 표
   4) 우측 상단: 엑셀 대량등록 버튼
   - 단일 등록: POST /api/products
   - 대량 등록: POST /api/products/bulk  (CSV/TSV 파싱, XLSX는 주석 가이드)
   - 목록 조회:   GET  /api/products     (샘플 구현, 백엔드 응답 스키마 맞춰 조정)
   - 권한 가드: isAdmin 이 아니면 등록/수정/삭제/묶음설정/대량등록 버튼 disabled

   🔧 추가 요구사항 반영
   - 상단 표의 "묶음여부(매핑)" 컬럼 제거
   - 상단 단일 등록 시 bundle_qty는 항상 1(단품)으로 고정
*/

import React, { useEffect, useMemo, useRef, useState } from "react";

// ────────────────────────────────────────────────────────────────
// 타입
type RowItem = {
  id: string;
  sku: string;
  name: string;
  unitPrice: number | ""; // 최근입고단가
  weight: number | "";    // 중량(g)
  barcode: string;
  status: boolean;        // 사용(true)/미사용(false)
  bundleQty: number | ""; // 1이면 단품, 2 이상이면 묶음
};

const API_SINGLE = "/api/products";
const API_BULK = "/api/products/bulk";
const API_LIST = "/api/products"; // 필요한 쿼리 파라미터는 프로젝트 규격에 맞게 추가

// ────────────────────────────────────────────────────────────────
// 유틸
const uuid = () => Math.random().toString(36).slice(2, 10);
const stripComma = (s: string) => s.replace(/[, ]+/g, "");
const toInt = (v: number | string | ""): number => {
  if (v === "" || v === undefined || v === null) return 0;
  const raw = typeof v === "string" ? v.replace(/[^\d]/g, "") : v;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const toFloat = (v: number | string | ""): number => {
  if (v === "" || v === undefined || v === null) return 0;
  const raw = typeof v === "string" ? stripComma(v) : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};
const splitLine = (line: string): string[] => {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",")) return line.split(",");
  return line.trim().split(/\s+/);
};

// ────────────────────────────────────────────────────────────────
// 기본 행/상태
const makeEmptyRow = (): RowItem => ({
  id: uuid(),
  sku: "",
  name: "",
  unitPrice: "",
  weight: "",
  barcode: "",
  status: true,
  bundleQty: 1, // 상단 등록은 단품 기준
});
const isEmptyRow = (r: RowItem) =>
  !r.sku &&
  !r.name &&
  !r.unitPrice &&
  !r.weight &&
  !r.barcode &&
  r.status === true &&
  (r.bundleQty === 1 || r.bundleQty === "");

// ────────────────────────────────────────────────────────────────
// 컴포넌트
export default function CreatePage() {
  // 실제에선 전역/컨텍스트의 사용자 권한을 사용
  const isAdmin = true;

  // 상단: 단일 등록용 행 (표 입력 1건)
  const [formRow, setFormRow] = useState<RowItem>(makeEmptyRow());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 하단: 조회/조정용 표
  const [rows, setRows] = useState<RowItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const pasteTargetRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 선택 수정 모달 상태
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editSku, setEditSku] = useState("");
  const [editName, setEditName] = useState("");
  const [editWeight, setEditWeight] = useState("");
  const [editBarcode, setEditBarcode] = useState("");

  useEffect(() => {
    pasteTargetRef.current?.focus();
    loadList();
  }, []);

  // 목록 조회(간단 샘플)
  async function loadList() {
    try {
      const res = await fetch(API_LIST);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // 백엔드 스키마에 맞게 매핑 필요. 여기서는 동일 스키마 가정.
      // id가 없으면 uuid 부여
      const items: RowItem[] = (data.items ?? []).map((it: any) => ({
        id: String(it.id ?? uuid()),
        sku: String(it.sku ?? ""),
        name: String(it.name ?? ""),
        unitPrice:
          typeof it.unit_price === "number"
            ? it.unit_price
            : toFloat(it.unit_price ?? ""),
        weight:
          typeof it.weight_g === "number"
            ? it.weight_g
            : toInt(it.weight_g ?? ""),
        barcode: String(it.barcode ?? ""),
        status: Boolean(it.status ?? true),
        bundleQty:
          typeof it.bundle_qty === "number"
            ? it.bundle_qty
            : toInt(it.bundle_qty ?? "1"),
      }));
      setRows(items);
    } catch (e) {
      console.error(e);
      // 오류는 콘솔만
    }
  }

  // ── 상단 등록용 표: 셀 변경
  const onFormCellChange = (
    field: keyof Omit<RowItem, "id">,
    value: string | boolean
  ) => {
    setFormRow((prev) => {
      if (field === "unitPrice") {
        const raw = (value as string).replace(/[^\d.]/g, "");
        return { ...prev, unitPrice: raw === "" ? "" : Number(raw) };
      }
      if (field === "weight") {
        const raw = (value as string).replace(/[^\d]/g, "");
        return { ...prev, weight: raw === "" ? "" : Number(raw) };
      }
      if (field === "status") {
        return { ...prev, status: Boolean(value) };
      }
      // sku / name / barcode
      return { ...prev, [field]: value as string };
    });
  };

  // ── 상단 등록: 단일 등록
  const validateOne = (r: RowItem) => {
    if (!r.sku.trim()) return "SKU는 필수예요.";
    if (!r.name.trim()) return "상품명은 필수예요.";
    if (toFloat(r.unitPrice) < 0) return "최근입고단가는 0 이상이어야 해요.";
    if (toInt(r.weight) < 0) return "중량은 0 이상이어야 해요.";
    return "";
  };

  const onSubmitSingle = async () => {
    if (!isAdmin) return;
    const msg = validateOne(formRow);
    if (msg) {
      alert(msg);
      return;
    }
    const payload = {
      sku: formRow.sku.trim(),
      name: formRow.name.trim(),
      unit_price: toFloat(formRow.unitPrice),
      weight_g: toInt(formRow.weight),
      barcode: formRow.barcode.trim(),
      status: !!formRow.status,
      // 상단 단일 등록은 항상 단품으로 등록
      bundle_qty: 1,
    };
    try {
      setIsSubmitting(true);
      const res = await fetch(API_SINGLE, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      alert("상품 한 건이 등록됐어요.");
      setFormRow(makeEmptyRow());
      await loadList();
    } catch (e: any) {
      console.error(e);
      alert(`등록 중 오류가 발생했어요.\n사유: ${String(e?.message || e)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── 하단 표: 셀 변경(조정)
  const onCellChange = (
    id: string,
    field: keyof Omit<RowItem, "id">,
    value: string | boolean
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;

        if (field === "unitPrice") {
          const raw = (value as string).replace(/[^\d.]/g, "");
          return { ...r, unitPrice: raw === "" ? "" : Number(raw) };
        }
        if (field === "weight") {
          const raw = (value as string).replace(/[^\d]/g, "");
          return { ...r, weight: raw === "" ? "" : Number(raw) };
        }
        if (field === "bundleQty") {
          const raw = (value as string).replace(/[^\d]/g, "");
          return {
            ...r,
            bundleQty: raw === "" ? "" : Math.max(1, Number(raw)),
          };
        }
        if (field === "status") {
          return { ...r, status: Boolean(value) };
        }
        return { ...r, [field]: value as string };
      })
    );
  };

  // ── 하단 표: 선택/삭제/묶음설정(조정)
  const deleteSelected = async () => {
    if (!isAdmin) return;
    if (checked.size === 0) return;
    if (!confirm(`선택된 ${checked.size}건을 삭제할까요?`)) return;
    // TODO: 실제 삭제 API 연동
    setRows((prev) => prev.filter((r) => !checked.has(r.id)));
    setChecked(new Set());
  };

  const onBulkBundle = () => {
    if (!isAdmin) return;
    if (checked.size === 0) return;
    const v = window.prompt(
      "선택한 행의 묶음 수량을 입력하세요(1은 단품):",
      "2"
    );
    if (v === null) return;
    const qty = Math.max(1, toInt(v));
    setRows((prev) =>
      prev.map((r) => (checked.has(r.id) ? { ...r, bundleQty: qty } : r))
    );
  };

  // ── 하단 표: 선택 수정 모달 오픈
  const onOpenEditModal = () => {
    if (!isAdmin) return;
    if (checked.size === 0) {
      return;
    }
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
    setEditWeight(
      target.weight === "" || target.weight === undefined
        ? ""
        : String(target.weight)
    );
    setEditBarcode(target.barcode);
    setEditModalOpen(true);
  };

  const onCloseEditModal = () => {
    if (isSubmitting) return;
    setEditModalOpen(false);
    setEditTargetId(null);
  };

  const onSaveEditModal = () => {
    if (!editTargetId) return;
    if (!editName.trim()) {
      alert("상품명을 입력해 주세요.");
      return;
    }
    const weightNorm = editWeight.trim();
    const parsedWeight =
      weightNorm === "" ? "" : Math.max(0, toInt(weightNorm));

    // TODO: 필요 시 여기에서 실제 PATCH API 연동
    setRows((prev) =>
      prev.map((r) =>
        r.id === editTargetId
          ? {
              ...r,
              name: editName.trim(),
              weight: parsedWeight,
              barcode: editBarcode.trim(),
            }
          : r
      )
    );

    setEditModalOpen(false);
    setEditTargetId(null);
  };

  // ── 엑셀 대량등록 (CSV/TSV 지원, XLSX는 라이브러리 사용 권장)
  const onClickBulkUpload = () => {
    if (!isAdmin) return;
    fileInputRef.current?.click();
  };

  const parseTextToItems = (text: string): RowItem[] => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) return [];

    // 헤더 추론: 첫 셀에 sku가 있으면 헤더
    const firstCells = splitLine(lines[0]).map((c) =>
      c.trim().toLowerCase()
    );
    const startIdx = firstCells[0] === "sku" ? 1 : 0;

    const items: RowItem[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cells = splitLine(lines[i]).map((c) => c.trim());
      const [
        sku = "",
        name = "",
        unitPriceStr = "",
        weightStr = "",
        barcode = "",
        statusStr = "",
        bundleQtyStr = "",
      ] = cells;

      if (
        [sku, name, unitPriceStr, weightStr, barcode, statusStr, bundleQtyStr].every(
          (v) => v === ""
        )
      )
        continue;

      const statusNorm = statusStr.toLowerCase();
      const status =
        statusNorm === "사용" ||
        statusNorm === "true" ||
        statusNorm === "1" ||
        statusNorm === "y";

      items.push({
        id: uuid(),
        sku,
        name,
        unitPrice: unitPriceStr === "" ? "" : toFloat(unitPriceStr),
        weight: weightStr === "" ? "" : toInt(weightStr),
        barcode,
        status,
        bundleQty:
          bundleQtyStr === "" ? "" : Math.max(1, toInt(bundleQtyStr)),
      });
    }
    return items;
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const ext = file.name.split(".").pop()?.toLowerCase();
    const isTextLike = ["csv", "tsv", "txt"].includes(ext || "");

    if (!isTextLike) {
      alert(
        "현재는 CSV/TSV만 지원해요. XLSX는 SheetJS 등 라이브러리 연동이 필요해요."
      );
      return;
    }

    try {
      const text = await file.text();
      const items = parseTextToItems(text);
      if (items.length === 0) {
        alert("가져올 데이터가 없어요.");
        return;
      }

      // 검증 간단 처리
      const invalid = items.find((r) => !r.sku?.trim() || !r.name?.trim());
      if (invalid) {
        alert(
          "SKU 또는 상품명이 비어있는 행이 있어요. 확인 후 다시 시도해주세요."
        );
        return;
      }

      // 서버로 대량 업로드
      const payload = {
        items: items.map((r) => ({
          sku: r.sku.trim(),
          name: r.name.trim(),
          unit_price: toFloat(r.unitPrice),
          weight_g: toInt(r.weight),
          barcode: r.barcode.trim(),
          status: !!r.status,
          bundle_qty:
            r.bundleQty === "" ? 1 : Math.max(1, toInt(r.bundleQty)),
        })),
      };

      const res = await fetch(API_BULK, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }

      alert(`대량 등록이 완료됐어요. 총 ${items.length}건`);
      await loadList();
    } catch (err: any) {
      console.error(err);
      alert(
        `대량등록 중 오류가 발생했어요.\n사유: ${String(
          err?.message || err
        )}`
      );
    }
  };

  // 하단 합계(참고)
  const summary = useMemo(() => {
    const count = rows.length;
    return { count };
  }, [rows]);

  // ── 렌더
  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* 상단 우측 액션바 */}
      <div className="flex items-center justify-end gap-2">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt"
          className="hidden"
          onChange={onFileChange}
        />
        <button
          onClick={onClickBulkUpload}
          disabled={!isAdmin || isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm ${
            !isAdmin || isSubmitting ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title="CSV/TSV 업로드 (XLSX는 라이브러리 연동 필요)"
        >
          엑셀 대량등록
        </button>
        <button
          onClick={onSubmitSingle}
          disabled={!isAdmin || isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
            isSubmitting
              ? "bg-gray-300 text-gray-600 cursor-wait"
              : "bg-black text-white"
          }`}
          title="상단 등록표의 1건을 등록"
        >
          {isSubmitting ? "등록 중..." : "등록"}
        </button>
      </div>

      {/* 상단: 단일 등록용 표 (묶음여부 컬럼 제거) */}
      <div className="rounded-xl border bg-white shadow-sm">
        <div className="overflow-auto">
          <table className="min-w-full table-auto">
            <thead>
              <tr className="text-left text-sm text-gray-600 border-b">
                <th className="px-3 py-2 w-[220px]">SKU</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2 w-[140px]">최근입고단가</th>
                <th className="px-3 py-2 w-[120px]">중량(g)</th>
                <th className="px-3 py-2 w-[160px]">바코드</th>
                <th className="px-3 py-2 w-[100px]">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b last:border-0">
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={formRow.sku}
                    onChange={(e) => onFormCellChange("sku", e.target.value)}
                    className="w-full border rounded-lg px-2 py-1 text-sm font-mono"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={formRow.name}
                    onChange={(e) => onFormCellChange("name", e.target.value)}
                    className="w-full border rounded-lg px-2 py-1 text-sm"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    inputMode="decimal"
                    value={formRow.unitPrice}
                    onChange={(e) =>
                      onFormCellChange("unitPrice", e.target.value)
                    }
                    className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                    placeholder="0"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    inputMode="numeric"
                    value={formRow.weight}
                    onChange={(e) => onFormCellChange("weight", e.target.value)}
                    className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                    placeholder="0"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="text"
                    value={formRow.barcode}
                    onChange={(e) =>
                      onFormCellChange("barcode", e.target.value)
                    }
                    className="w-full border rounded-lg px-2 py-1 text-sm"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-3 py-2">
                  <label className="inline-flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={formRow.status}
                      onChange={(e) =>
                        onFormCellChange("status", e.target.checked)
                      }
                      disabled={isSubmitting || !isAdmin}
                    />
                    <span>{formRow.status ? "사용" : "미사용"}</span>
                  </label>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* 상단 등록표 하단에 간단 안내/초기화 */}
        <div className="px-4 py-3 border-t text-sm flex justify-between">
          <div className="text-gray-500">
            상단 표에 1건 입력 후 우측 상단의 <strong>등록</strong> 버튼을 눌러
            저장하세요.
          </div>
          <button
            onClick={() => setFormRow(makeEmptyRow())}
            disabled={isSubmitting || !isAdmin}
            className="px-3 py-2 rounded-lg border text-sm"
          >
            초기화
          </button>
        </div>
      </div>

      {/* 하단: 조회/조정용 표 (묶음여부 및 묶음설정 유지) */}
      <div
        ref={pasteTargetRef}
        tabIndex={0}
        className="rounded-xl border bg-white shadow-sm outline-none"
        title="조회/조정을 위해 하단 표에서 직접 수정하거나 ‘묶음설정/선택 수정/삭제’ 기능을 사용하세요."
      >
        <div className="overflow-auto">
          <table className="min-w-full table-auto">
            <thead>
              <tr className="text-left text-sm text-gray-600 border-b">
                <th className="px-2 py-2 w-[40px] text-center">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && checked.size === rows.length}
                    onChange={(e) => {
                      if (e.target.checked)
                        setChecked(new Set(rows.map((r) => r.id)));
                      else setChecked(new Set());
                    }}
                    disabled={isSubmitting}
                  />
                </th>
                <th className="px-3 py-2 w-[220px]">SKU</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2 w-[140px]">최근입고단가</th>
                <th className="px-3 py-2 w-[120px]">중량(g)</th>
                <th className="px-3 py-2 w-[160px]">바코드</th>
                <th className="px-3 py-2 w-[100px]">상태</th>
                <th className="px-3 py-2 w-[140px]">묶음여부(매핑여부)</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={8}
                    className="text-center text-sm text-gray-500 py-8"
                  >
                    조회된 데이터가 없어요.
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const bundleQtyNum =
                    r.bundleQty === "" ? 1 : toInt(r.bundleQty);
                  const bundleMark = bundleQtyNum > 1 ? "O" : "X";
                  return (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="px-2 py-2 text-center">
                        <input
                          type="checkbox"
                          checked={checked.has(r.id)}
                          onChange={(e) =>
                            setChecked((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(r.id);
                              else next.delete(r.id);
                              return next;
                            })
                          }
                          disabled={isSubmitting}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={r.sku}
                          onChange={(e) =>
                            onCellChange(r.id, "sku", e.target.value)
                          }
                          className="w-full border rounded-lg px-2 py-1 text-sm font-mono"
                          disabled={isSubmitting || !isAdmin}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={r.name}
                          onChange={(e) =>
                            onCellChange(r.id, "name", e.target.value)
                          }
                          className="w-full border rounded-lg px-2 py-1 text-sm"
                          disabled={isSubmitting || !isAdmin}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          inputMode="decimal"
                          value={r.unitPrice}
                          onChange={(e) =>
                            onCellChange(r.id, "unitPrice", e.target.value)
                          }
                          className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                          placeholder="0"
                          disabled={isSubmitting || !isAdmin}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          inputMode="numeric"
                          value={r.weight}
                          onChange={(e) =>
                            onCellChange(r.id, "weight", e.target.value)
                          }
                          className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                          placeholder="0"
                          disabled={isSubmitting || !isAdmin}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="text"
                          value={r.barcode}
                          onChange={(e) =>
                            onCellChange(r.id, "barcode", e.target.value)
                          }
                          className="w-full border rounded-lg px-2 py-1 text-sm"
                          disabled={isSubmitting || !isAdmin}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <label className="inline-flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={r.status}
                            onChange={(e) =>
                              onCellChange(r.id, "status", e.target.checked)
                            }
                            disabled={isSubmitting || !isAdmin}
                          />
                          <span>{r.status ? "사용" : "미사용"}</span>
                        </label>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <input
                            inputMode="numeric"
                            value={r.bundleQty}
                            onChange={(e) =>
                              onCellChange(r.id, "bundleQty", e.target.value)
                            }
                            className="w-[90px] border rounded-lg px-2 py-1 text-sm text-right"
                            placeholder="1"
                            disabled={isSubmitting || !isAdmin}
                          />
                          <span
                            className={`text-xs px-2 py-1 rounded ${
                              bundleQtyNum > 1 ? "bg-green-100" : "bg-gray-100"
                            }`}
                          >
                            {bundleMark}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 하단 액션바(조정용) */}
        <div className="px-4 py-3 border-t text-sm flex items-center justify-between">
          <div className="text-gray-500">
            하단 표는 조회/조정용이에요. 셀을 수정하면 로컬 상태에 반영됩니다.
            실제 저장 API가 있다면 연결해도 돼요.
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onBulkBundle}
              disabled={!isAdmin || checked.size === 0}
              className="px-3 py-2 rounded-lg border text-sm"
            >
              묶음설정
            </button>
            <button
              onClick={onOpenEditModal}
              disabled={!isAdmin || checked.size === 0}
              className="px-3 py-2 rounded-lg border text-sm"
            >
              선택 수정
            </button>
            <button
              onClick={deleteSelected}
              disabled={!isAdmin || checked.size === 0}
              className="px-3 py-2 rounded-lg border text-sm text-red-600 border-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              선택 삭제
            </button>
            <button
              onClick={loadList}
              className="px-3 py-2 rounded-lg border text-sm"
              title="목록 새로고침"
            >
              새로고침
            </button>
            <div>
              총 행 수: <strong>{summary.count}</strong>
            </div>
          </div>
        </div>
      </div>

      {/* 선택 수정 모달 */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <h2 className="text-base font-semibold">상품 수정</h2>
              <button
                type="button"
                onClick={onCloseEditModal}
                className="text-sm text-gray-500"
              >
                닫기
              </button>
            </div>

            <div className="px-4 py-4 space-y-4 text-sm">
              <div>
                <div className="mb-1 text-xs text-gray-600">SKU</div>
                <div className="px-3 py-2 border rounded-lg bg-gray-50 font-mono text-sm">
                  {editSku}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  상품명
                </label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="상품명을 입력하세요."
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  중량(g)
                </label>
                <input
                  inputMode="numeric"
                  value={editWeight}
                  onChange={(e) =>
                    setEditWeight(e.target.value.replace(/[^\d]/g, ""))
                  }
                  className="w-full border rounded-lg px-3 py-2 text-sm text-right"
                  placeholder="0"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs text-gray-600">
                  바코드
                </label>
                <input
                  type="text"
                  value={editBarcode}
                  onChange={(e) => setEditBarcode(e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm"
                  placeholder="바코드를 입력하세요."
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 px-4 py-3 border-t text-sm">
              <button
                type="button"
                onClick={onCloseEditModal}
                className="px-3 py-2 rounded-lg border"
              >
                취소
              </button>
              <button
                type="button"
                onClick={onSaveEditModal}
                className="px-3 py-2 rounded-lg border bg-black text-white font-semibold"
              >
                저장
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
