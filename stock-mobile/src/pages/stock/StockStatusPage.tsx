/* C:\dev\stock-mobile\src\pages\stock\StockStatusPage.tsx */
/**
 * 재고관리 > 재고현황
 *  - 바코드 스캔 버튼으로 이동
 *  - 바코드 스캔 결과(sessionStorage)로 단건 조회
 *  - 데이터는 나중에 stockAdapter.status 로 연동
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

const STORAGE_KEY = "stock.scan.result";

const StockStatusPage: React.FC = () => {
  const nav = useNavigate();
  const [items, setItems] = useState<StockRow[]>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed: StockRow = JSON.parse(stored);
        setItems([parsed]);
      } catch {
        setItems([]);
      }
    } else {
      setItems([]);
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
            <p
              className="text-xs text-center"
              style={{ color: COLORS.textGray }}
            >
              바코드를 스캔하면 해당 상품의 재고현황이 아래에 표시됩니다.
            </p>
          </div>
        </Card>

        {/* 하단: 재고 리스트 */}
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead
              className="bg-slate-50"
              style={{ color: COLORS.textGray }}
            >
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
