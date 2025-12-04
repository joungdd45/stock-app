/* 📄 C:\dev\stock-app\stock-gui\src\pages\Main\MainPage.tsx
   메인 대시보드
   - 현재 상태: mainAdapter(summary) 연동 완료
   - 사용 API:
     - GET /api/main/page/summary → mainAdapter.fetchSummary()
*/

import React, { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  Line,
  LineChart,
} from "recharts";
import {
  mainAdapter,
  type MainSummaryResult,
} from "@/api/adapters/main.adapter";
import { handleError } from "@/utils/handleError";

/* ─────────────────────────────────────────────
   상수·타입
─────────────────────────────────────────────*/

const KOR_HOLIDAYS: Array<{ day: number; name: string }> = [
  { day: 3, name: "개천절" },
  { day: 9, name: "한글날" },
];

const CHART_COLORS = [
  "#5B8FF9",
  "#61DDAA",
  "#65789B",
  "#F6BD16",
  "#7262fd",
  "#78D3F8",
];

type KpiView = {
  inboundToday: number;
  outboundToday: number;
  monthOutbound: number;
  monthCancel: number;
  totalItems: number;
  totalStocks: number;
};

type CountryShareView = {
  country: string;
  value: number;
};

type DailySeriesPoint = {
  d: string;
  shipped: number;
  shippedMA: number;
};

/* ─────────────────────────────────────────────
   달력 유틸
─────────────────────────────────────────────*/

function buildCalendar(year: number, month0: number, todayDate: number) {
  const firstDay = new Date(year, month0, 1).getDay();
  const daysInMonth = new Date(year, month0 + 1, 0).getDate();
  const cells: Array<{
    key: string;
    day?: number;
    isToday?: boolean;
    holidayName?: string;
  }> = [];

  for (let i = 0; i < firstDay; i++) {
    cells.push({ key: `blank-${i}` });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = d === todayDate;
    const h = KOR_HOLIDAYS.find((x) => x.day === d);
    cells.push({
      key: `day-${d}`,
      day: d,
      isToday,
      holidayName: h?.name,
    });
  }

  const base = cells.length <= 35 ? 35 : 42;
  while (cells.length < base) {
    cells.push({ key: `tail-${cells.length}` });
  }
  return cells;
}

/* ─────────────────────────────────────────────
   상단 카드
─────────────────────────────────────────────*/

const KPISlim: React.FC<{
  label: string;
  value: React.ReactNode;
  colorClass: string;
}> = ({ label, value, colorClass }) => (
  <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
    <div className="h-24 px-4 flex flex-col items-center justify-center">
      <div className="text-[12px] text-gray-500">{label}</div>
      <div
        className={`mt-1 text-2xl font-extrabold tracking-tight ${colorClass}`}
      >
        {value}
      </div>
    </div>
  </div>
);

const KPITotalTwoLine: React.FC<{ items: number; stocks: number }> = ({
  items,
  stocks,
}) => (
  <div className="rounded-2xl bg-white shadow-sm border border-gray-100 min-w-[240px]">
    <div className="h-24 px-5 flex items-center">
      <div className="text-[12px] leading-snug">
        <div className="text-gray-500">총 아이템수</div>
        <div className="text-base font-semibold tracking-tight">
          {items.toLocaleString()} 개
        </div>
        <div className="mt-1 text-gray-500">총 재고수</div>
        <div className="text-base font-semibold tracking-tight">
          {stocks.toLocaleString()} 개
        </div>
      </div>
    </div>
  </div>
);

/* ─────────────────────────────────────────────
   국가별 파이
─────────────────────────────────────────────*/

const CountryPie: React.FC<{ data: CountryShareView[] }> = ({ data }) => {
  return (
    <div className="rounded-2xl bg-white shadow-sm p-3 border border-gray-100 h-full">
      <div className="text-sm font-semibold mb-2">국가별 출고 비율</div>
      <div className="h-72">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            표시할 데이터가 없습니다.
          </div>
        ) : (
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="country"
                cx="50%"
                cy="50%"
              >
                {data.map((_, i) => (
                  <Cell
                    key={i}
                    fill={CHART_COLORS[i % CHART_COLORS.length]}
                  />
                ))}
              </Pie>
              <ReTooltip />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   달력
─────────────────────────────────────────────*/

const CalendarBox: React.FC<{ baseDate: Date }> = ({ baseDate }) => {
  const year = baseDate.getFullYear();
  const month0 = baseDate.getMonth();
  const day = baseDate.getDate();

  const title = `${year}년 ${month0 + 1}월`;
  const cells = buildCalendar(year, month0, day);
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];

  return (
    <div className="rounded-2xl bg-white shadow-sm p-3 border border-gray-100 h-full">
      <div className="text-sm font-semibold mb-1">{title}</div>
      <div className="grid grid-cols-7 text-center text-[10px] text-gray-500 mb-1">
        {weekdays.map((w) => (
          <div key={w}>{w}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => {
          if (!c.day) return <div key={c.key} className="h-8"></div>;
          return (
            <div
              key={c.key}
              className="h-12 border rounded p-1 text-right text-xs"
            >
              {c.day}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   라인차트
─────────────────────────────────────────────*/

const OutboundLineChart: React.FC<{
  monthTitle: string;
  data: DailySeriesPoint[];
}> = ({ monthTitle, data }) => {
  return (
    <div className="rounded-2xl bg-white shadow-sm p-3 border border-gray-100">
      <div className="text-sm font-semibold mb-1">{monthTitle}</div>
      <div className="h-52">
        {data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            표시할 데이터가 없습니다.
          </div>
        ) : (
          <ResponsiveContainer>
            <LineChart data={data}>
              <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" />
              <XAxis dataKey="d" />
              <YAxis />
              <Line
                type="linear"
                dataKey="shippedMA"
                stroke="#3B82F6"
                strokeWidth={2.5}
              />
              <ReTooltip />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

/* ─────────────────────────────────────────────
   메인 페이지 (mainAdapter 연동 버전)
─────────────────────────────────────────────*/

const MainPage: React.FC = () => {
  const [summary, setSummary] = useState<MainSummaryResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    const fetch = async () => {
      setLoading(true);
      const res = await mainAdapter.fetchSummary();

      if (!mounted) return;

      if (res.ok) {
        setSummary(res.data);
      } else {
        setSummary(null);
        if (res.error) {
          handleError(res.error);
        }
      }
      setLoading(false);
    };

    fetch();

    return () => {
      mounted = false;
    };
  }, []);

  const kpi: KpiView = useMemo(
    () => ({
      inboundToday: summary?.today_inbound ?? 0,
      outboundToday: summary?.today_outbound ?? 0,
      monthOutbound: summary?.month_outbound ?? 0,
      monthCancel: summary?.month_cancel ?? 0,
      totalItems: summary?.total_item_count ?? 0,
      totalStocks: summary?.total_stock_qty ?? 0,
    }),
    [summary],
  );

  const countryShare: CountryShareView[] = useMemo(() => {
    const list = summary?.country_ratio ?? [];
    return Array.isArray(list)
      ? list.map((c) => ({
          country: c.country,
          value: c.count ?? 0,
        }))
      : [];
  }, [summary]);

  const dailySeries: DailySeriesPoint[] = useMemo(() => {
    const raw = summary?.daily_outbound ?? [];
    if (!Array.isArray(raw)) return [];

    const base = raw.map((d) => ({
      d: String(d.day ?? ""),
      shipped: d.count ?? 0,
      shippedMA: 0,
    }));

    for (let i = 0; i < base.length; i++) {
      const v0 = base[i].shipped;
      const v1 = base[i - 1]?.shipped ?? v0;
      const v2 = base[i - 2]?.shipped ?? v0;
      base[i].shippedMA = Math.round((v0 + v1 + v2) / 3);
    }

    return base;
  }, [summary]);

  const baseDate = useMemo(() => {
    if (!summary?.date) return new Date();
    const [y, m, d] = summary.date.split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }, [summary]);

  const monthTitle = `${baseDate.getFullYear()}년 ${
    baseDate.getMonth() + 1
  }월 출고량`;

  return (
    <div className="p-4 md:p-6 space-y-4">
      {loading && (
        <div className="text-xs mb-1">
          <span className="text-gray-500">
            메인 요약 정보를 불러오는 중입니다...
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
        <KPISlim
          label="금일 입고"
          value={`${kpi.inboundToday}`}
          colorClass="text-emerald-600"
        />
        <KPISlim
          label="금일 출고"
          value={`${kpi.outboundToday}`}
          colorClass="text-blue-600"
        />
        <KPISlim
          label="월 출고"
          value={`${kpi.monthOutbound}`}
          colorClass="text-indigo-600"
        />
        <KPISlim
          label="월 취소"
          value={`${kpi.monthCancel}`}
          colorClass="text-rose-600"
        />
        <KPITotalTwoLine
          items={kpi.totalItems}
          stocks={kpi.totalStocks}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CountryPie data={countryShare} />
        <CalendarBox baseDate={baseDate} />
      </div>

      <OutboundLineChart monthTitle={monthTitle} data={dailySeries} />
    </div>
  );
};

export default MainPage;
