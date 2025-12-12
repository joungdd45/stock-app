/* 📄 src/pages/product/Create/CreatePage.tsx
   상품관리 > 상품 등록 페이지
   - 상단: 단일 등록 폼
   - 하단: 조회 전용 테이블(재고현황 스타일)
   - 선택 수정: 모달
*/

import React, { useEffect, useMemo, useRef, useState } from "react";

import {
  productsAdapter,
  type ProductListItem,
  type ProductCreatePayload,
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
  weight: number | "";
  barcode: string;
  status: boolean;
  bundleQty: number | "";
};

type BundleRow = {
  id: string;
  componentSku: string;
  componentQty: string;
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

const makeEmptyRow = (): RowItem => ({
  id: uuid(),
  sku: "",
  name: "",
  unitPrice: "",
  weight: "",
  barcode: "",
  status: true,
  bundleQty: 1,
});

const makeEmptyBundleRow = (): BundleRow => ({
  id: uuid(),
  componentSku: "",
  componentQty: "1",
});

// 어댑터 → 화면 Row
const mapFromAdapter = (p: ProductListItem): RowItem => ({
  id: String(p.id ?? p.sku),
  sku: p.sku,
  name: p.name,
  unitPrice: p.unit_price ?? 0,
  weight: p.weight_g ?? 0,
  barcode: p.barcode ?? "",
  status: p.status ?? p.is_active ?? true,  // ← 핵심
  bundleQty: p.bundle_qty ?? 1,
});

// 생성 payload
const makeCreatePayloadFromForm = (r: RowItem): ProductCreatePayload => ({
  sku: r.sku.trim(),
  name: r.name.trim(),
  barcode: r.barcode.trim(),
  status: !!r.status,
  unit_price: toFloat(r.unitPrice),
  weight_g: toInt(r.weight),
  bundle_qty: 1,
});

// 수정 payload
const makeUpdatePayloadFromEdit = (
  name: string,
  weight: string,
  barcode: string,
  isActive: boolean,   // ← 여기 추가
): ProductUpdatePayload => {
  const weightNorm = weight.trim();
  const parsedWeight =
    weightNorm === "" ? undefined : Math.max(0, toInt(weightNorm));

  return {
    name: name.trim(),
    barcode: barcode.trim(),
    weight_g: parsedWeight,
    is_active: isActive,   // ← 여기에 추가
  };
};

// ───────────────────────────────────────────────
// 컴포넌트
// ───────────────────────────────────────────────

export default function CreatePage() {
  const isAdmin = true;

  // 상단 단일 등록
  const [formRow, setFormRow] = useState<RowItem>(makeEmptyRow());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 하단 조회용 표
  const [rows, setRows] = useState<RowItem[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const pasteTargetRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 선택 수정 모달
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);
  const [editSku, setEditSku] = useState("");
  const [editName, setEditName] = useState("");
  const [editWeight, setEditWeight] = useState("");
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

  // ───────────────────────────────────────────────
  // 목록 조회
  // ───────────────────────────────────────────────

  async function loadList() {
    const res = await productsAdapter.fetchList();
    if (!res.ok || !res.data) {
      console.error("상품 목록 조회 실패", res.error);
      if (!res.ok && res.error) {
        handleError(res.error);
      }
      setRows([]);
      setChecked(new Set());
      return;
    }
    const items = res.data.items.map(mapFromAdapter);
    setRows(items);
    setChecked(new Set());
  }

  // 상단 등록 셀 변경
  const onFormCellChange = (
    field: keyof Omit<RowItem, "id">,
    value: string | boolean,
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
      if (field === "bundleQty") {
        const raw = (value as string).replace(/[^\d]/g, "");
        return {
          ...prev,
          bundleQty: raw === "" ? "" : Math.max(1, Number(raw)),
        };
      }
      return { ...prev, [field]: value as string };
    });
  };

  // 상단 등록 검증
  const validateOne = (r: RowItem) => {
    if (!r.sku.trim()) return "SKU는 필수예요.";
    if (!r.name.trim()) return "상품명은 필수예요.";
    if (toFloat(r.unitPrice) < 0) return "최근입고단가는 0 이상이어야 해요.";
    if (toInt(r.weight) < 0) return "중량은 0 이상이어야 해요.";
    return "";
  };

  // 상단 등록 실행
  const onSubmitSingle = async () => {
    if (!isAdmin) return;

    const msg = validateOne(formRow);
    if (msg) {
      alert(msg);
      return;
    }

    const payload = makeCreatePayloadFromForm(formRow);

    try {
      setIsSubmitting(true);
      const res = await productsAdapter.createOne(payload);
      if (!res.ok) {
        console.error("상품 단일 등록 실패", res.error);
        if (res.error) {
          handleError(res.error);
        }
        return;
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

  // 체크박스
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
      if (prev.size === rows.length) return new Set();
      return new Set(rows.map((r) => r.id));
    });
  };

  // 묶음설정 모달 열기 (선택된 1건 기준)
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

  // 묶음설정 행 편집
  const onChangeBundleCell = (
    id: string,
    field: "componentSku" | "componentQty",
    value: string,
  ) => {
    setBundleRows((prev) =>
      prev.map((row) =>
        row.id === id ? { ...row, [field]: value } : row,
      ),
    );
  };

  const onAddBundleRow = () => {
    setBundleRows((prev) => [...prev, makeEmptyBundleRow()]);
  };

  const onRemoveBundleRow = (id: string) => {
    setBundleRows((prev) => {
      if (prev.length === 1) {
        // 마지막 한 줄은 내용만 비우기
        return [makeEmptyBundleRow()];
      }
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
        return {
          component_sku: sku,
          component_qty: qty,
        };
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
      if (res.error) {
        handleError(res.error);
      }
      return;
    }

    if (res.data?.ok) {
      alert("묶음 구성이 저장됐어요.\n(기존 구성은 새 구성으로 교체됩니다.)");
    }

    onCloseBundleModal();
    await loadList();
  };

  // 선택 수정 모달 오픈
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
    setEditWeight(
      target.weight === "" || target.weight === undefined
        ? ""
        : String(target.weight),
    );
    setEditBarcode(target.barcode);

    // ✅ 활성/비활성 상태도 같이 세팅
    setEditIsActive(target.status); // ProductListItem.status 기준

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

    const payload = makeUpdatePayloadFromEdit(
      editName,
      editWeight,
      editBarcode,
      editIsActive, // ✅ 여기로 전달
    );

    const res = await productsAdapter.updateOne(editSku, payload);
    if (!res.ok) {
      console.error("상품 수정 실패", res.error);
      if (res.error) {
        handleError(res.error);
      }
      return;
    }

    setEditModalOpen(false);
    setEditTargetId(null);
    await loadList();
  };

  // 엑셀 업로드

  const onClickBulkUpload = () => {
    if (!isAdmin) return;
    fileInputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    try {
      const text = await file.text();
      const res = await productsAdapter.bulkUploadFromText(text);
      if (!res.ok) {
        console.error("대량등록 실패", res.error);
        if (res.error) {
          handleError(res.error);
        }
        return;
      }

      const count = res.data?.count ?? 0;
      alert(`대량 등록이 완료됐어요. 총 ${count}건`);
      await loadList();
    } catch (err: any) {
      console.error(err);
      alert(
        `대량등록 중 오류가 발생했어요.\n사유: ${String(
          err?.message || err,
        )}`,
      );
    }
  };

  // 하단 합계
  const summary = useMemo(() => {
    const count = rows.length;
    return { count };
  }, [rows]);

  const anyChecked = checked.size > 0;

  const displayUnitPrice = (v: RowItem["unitPrice"]) =>
    v === "" ? "" : fmtInt(Number(v));
  const displayWeight = (v: RowItem["weight"]) =>
    v === "" ? "" : fmtInt(Number(v));
  const displayBundle = (v: RowItem["bundleQty"]) =>
    v === "" ? "" : String(v);

  // ───────────────────────────────────────────────
  // 렌더
  // ───────────────────────────────────────────────

  return (
    <div className="w-full h-full flex flex-col gap-4 p-3">
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
          title="CSV/TSV 업로드 (현재는 API 연결 전용)"
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

      {/* 상단: 단일 등록용 표 */}
      <div className="rounded-2xl border bg-white shadow-sm">
        <div className="overflow-auto">
          <table className="min-w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-sm text-gray-600 border-b bg-gray-50">
                <th className="px-4 py-3 w-[220px] text-center">SKU</th>
                <th className="px-4 py-3 text-center">상품명</th>
                <th className="px-4 py-3 w-[140px] text-right">
                  최근입고단가
                </th>
                <th className="px-4 py-3 w-[120px] text-right">중량(g)</th>
                <th className="px-4 py-3 w-[180px]">바코드</th>
                <th className="px-4 py-3 w-[110px] text-center">상태</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b last:border-0">
                <td className="px-4 py-2 text-center">
                  <input
                    type="text"
                    value={formRow.sku}
                    onChange={(e) => onFormCellChange("sku", e.target.value)}
                    className="w-full border rounded-lg px-2 py-1 text-sm font-mono text-center"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-4 py-2 text-center">
                  <input
                    type="text"
                    value={formRow.name}
                    onChange={(e) => onFormCellChange("name", e.target.value)}
                    className="w-full border rounded-lg px-2 py-1 text-sm text-center"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-4 py-2">
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
                <td className="px-4 py-2">
                  <input
                    inputMode="numeric"
                    value={formRow.weight}
                    onChange={(e) =>
                      onFormCellChange("weight", e.target.value)
                    }
                    className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                    placeholder="0"
                    disabled={isSubmitting || !isAdmin}
                  />
                </td>
                <td className="px-4 py-2">
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
                <td className="px-4 py-2 text-center">
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

      {/* 하단: 조회 전용 테이블 */}
      <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden flex flex-col max-h-[520px]">
        {/* 상단 설명 */}
        <div className="border-b border-gray-100 px-4 py-3 text-sm text-gray-600">
          하단 표는 조회·조정용입니다. 셀은 수정 불가이며, 선택 후 상단 버튼으로
          묶음설정·선택수정·선택삭제를 할 수 있어요.
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

        {/* 표 스크롤 영역 */}
        <div className="flex-1 overflow-y-auto overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col style={{ width: "44px" }} />
              {/* 🔧 SKU 열 폭을 220px로 늘려서 상단 표와 정렬 맞춤 */}
              <col style={{ width: "180px" }} />
              <col style={{ width: "220px" }} />
              <col style={{ width: "140px" }} />
              <col style={{ width: "120px" }} />
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
                <th className="px-2 py-3">중량(g)</th>
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
                  <td className="px-2 py-2 text-center align-middle">
                    {r.name}
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    {displayUnitPrice(r.unitPrice)}
                  </td>
                  <td className="px-2 py-2 text-center align-middle">
                    {displayWeight(r.weight)}
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
                    colSpan={8}
                    className="px-4 py-10 text-center text-sm text-gray-500"
                  >
                    등록된 상품이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 하단 요약 + 간이 페이지 영역 */}
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
                <div className="mb-1 text-gray-600">중량(g)</div>
                <input
                  type="text"
                  inputMode="numeric"
                  value={editWeight}
                  onChange={(e) => setEditWeight(e.target.value)}
                  className="w-full rounded-lg border px-2 py-1 text-sm text-right"
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
                            onChangeBundleCell(
                              row.id,
                              "componentSku",
                              e.target.value,
                            )
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

                  {bundleRows.length === 0 && (
                    <tr>
                      <td
                        colSpan={3}
                        className="px-4 py-6 text-center text-sm text-gray-500"
                      >
                        구성품 행이 없습니다. 아래 버튼으로 행을 추가해 주세요.
                      </td>
                    </tr>
                  )}
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

      {/* 숨김 포커스 영역 */}
      <div ref={pasteTargetRef} className="sr-only" tabIndex={-1} />
    </div>
  );
}
