/**
 * 메인 페이지 (실사용 최종본)
 * - 오늘 KPI
 * - 검색창
 * - 입고/출고 바로가기
 * - mainAdapter.fetchSummary() 완전 연동
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ScanLine, Barcode, ChevronRight } from "lucide-react";

import {
  AppShell,
  Card,
  COLORS,
} from "../../components/layout/AppShell";

import { mainAdapter } from "../../api/adapters/main.adapter";
import { handleError } from "../../api/hub/apiHub";

// ─────────────────────────────────────────────
// 타입
// ─────────────────────────────────────────────

interface MainSummary {
  totalStock: number;
  inboundToday: number;
  outboundToday: number;
}

// ─────────────────────────────────────────────
// 컴포넌트
// ─────────────────────────────────────────────

const MainPage: React.FC = () => {
  const nav = useNavigate();
  const today = new Date();
  const dateLabel = `${today.getMonth() + 1}월 ${today.getDate()}일`;

  const [summary, setSummary] = useState<MainSummary | null>(null);
  const [loading, setLoading] = useState(false);

  // ─────────────────────────────────────────────
  // 요약 정보 로딩
  // ─────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    const load = async () => {
      setLoading(true);

      const res = await mainAdapter.fetchSummary();

      if (!mounted) return;

      if (!res.ok) {
        handleError(res.error);
        setLoading(false);
        return;
      }

      const r = res.data;

      setSummary({
        totalStock: r.total_stock_qty ?? 0,
        inboundToday: r.today_inbound ?? 0,
        outboundToday: r.today_outbound ?? 0,
      });

      setLoading(false);
    };

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const totalStock = summary?.totalStock ?? 0;
  const inboundToday = summary?.inboundToday ?? 0;
  const outboundToday = summary?.outboundToday ?? 0;

  // ─────────────────────────────────────────────
  // 렌더링
  // ─────────────────────────────────────────────
  return (
    <AppShell title="메인">
      {/* 오늘 KPI 카드 */}
      <Card className="p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div style={{ color: COLORS.main }}>오늘</div>
          <div className="text-sm" style={{ color: COLORS.main }}>
            {dateLabel}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <KPI title="총 재고 수" value={loading ? "-" : totalStock} />
          <KPI title="입고" value={loading ? "-" : inboundToday} />
          <KPI title="출고" value={loading ? "-" : outboundToday} />
        </div>
      </Card>

      {/* 검색창 */}
      <Card className="p-3 mb-4">
        <div className="flex items-center gap-2">
          <Search size={18} color={COLORS.main} />
          <input
            className="flex-1 outline-none"
            placeholder="제품 검색"
          />
          <div
            className="p-2 rounded-xl border"
            style={{ borderColor: COLORS.main }}
          >
            <ScanLine size={18} color={COLORS.textGray} />
          </div>
        </div>
      </Card>

      {/* 주요 기능 */}
      <div className="space-y-3">
        <CardRow label="입고처리" onClick={() => nav("/inbound")} />
        <CardRow label="출고처리" onClick={() => nav("/outbound")} />
      </div>
    </AppShell>
  );
};

// ─────────────────────────────────────────────
// Sub 컴포넌트
// ─────────────────────────────────────────────

const KPI: React.FC<{ title: string; value: number | string }> = ({
  title,
  value,
}) => (
  <div
    className="text-center rounded-xl p-3"
    style={{
      backgroundColor: COLORS.main,
      color: COLORS.textWhite,
    }}
  >
    <div className="text-2xl font-semibold">{value}</div>
    <div className="text-xs opacity-90 mt-1">{title}</div>
  </div>
);

const CardRow: React.FC<{ label: string; onClick?: () => void }> = ({
  label,
  onClick,
}) => (
  <Card className="p-4">
    <button
      className="w-full flex items-center justify-between"
      onClick={onClick}
    >
      <div className="flex items-center gap-3">
        <div
          className="h-9 w-9 rounded-xl grid place-items-center"
          style={{ backgroundColor: COLORS.main }}
        >
          <Barcode size={18} color={COLORS.textWhite} />
        </div>
        <div className="text-[15px]" style={{ color: COLORS.main }}>
          {label}
        </div>
      </div>
      <ChevronRight style={{ color: COLORS.main }} />
    </button>
  </Card>
);

export default MainPage;
