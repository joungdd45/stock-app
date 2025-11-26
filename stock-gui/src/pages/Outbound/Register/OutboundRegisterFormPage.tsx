/* src/pages/outbound/Register/RegisterFormPage.tsx
   ✅ 출고등록 > 등록 탭 (테이블 입력 + 붙여넣기 + 검증 + API 저장)
   - 붙여넣기 파서: 컨테이너 포커스 후 Ctrl+V
   - 체크박스 선택삭제
   - 검증 후 POST /api/outbound/requests
   - 저장중 버튼 비활성화, 성공 시 초기화
*/
import React, { useEffect, useMemo, useRef, useState } from "react";

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

const API_ENDPOINT = "/api/outbound/requests";

const uuid = () => Math.random().toString(36).slice(2, 10);
const stripComma = (s: string) => s.replace(/[, ]+/g, "");
const toNumber = (v: number | string | ""): number => {
  if (v === "" || v === undefined || v === null) return 0;
  const raw = typeof v === "string" ? stripComma(v) : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
};
const fmt = (n: number | "") => (n === "" ? "" : new Intl.NumberFormat().format(n as number));

const splitLine = (line: string): string[] => {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(",")) return line.split(",");
  return line.trim().split(/\s+/);
};

const isHeaderLine = (cells: string[]) => {
  if (cells.length === 0) return false;
  const first = cells[0]?.trim().toLowerCase();
  // "국가" 또는 "country"가 첫 셀인 경우 헤더로 판단
  return first === "국가" || first === "country";
};

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
  !r.country && !r.orderNo && !r.trackingNo && !r.sku && !r.name && !r.quantity && !r.totalPrice;

// SKU → 상품명 자동채움(mock)
const PRODUCTS_CACHE: Record<string, string> = {
  FD_SAMY_BULDAKSA02_0200: "불닭사리 200g",
  FD_DSFS_MAXIMKAN05_MILDLOS030: "맥심 모카라떼 30T",
  FD_LOTTE_CHOCO_PIE12: "초코파이 12입",
  FD_SAMLIP_MINI_YAKGWA: "삼립 미니약과",
  FD_OTTOGI_JINRAMEN_MILD5: "진라면 순한맛 5입",
};
async function fetchProductNameMock(sku: string): Promise<string | null> {
  await new Promise((r) => setTimeout(r, 120));
  return PRODUCTS_CACHE[sku] ?? null;
}
function useProductName() {
  const inFlight = React.useRef<Record<string, Promise<string | null>>>({});
  const getName = async (sku: string): Promise<string | null> => {
    if (!sku) return null;
    if (PRODUCTS_CACHE[sku]) return PRODUCTS_CACHE[sku];
    if (!inFlight.current[sku]) {
      inFlight.current[sku] = fetchProductNameMock(sku).finally(() => delete inFlight.current[sku]);
    }
    const name = await inFlight.current[sku];
    if (name) PRODUCTS_CACHE[sku] = name;
    return name;
  };
  return { getName };
}

export default function RegisterFormPage() {
  const { getName } = useProductName();
  const [rows, setRows] = useState<RowItem[]>([makeEmptyRow()]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);

  const pasteTargetRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    pasteTargetRef.current?.focus();
  }, []);

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
    field: keyof Pick<RowItem, "country" | "orderNo" | "trackingNo" | "sku" | "name" | "quantity" | "totalPrice">,
    value: string
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
          : r
      )
    );

    // SKU 자동 상품명
    if (field === "sku" && value) {
      const name = await getName(value.trim());
      if (name) {
        setRows((prev) =>
          prev.map((r) => (r.id === id && (!r.name || r.name.trim() === "") ? { ...r, name } : r))
        );
      }
    }
  };

  // 붙여넣기: 완전 빈 상태면 대체, 아니면 이어붙이기
  const handlePaste = async (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData("text/plain") ?? "";
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return;

    const firstCells = splitLine(lines[0]).map((c) => c.trim());
    const startIdx = isHeaderLine(firstCells) ? 1 : 0;

    const parsed: RowItem[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const cells = splitLine(lines[i]).map((c) => c.trim());
      const [
        country = "",
        orderNo = "",
        trackingNo = "",
        sku = "",
        name = "",
        quantityStr = "",
        totalPriceStr = "",
      ] = cells;

      if ([country, orderNo, trackingNo, sku, name, quantityStr, totalPriceStr].every((v) => v === "")) continue;

      parsed.push({
        id: uuid(),
        country,
        orderNo,
        trackingNo,
        sku,
        name,
        quantity: toNumber(quantityStr) || "",
        totalPrice: toNumber(totalPriceStr) || "",
      });
    }
    if (parsed.length === 0) return;

    const withNames = await Promise.all(
      parsed.map(async (r) => {
        if (!r.sku || r.name?.trim()) return r;
        const name = await getName(r.sku.trim());
        return name ? { ...r, name } : r;
      })
    );

    setRows((prev) => {
      const prevAllEmpty = prev.length > 0 && prev.every((r) => isEmptyRow(r));
      return prevAllEmpty ? withNames : [...prev, ...withNames];
    });
    setChecked(new Set());
  };

  // 합계: 총 수량만 사용
  const totalQty = useMemo(
    () => rows.reduce((acc, r) => acc + toNumber(r.quantity), 0),
    [rows]
  );

  // 간단 검증
  const validate = (items: RowItem[]) => {
    const invalid = items.filter((r) => {
      const qty = toNumber(r.quantity);
      const total = toNumber(r.totalPrice);
      return !r.country?.trim() || !r.orderNo?.trim() || !r.sku?.trim() || qty <= 0 || total < 0;
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
        `필수값이 비어있거나 잘못된 행이 있습니다.\n국가, 주문번호, SKU, 출고수량, 총 가격을 확인해주세요.\n문제 행 SKU: ${first.sku || "(빈 값)"}`
      );
      return;
    }

    const payload = {
      items: rows.map((r) => ({
        country: r.country.trim(),
        order_no: r.orderNo.trim(),
        tracking_no: r.trackingNo.trim(),
        sku: r.sku.trim(),
        name: r.name.trim(),
        quantity: toNumber(r.quantity),
        total_price: toNumber(r.totalPrice),
      })),
    };

    try {
      setIsSubmitting(true);
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const msg = await res.text().catch(() => "");
        throw new Error(msg || `HTTP ${res.status}`);
      }
      alert("출고 등록이 완료됐어요.");
      clearAll();
    } catch (err: any) {
      console.error(err);
      alert(`저장 중 오류가 발생했어요.\n사유: ${String(err?.message || err)}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col gap-4">
      {/* 액션바 */}
      <div className="flex items-center justify-end gap-2">
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
        <button onClick={clearAll} disabled={isSubmitting} className="px-3 py-2 rounded-lg border text-sm">
          초기화
        </button>
        <button
          onClick={onSubmitRegister}
          disabled={isSubmitting}
          className={`px-3 py-2 rounded-lg border text-sm font-semibold ${
            isSubmitting ? "bg-gray-300 text-gray-600 cursor-wait" : "bg-black text-white"
          }`}
        >
          {isSubmitting ? "저장 중..." : "출고 등록"}
        </button>
      </div>

      {/* 테이블 + 붙여넣기 컨테이너 */}
      <div
        ref={pasteTargetRef}
        tabIndex={0}
        onPaste={handlePaste}
        className="rounded-xl border bg-white shadow-sm outline-none"
        title="여기를 클릭해 포커스 후 Ctrl+V로 붙여넣으세요."
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
                <th className="px-3 py-2">상품명</th>
                <th className="px-3 py-2 w-[110px]">출고수량</th>
                <th className="px-3 py-2 w-[140px]">총 가격</th>
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
                        onChange={(e) => onCellChange(r.id, "trackingNo", e.target.value)}
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
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        inputMode="numeric"
                        value={r.quantity}
                        onChange={(e) => onCellChange(r.id, "quantity", e.target.value)}
                        className="w-full border rounded-lg px-2 py-1 text-sm text-right"
                        disabled={isSubmitting}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        inputMode="decimal"
                        value={r.totalPrice}
                        onChange={(e) => onCellChange(r.id, "totalPrice", e.target.value)}
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

        {/* 합계: 총 수량만 표시 */}
        <div className="px-4 py-3 border-t text-sm flex justify-end">
          <div>
            총 수량: <b>{fmt(totalQty)}</b>
          </div>
        </div>
      </div>
    </div>
  );
}
