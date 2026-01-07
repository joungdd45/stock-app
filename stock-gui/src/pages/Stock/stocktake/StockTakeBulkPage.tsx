/* src/pages/stock/stocktake/StockTakeBulkPage.tsx
   ✅ 재고관리 > 재고실사(PC 대량등록) - 실사용 버전 초안
   핵심 정책:
   - 저장/처리 키는 SKU + 실사수량(qty)만 사용
   - 상품명(name)은 "표시/편의" 용도(선택/입력)로만 사용하고 서버로 보내지 않음

   기능:
   - 템플릿 다운로드
   - xlsx 업로드(헤더 자동탐색)
   - 복사/붙여넣기(탭/콤마 기반 간단 파싱)
   - 행 추가/선택 삭제/초기화
   - 등록 버튼 클릭 시 "한 번에" payload 전송

   ⚠️ API 연결:
   - 아래 stockAdapter.stocktakeBulkConfirm(...)만 네 프로젝트 실제 엔드포인트/어댑터로 연결하면 바로 사용 가능
*/

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { handleError } from "@/utils/handleError";
// ✅ 너 프로젝트에 맞게 교체해서 쓰면 됨
import { stockAdapter } from "@/api/adapters/stock.adapter";

type RowItem = {
  id: string;
  sku: string;
  name: string; // 표시용
  qty: number | ""; // 실사수량
};

const uuid = () => Math.random().toString(36).slice(2, 10);
const stripComma = (s: string) => s.replace(/[, ]+/g, "");
const toInt = (v: number | string | ""): number => {
  if (v === "" || v === undefined || v === null) return 0;
  const raw = typeof v === "string" ? stripComma(v) : v;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
};
const fmt = (n: number | "") =>
  n === "" ? "" : new Intl.NumberFormat().format(n as number);

const makeEmptyRow = (): RowItem => ({
  id: uuid(),
  sku: "",
  name: "",
  qty: "",
});

const isEmptyRow = (r: RowItem) => !r.sku && !r.name && (r.qty === "" || toInt(r.qty) === 0);

/* ─────────────────────────────────────────────
 * 템플릿 다운로드(파일명 자동 증가)
 * ───────────────────────────────────────────── */

const BULK_TEMPLATE_URL = "/templates/재고실사대량등록_양식.xlsx";
const BULK_TEMPLATE_BASENAME = "재고실사대량등록_양식";

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
  const seq = nextSeqForToday("stocktake_bulk_template_seq");
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
 * 엑셀 파싱 (헤더 자동 탐색)
 * - 확정 헤더(추천):
 *   SKU | 상품명 | 수량
 * - 변형 허용:
 *   실사수량, 재고수량, qty 등
 * ───────────────────────────────────────────── */

const norm = (v: any) =>
  String(v ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "");

const headerKey = (h: string) => {
  const x = norm(h);

  if (x === "sku") return "sku";
  if (x === "상품명") return "name";
  if (x === "수량") return "qty";

  if (x.includes("상품") && x.includes("명")) return "name";
  if (x.includes("실사") && x.includes("수량")) return "qty";
  if (x.includes("재고") && x.includes("수량")) return "qty";
  if (x === "qty") return "qty";

  return "";
};

type BulkItem = { sku: string; name?: string; qty: number };

async function parseXlsxFileToBulkItems(file: File): Promise<BulkItem[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return [];

  const ws = wb.Sheets[wsName];
  const table: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!table || table.length < 2) return [];

  const requiredKeys = ["sku", "qty"];

  let headerRowIndex = -1;
  let idx: Record<string, number> = {};

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
    throw new Error("엑셀 헤더를 인식하지 못했어요. (SKU / 수량 헤더가 있는지 확인해줘)");
  }

  const out: BulkItem[] = [];

  for (let r = headerRowIndex + 1; r < table.length; r++) {
    const row = table[r] || [];
    const hasAny = row.some((v) => String(v ?? "").trim() !== "");
    if (!hasAny) continue;

    const sku = String(row[idx["sku"]] ?? "").trim();
    const name = idx["name"] !== undefined ? String(row[idx["name"]] ?? "").trim() : "";
    const qty = toInt(String(row[idx["qty"]] ?? ""));

    if (!sku && !name && qty === 0) continue;
    if (!sku) continue; // SKU 없으면 스킵

    out.push({ sku, name, qty });
  }

  return out;
}

/* ─────────────────────────────────────────────
 * 복사/붙여넣기 파서
 * - 헤더가 있으면 자동 인식
 * - 헤더가 없으면: 1열=SKU, 2열=수량, 3열=상품명(있으면)
 * ───────────────────────────────────────────── */

function parseClipboardText(text: string): BulkItem[] {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const splitLine = (l: string) => {
    // 탭 우선, 없으면 콤마
    if (l.includes("\t")) return l.split("\t").map((x) => x.trim());
    if (l.includes(",")) return l.split(",").map((x) => x.trim());
    return [l.trim()];
  };

  const first = splitLine(lines[0]);
  const firstKeys = first.map((c) => headerKey(c)).filter(Boolean);

  let startIdx = 0;
  let map: Record<string, number> = {};

  // 헤더로 판단(최소 sku/qty 둘 중 하나라도 잡히면 헤더 가능성)
  if (firstKeys.length > 0) {
    first.forEach((c, i) => {
      const k = headerKey(c);
      if (k) map[k] = i;
    });
    startIdx = 1;
  }

  const out: BulkItem[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const cols = splitLine(lines[i]);

    let sku = "";
    let qty = 0;
    let name = "";

    if (startIdx === 1) {
      sku = String(cols[map["sku"]] ?? "").trim();
      qty = toInt(String(cols[map["qty"]] ?? ""));
      if (map["name"] !== undefined) name = String(cols[map["name"]] ?? "").trim();
    } else {
      // 헤더 없으면 기본 규칙
      sku = String(cols[0] ?? "").trim();
      qty = toInt(String(cols[1] ?? ""));
      name = String(cols[2] ?? "").trim();
    }

    if (!sku) continue;
    out.push({ sku, qty, name });
  }

  return out;
}

export default function StockTakeBulkPage() {
  const [rows, setRows] = useState<RowItem[]>([makeEmptyRow()]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const addRow = () => setRows((prev) => [...prev, makeEmptyRow()]);

  const clearAll = () => {
    setRows([makeEmptyRow()]);
    setChecked(new Set());
    setPasteText("");
  };

  const deleteSelected = () => {
    setRows((prev) => prev.filter((r) => !checked.has(r.id)));
    setChecked(new Set());
  };

  const onCellChange = (
    id: string,
    field: keyof Pick<RowItem, "sku" | "name" | "qty">,
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        const next: RowItem = { ...r, [field]: value as any };
        if (field === "qty") next.qty = value === "" ? "" : toInt(value);
        return next;
      }),
    );
  };

  const applyBulkItemsToRows = async (items: BulkItem[]) => {
    if (!items || items.length === 0) return;

    const mapped: RowItem[] = items.map((it) => ({
      id: uuid(),
      sku: it.sku ?? "",
      name: it.name ?? "",
      qty: typeof it.qty === "number" ? it.qty : toInt(String(it.qty)),
    }));

    setRows((prev) => {
      const prevAllEmpty = prev.length > 0 && prev.every((r) => isEmptyRow(r));
      return prevAllEmpty ? mapped : [...prev, ...mapped];
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
    const totalQty = rows.reduce((acc, r) => acc + toInt(r.qty), 0);
    return { totalQty, rowCount: rows.filter((r) => !isEmptyRow(r)).length };
  }, [rows]);

  const validate = (items: RowItem[]) => {
    const invalid = items.filter((r) => {
      const skuOk = !!r.sku?.trim();
      const qtyOk = r.qty !== "" && toInt(r.qty) >= 0; // 0도 허용(실사 0 가능)
      return !skuOk || !qtyOk;
    });
    return { ok: invalid.length === 0, invalid };
  };

  const onSubmit = async () => {
    const nonEmpty = rows.filter((r) => !isEmptyRow(r));
    if (nonEmpty.length === 0) {
      alert("저장할 데이터가 없습니다.");
      return;
    }

    const { ok, invalid } = validate(nonEmpty);
    if (!ok) {
      const first = invalid[0];
      alert(`필수값이 비어있거나 잘못된 행이 있습니다.\nSKU, 수량을 확인해주세요.\n문제 행 SKU: ${first.sku || "(빈 값)"}`);
      return;
    }

    // ✅ 서버로는 SKU/수량만 보낸다(상품명은 UI 표시용)
    const payload = {
      items: nonEmpty.map((r) => ({
        sku: r.sku.trim(),
        qty: toInt(r.qty),
      })),
    };

    try {
      setIsSubmitting(true);

      // ✅ 여기만 네 실제 API에 맞게 연결하면 끝
      // 예: POST /api/stocktake/bulk/confirm
      const res = await stockAdapter.stocktakeBulkConfirm(payload);
      if (!res.ok) return handleError(res.error);

      alert("재고실사 등록이 완료됐어요.");
      clearAll();
    } catch (err) {
      console.error(err);
      handleError(err as any);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onApplyPaste = async () => {
    try {
      const items = parseClipboardText(pasteText);
      await applyBulkItemsToRows(items);
      setPasteText("");
      setPasteOpen(false);
    } catch (err) {
      handleError(err as any);
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* 액션바 */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onDownloadTemplate}
          disabled={isSubmitting}
          className="px-3 py-2 rounded-lg border text-sm"
        >
          대량등록 템플릿
        </button>

        <input
          id="stocktake-bulk-file"
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={onChangeBulkFile}
          disabled={isSubmitting}
        />
        <label
          htmlFor="stocktake-bulk-file"
          className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${
            isSubmitting ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title="xlsx 양식 파일을 선택해 업로드하면 행이 자동으로 채워집니다."
        >
          엑셀 대량등록
        </label>

        <button
          onClick={() => setPasteOpen(true)}
          disabled={isSubmitting}
          className="px-3 py-2 rounded-lg border text-sm"
        >
          복사/붙여넣기
        </button>

        <button onClick={addRow} disabled={isSubmitting} className="px-3 py-2 rounded-lg border text-sm">
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

        <button onClick={clearAll} disabled={isSubmitting} className="px-3 py-2 rounded-lg border text-sm">
          초기화
        </button>

        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
            isSubmitting ? "bg-gray-300 text-gray-600 cursor-wait" : "bg-black text-white"
          }`}
        >
          {isSubmitting ? "저장 중..." : "재고실사 등록"}
        </button>
      </div>

      {/* 붙여넣기 패널(간단 모달) */}
      {pasteOpen && (
        <div className="fixed inset-0 z-[9999] bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl rounded-xl bg-white border shadow-lg p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <div className="font-semibold">복사/붙여넣기</div>
              <button className="px-2 py-1 rounded border text-sm" onClick={() => setPasteOpen(false)}>
                닫기
              </button>
            </div>

            <div className="text-sm text-gray-600">
              - 헤더가 있으면 자동 인식: <b>SKU / 상품명 / 수량</b>
              <br />- 헤더가 없으면: <b>1열=SKU, 2열=수량, 3열=상품명(선택)</b>
            </div>

            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`예)\nSKU\t수량\t상품명\nABC-001\t10\t샘플상품\nABC-002\t0\t(품절)\n\n또는(헤더 없이)\nABC-001\t10\nABC-002\t0`}
              className="w-full h-[260px] border rounded-lg p-3 text-sm"
            />

            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 rounded-lg border text-sm" onClick={() => setPasteText("")}>
                비우기
              </button>
              <button className="px-3 py-2 rounded-lg border text-sm font-semibold bg-black text-white" onClick={onApplyPaste}>
                적용(행 추가)
              </button>
            </div>
          </div>
        </div>
      )}

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
                <th className="px-3 py-2 w-[180px]">SKU</th>
                <th className="px-3 py-2">상품명 (표시용)</th>
                <th className="px-3 py-2 w-[140px] text-right">실사 수량</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center text-sm text-gray-500 py-8">
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
                        placeholder="(선택) 보기 편하게만 적어도 됨"
                        disabled={isSubmitting}
                      />
                    </td>

                    <td className="px-3 py-2">
                      <input
                        inputMode="numeric"
                        value={r.qty === "" ? "" : fmt(toInt(r.qty))}
                        onChange={(e) => onCellChange(r.id, "qty", e.target.value.replace(/[^\d]/g, ""))}
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

        <div className="px-4 py-3 border-t text-sm flex justify-end gap-8">
          <div>
            행 수: <b>{fmt(summary.rowCount)}</b>
          </div>
          <div>
            총 실사수량 합: <b>{fmt(summary.totalQty)}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
