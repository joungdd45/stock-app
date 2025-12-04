/* C:\dev\stock-mobile\src\pages\outbound\OutboundListPage.tsx */
/**
 * 출고관리 > 출고처리 시작 페이지
 *  - 매우 단순하게 '송장 스캔' 버튼만 제공
 *  - 버튼 클릭 → 송장 스캔 페이지로 이동
 */

import React from "react";
import { useNavigate } from "react-router-dom";
import { AppShell, Card, COLORS } from "../../components/layout/AppShell";

const OutboundListPage: React.FC = () => {
  const nav = useNavigate();

  const goInvoiceScan = () => {
    nav("/outbound/scan-invoice");
  };

  return (
    <AppShell title="출고처리">
      <div className="p-4">
        <Card className="p-6 flex justify-center">
          <button
            type="button"
            className="h-14 w-full rounded-xl text-lg font-semibold text-white active:translate-y-[2px]"
            style={{ backgroundColor: COLORS.main }}
            onClick={goInvoiceScan}
          >
            송장 스캔
          </button>
        </Card>
      </div>
    </AppShell>
  );
};

export default OutboundListPage;
