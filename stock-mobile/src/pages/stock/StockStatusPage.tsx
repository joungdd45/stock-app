/* C:\dev\stock-mobile\src\pages\stock\StockStatusPage.tsx */
/**
 * 재고관리 > 재고현황
 *  - 바코드 스캔 버튼으로 이동
 *  - 바코드 스캔 결과(sessionStorage)로 단건 조회 (현재: barcode만 읽어 표시)
 *  - 다음 단계: stockAdapter.status(barcode) 연동해서 name/stock/free 표시
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ScanLine } from "lucide-react";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";

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

const StockStatusPage: React.FC = () => {
  const nav = useNavigate();
  const [items, setItems] = useState<StockRow[]>([]);
  const [lastBarcode, setLastBarcode] = useState<string | null>(null);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) {
      setItems([]);
      setLastBarcode(null);
      return;
    }

    try {
      const parsed: StoredBarcodePayload = JSON.parse(stored);
      const barcode = String(parsed?.barcode ?? "").trim();

      if (!barcode) {
        setItems([]);
        setLastBarcode(null);
        return;
      }

      setLastBarcode(barcode);

      // ✅ 현재 단계: API 연동 전이므로, 스캔값이 제대로 넘어왔는지 확인용 임시 표시
      // 다음 단계에서 stockAdapter.status(barcode)로 name/stock/free를 받아와서 setItems로 교체한다.
      setItems([
        {
          name: `스캔 바코드: ${barcode}`,
          stock: 0,
          free: 0,
        },
      ]);
    } catch {
      setItems([]);
      setLastBarcode(null);
    }
  }, []);

  return (
    <AppShell title="재고현황">
      <div className="space-y-3">
        {/* 상단: 바코드 스캔 버튼 + 설명 */}
        <Card className="p-3">
          <div className="flex flex-col gap-2">
            <button
              className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-2xl text-sm font-medium"
              style={{
                backgroundColor: COLORS.main,
                color: "#FFFFFF",
              }}
              onClick={() => nav("/stock/scan-barcode")}
            >
              <ScanLine size={18} color="#FFFFFF" />
              <span>바코드 스캔</span>
            </button>

            <p className="text-xs text-center" style={{ color: COLORS.textGray }}>
              바코드를 스캔하면 해당 상품의 재고현황이 아래에 표시됩니다.
            </p>

            {lastBarcode && (
              <p className="text-[10px] text-center" style={{ color: COLORS.textGray }}>
                마지막 스캔값: {lastBarcode}
              </p>
            )}
          </div>
        </Card>

        {/* 하단: 재고 리스트 */}
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
                <tr
                  key={idx}
                  className="border-t"
                  style={{ borderColor: COLORS.line }}
                >
                  <td className="py-2 px-3">{r.name}</td>
                  <td className="py-2 px-3 text-center">{r.stock}</td>
                  <td className="py-2 px-3 text-center">{r.free}</td>
                </tr>
              ))}

              {items.length === 0 && (
                <tr>
                  <td
                    colSpan={3}
                    className="py-6 text-center text-xs"
                    style={{ color: "#94A3B8" }}
                  >
                    바코드를 스캔해서 재고를 조회해 주세요
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
