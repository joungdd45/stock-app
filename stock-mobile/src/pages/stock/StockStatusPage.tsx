/* C:\dev\stock-mobile\src\pages\stock\StockStatusPage.tsx */
/**
 * 재고관리 > 재고현황 (디버그 포함)
 * - 스캔 페이지에서 저장한 barcode로 단건 조회
 * - apiHub 언랩 결과(res.data)를 그대로 사용
 * - 📌 요청 barcode / 응답 내용을 화면에 그대로 표시 (디버깅용)
 */

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine } from "lucide-react";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";
import { stockAdapter } from "../../api/adapters/stock.adapter";
import { handleError } from "../../utils/handleError";

interface StockRow {
  name: string;
  stock: number;
  free: number;
}

const STORAGE_KEY = "stock.scan.barcode";

type StoredBarcodePayload = {
  barcode: string;
  scannedAt?: string;
};

type ScanResultShape = {
  sku: string;
  name: string;
  current_qty: number;
  available_qty: number;
  last_price: number | null;
};

const StockStatusPage: React.FC = () => {
  const nav = useNavigate();

  const [items, setItems] = useState<StockRow[]>([]);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 🔎 디버그 표시용
  const [debugText, setDebugText] = useState<string>("");

  const scannedBarcode = useMemo(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    try {
      const parsed: StoredBarcodePayload = JSON.parse(stored);
      return String(parsed.barcode ?? "").trim() || null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    if (!scannedBarcode) {
      setItems([]);
      setLastBarcode(null);
      setDebugText("");
      return;
    }

    setLastBarcode(scannedBarcode);

    const run = async () => {
      if (loading) return;
      setLoading(true);

      try {
        const res = await stockAdapter.scanStatusByBarcode({
          barcode: scannedBarcode,
        });

        // 🔎 요청/응답을 그대로 화면에 표시
        setDebugText(
          `요청 barcode: ${scannedBarcode}\n` +
            (res.ok
              ? `응답 OK\nsku=${(res.data as any)?.sku ?? "-"}\nname=${(res.data as any)?.name ?? "-"}\ncurrent_qty=${(res.data as any)?.current_qty ?? "-"}\navailable_qty=${(res.data as any)?.available_qty ?? "-"}`
              : `응답 FAIL\ncode=${(res.error as any)?.code ?? "-"}\nmessage=${(res.error as any)?.message ?? "-"}`)
        );

        if (!res.ok) {
          handleError(res.error);
          setItems([]);
          return;
        }

        const found = res.data as ScanResultShape | null;

        if (!found || !String(found.name ?? "").trim()) {
          setItems([]);
          return;
        }

        setItems([
          {
            name: String(found.name),
            stock: Number(found.current_qty ?? 0),
            free: Number(found.available_qty ?? 0),
          },
        ]);
      } catch (e) {
        handleError(e);
        setItems([]);
        setDebugText(`예외 발생: ${String(e)}`);
      } finally {
        setLoading(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scannedBarcode]);

  return (
    <AppShell title="재고현황">
      <div className="space-y-3">
        <Card className="p-3">
          <div className="flex flex-col gap-2">
            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-sm font-medium disabled:opacity-60"
              style={{ backgroundColor: COLORS.main, color: "#FFFFFF" }}
              onClick={() => nav("/stock/scan-barcode")}
              disabled={loading}
            >
              <ScanLine size={18} color="#FFFFFF" />
              <span>바코드 스캔</span>
            </button>

            {lastBarcode && (
              <p className="text-[10px] text-center" style={{ color: COLORS.textGray }}>
                마지막 스캔값: {lastBarcode}
              </p>
            )}

            {/* 🔎 디버그 표시 */}
            {debugText && (
              <pre
                className="text-[10px] whitespace-pre-wrap rounded-md p-2"
                style={{ color: COLORS.textGray, background: "#f8fafc" }}
              >
                {debugText}
              </pre>
            )}
          </div>
        </Card>

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50" style={{ color: COLORS.textGray }}>
              <tr>
                <th className="py-2 px-3 text-left">상품명</th>
                <th className="py-2 px-3 text-center">재고수량</th>
                <th className="py-2 px-3 text-center">가용수량</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r, idx) => (
                <tr key={idx} className="border-t" style={{ borderColor: COLORS.line }}>
                  <td className="py-2 px-3">{r.name}</td>
                  <td className="py-2 px-3 text-center">{r.stock}</td>
                  <td className="py-2 px-3 text-center">{r.free}</td>
                </tr>
              ))}

              {items.length === 0 && !loading && (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-xs" style={{ color: "#94A3B8" }}>
                    {lastBarcode
                      ? "해당 바코드로 상품을 찾지 못했어요"
                      : "바코드를 스캔해서 재고를 조회해 주세요"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </AppShell>
  );
};

export default StockStatusPage;
