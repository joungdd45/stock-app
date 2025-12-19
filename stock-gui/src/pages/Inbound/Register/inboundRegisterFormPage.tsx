/* src/pages/inbound/register/inboundRegisterFormPage.tsx
   ✅ 입고등록 > 등록 탭 (API 저장 연동판 - 어댑터 사용)
   v2.3 (금액 표시/계산 정리: 총 단가 콤마 표시 + 개당 단가 원화 반올림)
   - 템플릿 헤더(확정):
     번호 | 주문일자 | SKU | 입고 | 총 단가 | 입고처
   - 엑셀에는 개당단가 없음 → (입고 수량, 총 단가)로 페이지에서 자동 계산 + readonly 표시
   - ✅ 개당 단가: 원화 기준, Math.round로 반올림(소수점 제거)
   - ✅ 총 단가: 입력은 숫자만, 표시값은 천단위 콤마
   - 상품명은 엑셀에 없어도 됨 → SKU로 상품명 자동조회하여 name 채움
   - 엑셀 상단 타이틀/장식행이 있을 수 있으니 "헤더 행 자동 탐색" 적용
   - 대량등록: label(for=file) 방식으로 파일 선택창 100% 보장
   - 템플릿 다운로드: fetch → a.download + 파일명 자동 증가 (YYYYMMDD_1,2.)
   - ✅ 버튼 정렬/순서: [다운로드] → [엑셀 업로드(대량등록)] → [행 추가] → [선택 삭제] → [초기화] → [입고 등록]
*/

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { inboundAdapter } from "@/api/adapters/inbound.adapter";
import { handleError } from "@/utils/handleError";

type RowItem = {
  id: string;
  orderDate: string;
  sku: string;
  name: string;
  qty: number | "";
  totalPrice: number | "";
  unitPrice: number | "";
  supplier: string;
};

// ✅ uuid, 숫자 헬퍼
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
  orderDate: "",
  sku: "",
  name: "",
  qty: "",
  totalPrice: "",
  unitPrice: "",
  supplier: "",
});

const isEmptyRow = (r: RowItem) =>
  !r.orderDate &&
  !r.sku &&
  !r.name &&
  !r.qty &&
  !r.totalPrice &&
  !r.unitPrice &&
  !r.supplier;

/* ─────────────────────────────────────────────
 * 템플릿 다운로드 (파일명 자동 증가)
 * ───────────────────────────────────────────── */

const BULK_TEMPLATE_URL = "/templates/입고대량등록_양식.xlsx";
const BULK_TEMPLATE_BASENAME = "입고대량등록_양식";

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
  const seq = nextSeqForToday("inbound_bulk_template_seq");
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
 * SKU → 상품명 자동조회
 * - 간단 캐시 + 중복 요청 방지
 * ───────────────────────────────────────────── */

const PRODUCT_NAME_CACHE: Record<string, string> = {};

function useProductName() {
  const inFlight = React.useRef<Record<string, Promise<string | null>>>({});

  const getName = async (sku: string): Promise<string | null> => {
    const key = sku.trim();
    if (!key) return null;

    if (PRODUCT_NAME_CACHE[key]) return PRODUCT_NAME_CACHE[key];

    if (!inFlight.current[key]) {
      inFlight.current[key] = (async () => {
        try {
          const res = await inboundAdapter.lookupProductBySku(key);
          if (!res.ok || !res.data?.item) return null;
          const name = res.data.item.name ?? null;
          if (name) PRODUCT_NAME_CACHE[key] = name;
          return name;
        } catch (err) {
          console.error("SKU 조회 실패", key, err);
          return null;
        } finally {
          delete inFlight.current[key];
        }
      })();
    }

    return inFlight.current[key];
  };

  return { getName };
}

/* ─────────────────────────────────────────────
 * 엑셀 파싱
 * - 헤더 행 자동 탐색(상단 타이틀/장식행 무시)
 * - 확정 헤더(한글):
 *   번호 | 주문일자 | SKU | 입고 | 총 단가 | 입고처
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
  if (x === "주문일자") return "order_date";
  if (x === "sku") return "sku";
  if (x === "입고") return "qty";
  if (x === "총단가") return "total_price";
  if (x === "입고처") return "supplier";

  // 최소 보강(변형 대비)
  if (x.includes("주문") && x.includes("일자")) return "order_date";
  if (x.includes("sku")) return "sku";
  if (x.includes("입고") && !x.includes("처")) return "qty";
  if (x.includes("총") && x.includes("단가")) return "total_price";
  if (x.includes("입고") && x.includes("처")) return "supplier";

  return "";
};

type BulkItem = {
  order_date: string;
  sku: string;
  qty: number;
  total_price: number;
  supplier: string;
};

async function parseXlsxFileToBulkItems(file: File): Promise<BulkItem[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return [];

  const ws = wb.Sheets[wsName];
  const table: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!table || table.length < 2) return [];

  const requiredKeys = ["order_date", "sku", "qty", "total_price", "supplier"];

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
      "엑셀 헤더를 인식하지 못했어요. (번호/주문일자/SKU/입고/총 단가/입고처인지 확인해줘)",
    );
  }

  const out: BulkItem[] = [];

  for (let r = headerRowIndex + 1; r < table.length; r++) {
    const row = table[r] || [];
    const hasAny = row.some((v) => String(v ?? "").trim() !== "");
    if (!hasAny) continue;

    const get = (k: string) => row[idx[k]];

    const order_date = String(get("order_date") ?? "").trim();
    const sku = String(get("sku") ?? "").trim();
    const supplier = String(get("supplier") ?? "").trim();

    const qty = toNumber(String(get("qty") ?? ""));
    const total_price = toNumber(String(get("total_price") ?? ""));

    if (!order_date && !sku && !supplier && qty === 0 && total_price === 0) continue;

    out.push({
      order_date,
      sku,
      qty,
      total_price,
      supplier,
    });
  }

  return out;
}

export default function RegisterFormPage() {
  const { getName } = useProductName();

  const [rows, setRows] = useState<RowItem[]>([makeEmptyRow()]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addRow = () => setRows((prev) => [...prev, makeEmptyRow()]);

  const clearAll = () => {
    setRows([makeEmptyRow()]);
    setChecked(new Set());
  };

  const deleteSelected = () => {
    setRows((prev) => prev.filter((r) => !checked.has(r.id)));
    setChecked(new Set());
  };

  // ✅ 개당 단가: 원화 기준, 끝자리 반올림(소수점 제거)
  const recalcUnit = (next: RowItem) => {
    const q = toNumber(next.qty);
    const t = toNumber(next.totalPrice);

    if (q > 0 && t >= 0) {
      const u = Math.round(t / q);
      next.unitPrice = Number.isFinite(u) ? u : "";
    } else {
      next.unitPrice = "";
    }
    return next;
  };

  const onCellChange = async (
    id: string,
    field: keyof Pick<RowItem, "orderDate" | "sku" | "name" | "qty" | "totalPrice" | "supplier">,
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        // 숫자 칸(qty/totalPrice)은 string으로 들어오니 캐스팅 허용
        const next: RowItem = { ...r, [field]: value as any };
        return recalcUnit(next);
      }),
    );

    if (field === "sku" && value) {
      const name = await getName(value);
      if (name) {
        setRows((prev) =>
          prev.map((r) =>
            r.id === id && (!r.name || r.name.trim() === "") ? { ...r, name } : r,
          ),
        );
      }
    }
  };

  const applyBulkItemsToRows = async (items: BulkItem[]) => {
    if (!items || items.length === 0) return;

    const mapped: RowItem[] = items.map((it) => {
      const qty = typeof it.qty === "number" ? it.qty : toNumber(String(it.qty));
      const total =
        typeof it.total_price === "number"
          ? it.total_price
          : toNumber(String(it.total_price));

      const next: RowItem = {
        id: uuid(),
        orderDate: it.order_date ?? "",
        sku: it.sku ?? "",
        name: "",
        qty,
        totalPrice: total,
        unitPrice: "",
        supplier: it.supplier ?? "",
      };

      return recalcUnit(next);
    });

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
      e.target.value = "";
      if (!file) return;

      const ext = (file.name.split(".").pop() || "").toLowerCase();
      if (ext !== "xlsx") {
        alert("xlsx 파일만 지원해요. (양식 파일로 저장한 xlsx를 선택해줘)");
        return;
      }

      const items = await parseXlsxFileToBulkItems(file);
      await applyBulkItemsToRows(items);
    } catch (err) {
      console.error(err);
      handleError(err as any);
    }
  };

  const onDownloadTemplate = async () => {
    try {
      await downloadXlsxWithAutoSeq(BULK_TEMPLATE_URL, BULK_TEMPLATE_BASENAME);
    } catch (err) {
      handleError(err as any);
    }
  };

  const summary = useMemo(() => {
    const totalQty = rows.reduce((acc, r) => acc + toNumber(r.qty), 0);
    const totalPrice = rows.reduce((acc, r) => acc + toNumber(r.totalPrice), 0);
    return { totalQty, totalPrice };
  }, [rows]);

  const validate = (items: RowItem[]) => {
    const invalid = items.filter((r) => {
      const qty = toNumber(r.qty);
      const total = toNumber(r.totalPrice);
      return !r.orderDate || !r.sku?.trim() || !r.supplier?.trim() || qty <= 0 || total < 0;
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
        `필수값이 비어있거나 잘못된 행이 있습니다.
주문일자, SKU, 입고 수량, 총 단가, 입고처를 확인해주세요.
문제 행 SKU: ${first.sku || "(빈 값)"}`,
      );
      return;
    }

    const payload = {
      items: rows.map((r) => {
        const qty = toNumber(r.qty);
        const total = toNumber(r.totalPrice);
        // ✅ 저장도 동일 규칙: 원화 반올림(정수)
        const unit = qty ? Math.round(total / qty) : 0;

        return {
          order_date: r.orderDate,
          sku: r.sku.trim(),
          name: r.name.trim(),
          qty,
          total_price: total,
          unit_price: unit,
          supplier_name: r.supplier.trim(),
          memo: "",
        };
      }),
    };

    try {
      setIsSubmitting(true);
      const res = await inboundAdapter.registerFormCreate(payload);
      if (!res.ok) return handleError(res.error);

      alert("입고 등록이 완료됐어요.");
      clearAll();
    } catch (err) {
      console.error(err);
      handleError(err as any);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* 액션바 (한 덩어리 + 지정 순서) */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onDownloadTemplate}
          disabled={isSubmitting}
          className="px-3 py-2 rounded-lg border text-sm"
        >
          대량등록 템플릿
        </button>

        <input
          id="inbound-bulk-file"
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={onChangeBulkFile}
          disabled={isSubmitting}
        />
        <label
          htmlFor="inbound-bulk-file"
          className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${
            isSubmitting ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title="xlsx 양식 파일을 선택해 업로드하면 행이 자동으로 채워집니다."
        >
          엑셀 대량등록
        </label>

        <button onClick={addRow} className="px-3 py-2 rounded-lg border text-sm">
          행 추가
        </button>

        <button
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
          onClick={clearAll}
          disabled={isSubmitting}
          className="px-3 py-2 rounded-lg border text-sm"
        >
          초기화
        </button>

        <button
          onClick={onSubmitRegister}
          disabled={isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
            isSubmitting ? "bg-gray-300 text-gray-600 cursor-wait" : "bg-black text-white"
          }`}
        >
          {isSubmitting ? "저장 중..." : "입고 등록"}
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
                <th className="px-3 py-2 w-[120px]">주문일자</th>
                <th className="px-3 py-2 w-[150px]">SKU</th>
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2 w-[100px]">입고 수량</th>
                <th className="px-3 py-2 w-[130px]">총 단가</th>
                <th className="px-3 py-2 w-[120px]">개당 단가</th>
                <th className="px-3 py-2 w-[160px]">입고처</th>
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
                        placeholder="예: 20251025"
                        value={r.orderDate}
                        onChange={(e) => onCellChange(r.id, "orderDate", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        disabled={isSubmitting}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.sku}
                        onChange={(e) => onCellChange(r.id, "sku", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm"
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
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        inputMode="numeric"
                        value={r.qty}
                        onChange={(e) =>
                          onCellChange(r.id, "qty", e.target.value.replace(/[^\d]/g, ""))
                        }
                        className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                        disabled={isSubmitting}
                      />
                    </td>

                    {/* ✅ 총 단가: 표시값은 천단위 콤마 / 입력은 숫자만 */}
                    <td className="px-3 py-2">
                      <input
                        inputMode="numeric"
                        value={r.totalPrice === "" ? "" : fmt(toNumber(r.totalPrice))}
                        onChange={(e) =>
                          onCellChange(
                            r.id,
                            "totalPrice",
                            e.target.value.replace(/[^\d]/g, ""),
                          )
                        }
                        className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                        disabled={isSubmitting}
                      />
                    </td>

                    {/* ✅ 개당 단가: 원화 반올림 정수 + 천단위 콤마 */}
                    <td className="px-3 py-2">
                      <input
                        readOnly
                        value={r.unitPrice === "" ? "" : fmt(toNumber(r.unitPrice))}
                        className="w-full border rounded-lg px-2 py-1 text-sm text-right bg-gray-50"
                        disabled
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={r.supplier}
                        onChange={(e) => onCellChange(r.id, "supplier", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        disabled={isSubmitting}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t text-sm flex justify-end gap-8">
          <div>
            총 수량: <b>{fmt(summary.totalQty)}</b>
          </div>
          <div>
            총 금액: <b>{fmt(summary.totalPrice)}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
