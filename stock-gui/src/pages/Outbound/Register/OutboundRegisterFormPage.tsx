/* src/pages/outbound/Register/RegisterFormPage.tsx
   ✅ 출고등록 > 등록 탭
   v2.6 (템플릿 헤더 확정 반영)
   - 템플릿 헤더:
     번호 | 국가 | 주문번호 | 트래킹번호 | SKU | 출고수량 | 총가격
   - 엑셀에는 상품명이 없으므로: SKU로 상품명 자동조회하여 name 채움
   - 엑셀 상단 타이틀/병합셀 등 장식행이 있을 수 있으니 "헤더 행 자동 탐색" 적용
   - 대량등록: label(for=file) 방식으로 파일 선택창 100% 보장
   - 템플릿 다운로드: fetch → a.download + 파일명 자동 증가 (YYYYMMDD_1,2..)
*/

import React, { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";

import { outboundAdapter } from "@/api/adapters/outbound.adapter";
import { inboundAdapter } from "@/api/adapters/inbound.adapter";
import { handleError } from "@/utils/handleError";

type RowItem = {
  id: string;
  country: string;
  orderNo: string;
  trackingNo: string;
  sku: string;
  name: string;
  quantity: number | "";
  totalPrice: number | "";
};

const uuid = () => Math.random().toString(36).slice(2, 10);

const stripComma = (s: string) => s.replace(/[, ]+/g, "");
const toNumber = (v: number | string | ""): number => {
  if (v === "" || v === undefined || v === null) return 0;
  const raw = typeof v === "string" ? stripComma(v) : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};

const fmt = (n: number | "") =>
  n === "" ? "" : new Intl.NumberFormat().format(n as number);

const makeEmptyRow = (): RowItem => ({
  id: uuid(),
  country: "",
  orderNo: "",
  trackingNo: "",
  sku: "",
  name: "",
  quantity: "",
  totalPrice: "",
});

const isEmptyRow = (r: RowItem) =>
  !r.country &&
  !r.orderNo &&
  !r.trackingNo &&
  !r.sku &&
  !r.name &&
  !r.quantity &&
  !r.totalPrice;

/* ─────────────────────────────────────────────
 * 템플릿 다운로드 (파일명 자동 증가)
 * ───────────────────────────────────────────── */

const BULK_TEMPLATE_URL = "/templates/출고대량등록_양식.xlsx";
const BULK_TEMPLATE_BASENAME = "출고대량등록_양식";

const pad2 = (n: number) => String(n).padStart(2, "0");
const ymd = () => {
  const d = new Date();
  return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
};
const nextSeqForToday = (baseKey: string) => {
  const key = `${baseKey}_${ymd()}`;
  const prev = Number(localStorage.getItem(key) || "0");
  const next = prev + 1;
  localStorage.setItem(key, String(next));
  return String(next);
};

async function downloadXlsxWithAutoSeq(url: string, baseName: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("양식 파일을 불러오지 못했어요.");

  const blob = await res.blob();
  const seq = nextSeqForToday("outbound_bulk_template_seq");
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

/* ─────────────────────────────────────────────
 * SKU → 상품명 조회
 * ───────────────────────────────────────────── */

function useProductName() {
  const inFlight = React.useRef<Record<string, Promise<string | null>>>({});

  const getName = async (sku: string): Promise<string | null> => {
    const key = sku.trim();
    if (!key) return null;

    if (!inFlight.current[key]) {
      inFlight.current[key] = (async () => {
        const res = await inboundAdapter.lookupProductBySku(key);
        if (!res.ok) return null;
        const data = res.data;
        if (!data?.ok || !data.item) return null;
        return data.item.name ?? null;
      })();
    }

    const name = await inFlight.current[key];
    if (!name) delete inFlight.current[key];
    return name;
  };

  return { getName };
}

/* ─────────────────────────────────────────────
 * 엑셀 파싱
 * - 헤더 행 자동 탐색(상단 타이틀/장식행 무시)
 * - 확정 헤더(한글):
 *   번호 | 국가 | 주문번호 | 트래킹번호 | SKU | 출고수량 | 총가격
 * ───────────────────────────────────────────── */

const norm = (v: any) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");

const headerKey = (h: string) => {
  const x = norm(h);

  // 한글 (확정)
  if (x === "국가") return "country";
  if (x === "주문번호") return "order_number";
  if (x === "트래킹번호") return "tracking_number";
  if (x === "sku") return "sku";
  if (x === "출고수량") return "qty";
  if (x === "총가격") return "total_price";

  // 혹시 변형이 생길 수 있어서 최소 보강
  if (x.includes("국가")) return "country";
  if (x.includes("주문")) return "order_number";
  if (x.includes("트래킹") || x.includes("송장")) return "tracking_number";
  if (x.includes("sku")) return "sku";
  if (x.includes("출고") && x.includes("수량")) return "qty";
  if (x.includes("총") && x.includes("가격")) return "total_price";

  return "";
};

type BulkItem = {
  country: string;
  order_number: string;
  tracking_number: string;
  sku: string;
  qty: number;
  total_price: number;
};

async function parseXlsxFileToBulkItems(file: File): Promise<BulkItem[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return [];

  const ws = wb.Sheets[wsName];
  const table: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });

  if (!table || table.length < 2) return [];

  // ✅ 이번 템플릿 기준 required: 상품명 없음
  const requiredKeys = [
    "country",
    "order_number",
    "tracking_number",
    "sku",
    "qty",
    "total_price",
  ];

  let headerRowIndex = -1;
  let idx: Record<string, number> = {};

  // 상단 30줄 안에서 헤더를 찾는다
  for (let r = 0; r < Math.min(table.length, 30); r++) {
    const row = table[r] || [];
    const tempIdx: Record<string, number> = {};

    row.forEach((cell, i) => {
      const k = headerKey(String(cell ?? ""));
      if (k) tempIdx[k] = i;
    });

    const missing = requiredKeys.filter((k) => tempIdx[k] === undefined);
    if (missing.length === 0) {
      headerRowIndex = r;
      idx = tempIdx;
      break;
    }
  }

  if (headerRowIndex === -1) {
    throw new Error(
      "엑셀 헤더를 인식하지 못했어요. (번호/국가/주문번호/트래킹번호/SKU/출고수량/총가격인지 확인해줘)",
    );
  }

  const out: BulkItem[] = [];

  for (let r = headerRowIndex + 1; r < table.length; r++) {
    const row = table[r] || [];
    const hasAny = row.some((v) => String(v ?? "").trim() !== "");
    if (!hasAny) continue;

    const get = (k: string) => row[idx[k]];

    const country = String(get("country") ?? "").trim().toUpperCase();
    const order_number = String(get("order_number") ?? "").trim();
    const tracking_number = String(get("tracking_number") ?? "").trim();
    const sku = String(get("sku") ?? "").trim();

    const qty = toNumber(String(get("qty") ?? ""));
    const total_price = toNumber(String(get("total_price") ?? ""));

    // 번호만 있는 빈행 같은 것 방지
    if (!country && !order_number && !tracking_number && !sku && qty === 0 && total_price === 0)
      continue;

    out.push({
      country,
      order_number,
      tracking_number,
      sku,
      qty,
      total_price,
    });
  }

  return out;
}

export default function RegisterFormPage() {
  const { getName } = useProductName();

  const [rows, setRows] = useState<RowItem[]>([makeEmptyRow()]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 대량등록 파일 input (label로 트리거)
  const bulkInputId = "outbound-bulk-xlsx";

  const addRow = () => setRows((prev) => [...prev, makeEmptyRow()]);

  const clearAll = () => {
    setRows([makeEmptyRow()]);
    setChecked(new Set());
  };

  const deleteSelected = () => {
    setRows((prev) => prev.filter((r) => !checked.has(r.id)));
    setChecked(new Set());
  };

  const onCellChange = async (
    id: string,
    field: keyof Pick<
      RowItem,
      | "country"
      | "orderNo"
      | "trackingNo"
      | "sku"
      | "name"
      | "quantity"
      | "totalPrice"
    >,
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((r) =>
        r.id === id
          ? {
              ...r,
              [field]:
                field === "quantity"
                  ? value.replace(/[^\d]/g, "")
                  : field === "totalPrice"
                    ? value.replace(/[^\d.]/g, "")
                    : value,
            }
          : r,
      ),
    );

    if (field === "sku") {
      const sku = value.trim();
      if (!sku) return;
      const name = await getName(sku);
      if (!name) return;

      setRows((prev) =>
        prev.map((r) =>
          r.id === id && (!r.name || r.name.trim() === "")
            ? { ...r, name }
            : r,
        ),
      );
    }
  };

  const applyBulkItemsToRows = async (items: BulkItem[]) => {
    if (!items || items.length === 0) return;

    const mapped: RowItem[] = items.map((it) => ({
      id: uuid(),
      country: it.country ?? "",
      orderNo: it.order_number ?? "",
      trackingNo: it.tracking_number ?? "",
      sku: it.sku ?? "",
      name: "", // ✅ 엑셀에 상품명 없음 → 아래에서 SKU로 채움
      quantity: typeof it.qty === "number" ? it.qty : toNumber(String(it.qty)),
      totalPrice:
        typeof it.total_price === "number"
          ? it.total_price
          : toNumber(String(it.total_price)),
    }));

    // ✅ 상품명 자동조회
    const withNames = await Promise.all(
      mapped.map(async (r) => {
        if (!r.sku) return r;
        const name = await getName(r.sku.trim());
        return name ? { ...r, name } : r;
      }),
    );

    setRows((prev) => {
      const prevAllEmpty = prev.length > 0 && prev.every((r) => isEmptyRow(r));
      return prevAllEmpty ? withNames : [...prev, ...withNames];
    });
    setChecked(new Set());
  };

  const onChangeBulkFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      // 같은 파일 다시 선택 가능하도록 즉시 리셋
      e.target.value = "";
      if (!file) return;

      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext !== "xlsx") {
        alert("xlsx 파일만 지원해요. (양식 파일로 저장한 xlsx를 선택해줘)");
        return;
      }

      const items = await parseXlsxFileToBulkItems(file);
      await applyBulkItemsToRows(items);
    } catch (err: any) {
      console.error(err);
      handleError(err as any);
    }
  };

  const onDownloadTemplate = async () => {
    try {
      await downloadXlsxWithAutoSeq(BULK_TEMPLATE_URL, BULK_TEMPLATE_BASENAME);
    } catch (err: any) {
      handleError(err as any);
    }
  };

  const totalQty = useMemo(
    () => rows.reduce((acc, r) => acc + toNumber(r.quantity), 0),
    [rows],
  );

  const validate = (items: RowItem[]) => {
    const invalid = items.filter((r) => {
      const qty = toNumber(r.quantity);
      const total = toNumber(r.totalPrice);
      return (
        !r.country?.trim() ||
        !r.orderNo?.trim() ||
        !r.trackingNo?.trim() ||
        !r.sku?.trim() ||
        !r.name?.trim() || // ✅ SKU 조회 실패 시 여기서 걸림
        qty <= 0 ||
        total < 0
      );
    });
    return { ok: invalid.length === 0, invalid };
  };

  const onSubmitRegister = async () => {
    if (rows.length === 0 || rows.every(isEmptyRow)) {
      alert("저장할 데이터가 없습니다.");
      return;
    }

    const { ok, invalid } = validate(rows);
    if (!ok) {
      const first = invalid[0];
      alert(
        `필수값이 비어있거나 잘못된 행이 있습니다.\n국가, 주문번호, 트래킹번호, SKU, 출고수량, 총가격을 확인해주세요.\n(상품명은 SKU로 자동 조회됩니다)\n문제 행 SKU: ${
          first.sku || "(빈 값)"
        }`,
      );
      return;
    }

    const items = rows.map((r) => ({
      country: r.country.trim(),
      order_number: r.orderNo.trim(),
      tracking_number: r.trackingNo.trim(),
      sku: r.sku.trim(),
      product_name: r.name.trim(), // ✅ 서비스 DTO 요구
      qty: toNumber(r.quantity),
      total_price: toNumber(r.totalPrice),
    }));

    try {
      setIsSubmitting(true);
      const res = await outboundAdapter.registerForm({ items }); //
      if (!res.ok) {
        handleError(res.error);
        return;
      }

      alert("출고 등록이 완료되었습니다.");
      clearAll();
    } catch (err: any) {
      console.error(err);
      handleError(err as any);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* 숨김 파일 input: label 클릭으로 트리거 */}
      <input
        id={bulkInputId}
        type="file"
        accept=".xlsx"
        className="hidden"
        onChange={onChangeBulkFile}
      />

      {/* 액션바 */}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDownloadTemplate}
          disabled={isSubmitting}
          className="px-3 py-2 rounded-lg border text-sm"
          title="출고 대량등록 엑셀 양식 다운로드"
        >
          대량등록 템플릿
        </button>

        <label
          htmlFor={bulkInputId}
          className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${
            isSubmitting ? "opacity-50 pointer-events-none" : ""
          }`}
          title="작성한 엑셀(xlsx) 파일을 선택하면 행이 자동 추가됩니다."
        >
          엑셀 대량등록
        </label>

        <button
          type="button"
          onClick={addRow}
          className="px-3 py-2 rounded-lg border text-sm"
        >
          행 추가
        </button>

        <button
          type="button"
          onClick={deleteSelected}
          disabled={checked.size === 0 || isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm ${
            checked.size === 0 || isSubmitting
              ? "opacity-50 cursor-not-allowed"
              : "text-red-600 border-red-600"
          }`}
        >
          선택 삭제
        </button>

        <button
          type="button"
          onClick={clearAll}
          disabled={isSubmitting}
          className="px-3 py-2 rounded-lg border text-sm"
        >
          초기화
        </button>

        <button
          type="button"
          onClick={onSubmitRegister}
          disabled={isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
            isSubmitting
              ? "bg-gray-300 text-gray-600 cursor-wait"
              : "bg-black text-white"
          }`}
        >
          {isSubmitting ? "저장 중..." : "출고 등록"}
        </button>
      </div>

      {/* 테이블 */}
      <div className="rounded-xl border bg-white shadow-sm outline-none">
        <div className="overflow-auto">
          <table className="min-w-full table-auto">
            <thead>
              <tr className="text-left text-sm text-gray-600 border-b">
                <th className="px-2 py-2 w-[40px] text-center">
                  <input
                    type="checkbox"
                    checked={rows.length > 0 && checked.size === rows.length}
                    onChange={(e) => {
                      if (e.target.checked) setChecked(new Set(rows.map((r) => r.id)));
                      else setChecked(new Set());
                    }}
                    disabled={isSubmitting}
                  />
                </th>
                <th className="px-3 py-2 w-[100px]">국가</th>
                <th className="px-3 py-2 w-[180px]">주문번호</th>
                <th className="px-3 py-2 w-[200px]">트래킹번호</th>
                <th className="px-3 py-2 w-[240px]">SKU</th>
                <th className="px-3 py-2">상품명(자동)</th>
                <th className="px-3 py-2 w-[110px]">출고수량</th>
                <th className="px-3 py-2 w-[140px]">총가격</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-sm text-gray-500 py-8">
                    입력할 행이 없습니다.
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
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
                        placeholder="예: SG"
                        value={r.country}
                        onChange={(e) => onCellChange(r.id, "country", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        disabled={isSubmitting}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="주문번호"
                        value={r.orderNo}
                        onChange={(e) => onCellChange(r.id, "orderNo", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        disabled={isSubmitting}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="text"
                        placeholder="트래킹번호"
                        value={r.trackingNo}
                        onChange={(e) =>
                          onCellChange(r.id, "trackingNo", e.target.value)
                        }
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        disabled={isSubmitting}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.sku}
                        onChange={(e) => onCellChange(r.id, "sku", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm font-mono"
                        disabled={isSubmitting}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.name}
                        onChange={(e) => onCellChange(r.id, "name", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        disabled={isSubmitting}
                        placeholder="SKU로 자동 채움"
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        inputMode="numeric"
                        value={r.quantity}
                        onChange={(e) =>
                          onCellChange(r.id, "quantity", e.target.value)
                        }
                        className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                        disabled={isSubmitting}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        inputMode="decimal"
                        value={r.totalPrice}
                        onChange={(e) =>
                          onCellChange(r.id, "totalPrice", e.target.value)
                        }
                        className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                        disabled={isSubmitting}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* 합계 */}
        <div className="px-4 py-3 border-t text-sm flex justify-end">
          <div>
            총 수량: <b>{fmt(totalQty)}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
