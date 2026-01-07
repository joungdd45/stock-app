/* src/pages/stock/barcode/StockBarcodeBulkPage.tsx
   ✅ 재고관리 > 바코드 등록(대량)

   목적:
   - SKU ↔ BARCODE 매핑을 빠르게 대량 등록
   - 재고/원장/실사와 완전히 분리

   핵심 정책:
   - 입력: SKU + BARCODE (+ 상품명은 표시용)
   - 페이지에서는 DB 작업 없음
   - "등록" 클릭 시 → 한 줄씩 서버로 전송
   - 서버 API: POST /api/inbound/process/register-barcode
     - stockAdapter.registerBarcodeForSku({ sku, barcode, name }) 사용
     - name은 서버가 무시해도 되고(표시용), 보내도 무방(서버 스펙에 맞춰 adapter에서 정리)

   기능:
   - 템플릿 다운로드(파일명 자동 증가)
   - xlsx 업로드(헤더 자동탐색)
   - 복사/붙여넣기(탭/콤마 파싱)
   - 행 추가/선택 삭제/초기화
   - 등록: 한 줄씩 전송 + 진행률 + 실패 목록 표시 + 실패만 재시도
*/

import React, { useMemo, useState } from "react";
import * as XLSX from "xlsx";

import { handleError } from "@/utils/handleError";
import { stockAdapter } from "@/api/adapters/stock.adapter";

type RowItem = {
  id: string;
  sku: string;
  barcode: string;
  name: string; // 표시용(선택)
};

type FailItem = {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  reason: string;
};

const uuid = () => Math.random().toString(36).slice(2, 10);
const strip = (s: string) => String(s ?? "").trim();

const makeEmptyRow = (): RowItem => ({
  id: uuid(),
  sku: "",
  barcode: "",
  name: "",
});

const isEmptyRow = (r: RowItem) => !strip(r.sku) && !strip(r.barcode) && !strip(r.name);

/* ─────────────────────────────────────────────
 * 템플릿 다운로드(파일명 자동 증가)
 * ───────────────────────────────────────────── */

const BULK_TEMPLATE_URL = "/templates/바코드대량등록_양식.xlsx";
const BULK_TEMPLATE_BASENAME = "바코드대량등록_양식";

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
  const seq = nextSeqForToday("barcode_bulk_template_seq");
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
 *   SKU | 바코드 | 상품명
 * - 변형 허용:
 *   barcode, 바코드번호, code 등
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
  if (x === "바코드") return "barcode";
  if (x === "barcode") return "barcode";
  if (x.includes("바코드")) return "barcode";
  if (x.includes("code") && !x.includes("zip")) return "barcode";

  if (x === "상품명") return "name";
  if (x.includes("상품") && x.includes("명")) return "name";

  return "";
};

type BulkItem = { sku: string; barcode: string; name?: string };

async function parseXlsxFileToBulkItems(file: File): Promise<BulkItem[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const wsName = wb.SheetNames[0];
  if (!wsName) return [];

  const ws = wb.Sheets[wsName];
  const table: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true });
  if (!table || table.length < 2) return [];

  const requiredKeys = ["sku", "barcode"];

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
    throw new Error("엑셀 헤더를 인식하지 못했어요. (SKU / 바코드 헤더가 있는지 확인해줘)");
  }

  const out: BulkItem[] = [];

  for (let r = headerRowIndex + 1; r < table.length; r++) {
    const row = table[r] || [];
    const hasAny = row.some((v) => String(v ?? "").trim() !== "");
    if (!hasAny) continue;

    const sku = strip(row[idx["sku"]]);
    const barcode = strip(row[idx["barcode"]]);
    const name = idx["name"] !== undefined ? strip(row[idx["name"]]) : "";

    if (!sku || !barcode) continue;
    out.push({ sku, barcode, name });
  }

  return out;
}

/* ─────────────────────────────────────────────
 * 복사/붙여넣기 파서
 * - 헤더가 있으면 자동 인식
 * - 헤더가 없으면: 1열=SKU, 2열=BARCODE, 3열=NAME(선택)
 * ───────────────────────────────────────────── */

function parseClipboardText(text: string): BulkItem[] {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const splitLine = (l: string) => {
    if (l.includes("\t")) return l.split("\t").map((x) => x.trim());
    if (l.includes(",")) return l.split(",").map((x) => x.trim());
    return [l.trim()];
  };

  const first = splitLine(lines[0]);
  const firstKeys = first.map((c) => headerKey(c)).filter(Boolean);

  let startIdx = 0;
  let map: Record<string, number> = {};

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
    let barcode = "";
    let name = "";

    if (startIdx === 1) {
      sku = strip(cols[map["sku"]]);
      barcode = strip(cols[map["barcode"]]);
      if (map["name"] !== undefined) name = strip(cols[map["name"]]);
    } else {
      sku = strip(cols[0]);
      barcode = strip(cols[1]);
      name = strip(cols[2]);
    }

    if (!sku || !barcode) continue;
    out.push({ sku, barcode, name });
  }

  return out;
}

export default function StockBarcodeBulkPage() {
  const [rows, setRows] = useState<RowItem[]>([makeEmptyRow()]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");

  const [progress, setProgress] = useState({ total: 0, done: 0, ok: 0, fail: 0 });
  const [fails, setFails] = useState<FailItem[]>([]);

  const addRow = () => setRows((prev) => [...prev, makeEmptyRow()]);

  const clearAll = () => {
    setRows([makeEmptyRow()]);
    setChecked(new Set());
    setPasteText("");
    setProgress({ total: 0, done: 0, ok: 0, fail: 0 });
    setFails([]);
  };

  const deleteSelected = () => {
    setRows((prev) => prev.filter((r) => !checked.has(r.id)));
    setChecked(new Set());
  };

  const onCellChange = (id: string, field: keyof Pick<RowItem, "sku" | "barcode" | "name">, value: string) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.id !== id) return r;
        return { ...r, [field]: value };
      }),
    );
  };

  const applyBulkItemsToRows = async (items: BulkItem[]) => {
    if (!items || items.length === 0) return;

    const mapped: RowItem[] = items.map((it) => ({
      id: uuid(),
      sku: it.sku ?? "",
      barcode: it.barcode ?? "",
      name: it.name ?? "",
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
    const rowCount = rows.filter((r) => !isEmptyRow(r)).length;
    const selectedCount = checked.size;
    return { rowCount, selectedCount };
  }, [rows, checked]);

  const validate = (items: RowItem[]) => {
    const invalid = items.filter((r) => !strip(r.sku) || !strip(r.barcode));
    return { ok: invalid.length === 0, invalid };
  };

  const submitItems = async (items: RowItem[]) => {
    setFails([]);
    setProgress({ total: items.length, done: 0, ok: 0, fail: 0 });

    let okCnt = 0;
    let failCnt = 0;
    const failList: FailItem[] = [];

    for (let i = 0; i < items.length; i++) {
      const r = items[i];

      try {
        const res = await stockAdapter.registerBarcodeForSku({
          sku: strip(r.sku),
          barcode: strip(r.barcode),
          name: strip(r.name), // 표시용(서버에서 무시해도 됨)
        });

        if (!res.ok) {
          failCnt += 1;
          failList.push({
            id: r.id,
            sku: r.sku,
            barcode: r.barcode,
            name: r.name,
            reason: String(res.error?.message ?? "등록 실패"),
          });
        } else {
          okCnt += 1;
        }
      } catch (err: any) {
        failCnt += 1;
        failList.push({
          id: r.id,
          sku: r.sku,
          barcode: r.barcode,
          name: r.name,
          reason: String(err?.message ?? "등록 실패"),
        });
      } finally {
        setProgress((p) => ({
          total: p.total,
          done: i + 1,
          ok: okCnt,
          fail: failCnt,
        }));
      }
    }

    setFails(failList);

    if (failList.length === 0) {
      alert("바코드 등록이 완료됐어요.");
      clearAll();
      return;
    }

    alert(`일부 실패가 있어요.\n성공: ${okCnt}건 / 실패: ${failCnt}건\n아래 실패 목록을 확인해줘.`);
  };

  const onSubmitAll = async () => {
    const nonEmpty = rows.filter((r) => !isEmptyRow(r));
    if (nonEmpty.length === 0) return alert("저장할 데이터가 없습니다.");

    const { ok, invalid } = validate(nonEmpty);
    if (!ok) {
      const first = invalid[0];
      return alert(
        `필수값이 비어있는 행이 있습니다.\nSKU, 바코드를 확인해주세요.\n문제 행: SKU=${first.sku || "(빈 값)"} / BARCODE=${first.barcode || "(빈 값)"}`
      );
    }

    try {
      setIsSubmitting(true);
      await submitItems(nonEmpty);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRetryFailsOnly = async () => {
    if (fails.length === 0) return;
    const retry = rows.filter((r) => fails.some((f) => f.id === r.id));

    const { ok, invalid } = validate(retry);
    if (!ok) {
      const first = invalid[0];
      return alert(
        `재시도 대상 중 필수값이 비어있는 행이 있습니다.\nSKU, 바코드를 확인해주세요.\n문제 행: SKU=${first.sku || "(빈 값)"} / BARCODE=${first.barcode || "(빈 값)"}`
      );
    }

    try {
      setIsSubmitting(true);
      await submitItems(retry);
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

  const progressPct = useMemo(() => {
    if (progress.total <= 0) return 0;
    return Math.round((progress.done / progress.total) * 100);
  }, [progress]);

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* 액션바 */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={onDownloadTemplate} disabled={isSubmitting} className="px-3 py-2 rounded-lg border text-sm">
          대량등록 템플릿
        </button>

        <input
          id="barcode-bulk-file"
          type="file"
          accept=".xlsx"
          className="hidden"
          onChange={onChangeBulkFile}
          disabled={isSubmitting}
        />
        <label
          htmlFor="barcode-bulk-file"
          className={`px-3 py-2 rounded-lg border text-sm cursor-pointer ${
            isSubmitting ? "opacity-50 cursor-not-allowed" : ""
          }`}
          title="xlsx 양식 파일을 선택해 업로드하면 행이 자동으로 채워집니다."
        >
          엑셀 대량등록
        </label>

        <button onClick={() => setPasteOpen(true)} disabled={isSubmitting} className="px-3 py-2 rounded-lg border text-sm">
          복사/붙여넣기
        </button>

        <button onClick={addRow} disabled={isSubmitting} className="px-3 py-2 rounded-lg border text-sm">
          행 추가
        </button>

        <button
          onClick={deleteSelected}
          disabled={checked.size === 0 || isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm ${
            checked.size === 0 || isSubmitting ? "opacity-50 cursor-not-allowed" : "text-red-600 border-red-600"
          }`}
        >
          선택 삭제
        </button>

        <button onClick={clearAll} disabled={isSubmitting} className="px-3 py-2 rounded-lg border text-sm">
          초기화
        </button>

        <button
          onClick={onSubmitAll}
          disabled={isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
            isSubmitting ? "bg-gray-300 text-gray-600 cursor-wait" : "bg-black text-white"
          }`}
        >
          {isSubmitting ? "등록 중..." : "바코드 등록"}
        </button>
      </div>

      {/* 진행률/재시도 */}
      {(progress.total > 0 || fails.length > 0) && (
        <div className="rounded-xl border bg-white shadow-sm px-4 py-3 text-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>진행률: <b>{progress.done}</b> / <b>{progress.total}</b> ({progressPct}%)</div>
            <div>성공: <b>{progress.ok}</b></div>
            <div className={progress.fail > 0 ? "text-red-600" : ""}>실패: <b>{progress.fail}</b></div>
          </div>

          <button
            onClick={onRetryFailsOnly}
            disabled={isSubmitting || fails.length === 0}
            className={`px-3 py-2 rounded-lg border text-sm ${
              isSubmitting || fails.length === 0 ? "opacity-50 cursor-not-allowed" : ""
            }`}
            title="실패한 행만 다시 전송합니다."
          >
            실패만 재시도
          </button>
        </div>
      )}

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
              - 헤더가 있으면 자동 인식: <b>SKU / 바코드 / 상품명</b>
              <br />- 헤더가 없으면: <b>1열=SKU, 2열=BARCODE, 3열=상품명(선택)</b>
            </div>

            <textarea
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
              placeholder={`예)\nSKU\t바코드\t상품명\nABC-001\t8801234567890\t샘플상품\nABC-002\t8800000000000\t(선택)\n\n또는(헤더 없이)\nABC-001\t8801234567890\nABC-002\t8800000000000`}
              className="w-full h-[260px] border rounded-lg p-3 text-sm"
            />

            <div className="flex justify-end gap-2">
              <button className="px-3 py-2 rounded-lg border text-sm" onClick={() => setPasteText("")}>
                비우기
              </button>
              <button
                className="px-3 py-2 rounded-lg border text-sm font-semibold bg-black text-white"
                onClick={onApplyPaste}
              >
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
                <th className="px-3 py-2 w-[220px]">SKU</th>
                <th className="px-3 py-2 w-[240px]">바코드</th>
                <th className="px-3 py-2">상품명 (표시용)</th>
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
                        value={r.barcode}
                        onChange={(e) => onCellChange(r.id, "barcode", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm"
                        placeholder="예: 8801234567890"
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
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t text-sm flex justify-end gap-8">
          <div>
            행 수: <b>{summary.rowCount}</b>
          </div>
          <div>
            선택: <b>{summary.selectedCount}</b>
          </div>
        </div>
      </div>

      {/* 실패 목록 */}
      {fails.length > 0 && (
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="px-4 py-3 border-b font-semibold text-sm text-red-600">실패 목록</div>
          <div className="overflow-auto">
            <table className="min-w-full table-auto">
              <thead>
                <tr className="text-left text-sm text-gray-600 border-b">
                  <th className="px-3 py-2 w-[220px]">SKU</th>
                  <th className="px-3 py-2 w-[240px]">바코드</th>
                  <th className="px-3 py-2">사유</th>
                </tr>
              </thead>
              <tbody>
                {fails.map((f) => (
                  <tr key={f.id} className="border-b last:border-0">
                    <td className="px-3 py-2 text-sm">{f.sku}</td>
                    <td className="px-3 py-2 text-sm">{f.barcode}</td>
                    <td className="px-3 py-2 text-sm text-red-600">{f.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
