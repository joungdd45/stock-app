/* 📄 C:\dev\stock-app\stock-gui\src\pages\Main\MainPage.tsx
   메인 대시보드 (도넛 확대 + 라벨 하단 잘림 방지 + 라인차트) */

   import React, { useMemo } from "react";
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
   
   // ────────────────────────────────────────────────────────────────
   // 더미 데이터
   // ────────────────────────────────────────────────────────────────
   const TODAY = new Date();
   const YYYY = TODAY.getFullYear();
   const MM0 = TODAY.getMonth();
   const DD = TODAY.getDate();
   
   const COUNTRY_SHARE = [
     { country: "SG", value: 34 },
     { country: "MY", value: 22 },
     { country: "TW", value: 12 },
     { country: "TH", value: 15 },
     { country: "PH", value: 9 },
     { country: "VN", value: 8 },
   ];
   
   const genDaily = (year: number, month0: number) => {
     const daysInMonth = new Date(year, month0 + 1, 0).getDate();
     const arr: Array<{ d: string; shipped: number; shippedMA: number }> = [];
     for (let i = 1; i <= daysInMonth; i++) {
       const date = new Date(year, month0, i);
       const isWeekend = date.getDay() === 0 || date.getDay() === 6;
       const base = isWeekend ? 18 : 52;
       const noise = Math.floor(Math.random() * 24);
       const shipped = Math.max(4, base + noise - (i % 6));
       const p1 = i > 1 ? arr[i - 2].shipped : shipped;
       const p2 = i > 2 ? arr[i - 3].shipped : shipped;
       const ma = Math.round((shipped + p1 + p2) / 3);
       arr.push({ d: String(i), shipped, shippedMA: ma });
     }
     return arr;
   };
   const DAILY = genDaily(YYYY, MM0);
   
   const KPI = {
     inboundToday: 28,
     outboundToday: 46,
     outboundThisMonth: DAILY.reduce((s, v) => s + v.shipped, 0),
     canceledThisMonth: 12,
     totalItems: 530,
     totalStocks: 10458,
   };
   
   const KOR_HOLIDAYS: Array<{ day: number; name: string }> = [
     { day: 3, name: "개천절" },
     { day: 9, name: "한글날" },
   ];
   
   const CHART_COLORS = ["#5B8FF9", "#61DDAA", "#65789B", "#F6BD16", "#7262fd", "#78D3F8"];
   
   // ────────────────────────────────────────────────────────────────
   // 달력 유틸
   // ────────────────────────────────────────────────────────────────
   function buildCalendar(year: number, month0: number, todayDate: number) {
     const firstDay = new Date(year, month0, 1).getDay();
     const daysInMonth = new Date(year, month0 + 1, 0).getDate();
     const cells: Array<{ key: string; day?: number; isToday?: boolean; holidayName?: string }> = [];
     for (let i = 0; i < firstDay; i++) cells.push({ key: `blank-${i}` });
     for (let d = 1; d <= daysInMonth; d++) {
       const isToday = d === todayDate;
       const h = KOR_HOLIDAYS.find((x) => x.day === d);
       cells.push({ key: `day-${d}`, day: d, isToday, holidayName: h?.name });
     }
     const base = cells.length <= 35 ? 35 : 42;
     while (cells.length < base) cells.push({ key: `tail-${cells.length}` });
     return cells;
   }
   
   // ────────────────────────────────────────────────────────────────
   // 상단 카드 (슬림)
   // ────────────────────────────────────────────────────────────────
   const KPISlim: React.FC<{ label: string; value: React.ReactNode; colorClass: string }> = ({
     label,
     value,
     colorClass,
   }) => (
     <div className="rounded-2xl bg-white shadow-sm border border-gray-100">
       <div className="h-24 px-4 flex flex-col items-center justify-center">
         <div className="text-[12px] text-gray-500">{label}</div>
         <div className={`mt-1 text-2xl font-extrabold tracking-tight ${colorClass}`}>{value}</div>
       </div>
     </div>
   );
   
   const KPITotalTwoLine: React.FC<{ items: number; stocks: number }> = ({ items, stocks }) => (
     <div className="rounded-2xl bg-white shadow-sm border border-gray-100 min-w-[240px]">
       <div className="h-24 px-5 flex items-center">
         <div className="text-[12px] leading-snug">
           <div className="text-gray-500">총 아이템수</div>
           <div className="text-base font-semibold tracking-tight">{items.toLocaleString()} 개</div>
           <div className="mt-1 text-gray-500">총 재고수</div>
           <div className="text-base font-semibold tracking-tight">{stocks.toLocaleString()} 개</div>
         </div>
       </div>
     </div>
   );
   
   // ───────── 국가별 출고 비율 (라벨 잘림 방지: 높이/여백/중심/반지름 조정) ─────────
   const renderLeaderLabel = (props: any) => {
     const { cx, cy, midAngle, outerRadius, percent, payload } = props;
     const RAD = Math.PI / 180;
   
     // [NOAH PATCH] 라벨 위치/길이 조정
     const r = outerRadius + 6;
     const sx = cx + r * Math.cos(-midAngle * RAD);
     const sy = cy + r * Math.sin(-midAngle * RAD);
     const ex = cx + (r + 12) * Math.cos(-midAngle * RAD);
     const ey = cy + (r + 12) * Math.sin(-midAngle * RAD);
   
     const leftSide = midAngle > 90 && midAngle < 270;
     const textX = ex + (leftSide ? -8 : 8);
     const anchor = leftSide ? "end" : "start";
     const pct = Math.round((percent || 0) * 100);
   
     return (
       <g>
         <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="#CBD5E1" strokeWidth={1.5} />
         <text
           x={textX}
           y={ey}
           textAnchor={anchor}
           dominantBaseline="middle"
           fontSize={12}
           fontWeight={600}
           fill="#475569"
         >
           {payload.country} {pct}%
         </text>
       </g>
     );
   };
   
   const CountryPie: React.FC = () => {
     return (
       <div className="rounded-2xl bg-white shadow-sm p-3 border border-gray-100 h-full">
         <div className="text-sm font-semibold mb-2">국가별 출고 비율</div>
         {/* [NOAH PATCH] 높이/여백/중심 조정으로 라벨 하단 잘림 방지 */}
         <div className="h-72">
           <ResponsiveContainer>
             <PieChart margin={{ top: 8, right: 8, bottom: 28, left: 8 }}>
               <Pie
                 data={COUNTRY_SHARE}
                 dataKey="value"
                 nameKey="country"
                 cx="50%"
                 cy="44%" // ⬅️ 세로 중심을 더 위로
                 innerRadius={60} // ⬅️ 도넛 두께 조정
                 outerRadius={112} // ⬅️ 전체 크기 확대
                 paddingAngle={1}
                 label={renderLeaderLabel}
                 labelLine={false}
                 isAnimationActive={false}
               >
                 {COUNTRY_SHARE.map((_, i) => (
                   <Cell key={`c-${i}`} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                 ))}
               </Pie>
               <ReTooltip />
             </PieChart>
           </ResponsiveContainer>
         </div>
       </div>
     );
   };
   
   // ────────────────────────────────────────────────────────────────
   // 달력 (축소판 유지)
   // ────────────────────────────────────────────────────────────────
   const CalendarBox: React.FC = () => {
     const title = useMemo(() => `${YYYY}년 ${MM0 + 1}월`, []);
     const cells = useMemo(() => buildCalendar(YYYY, MM0, DD), []);
     const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
     return (
       <div className="rounded-2xl bg-white shadow-sm p-3 border border-gray-100 h-full">
         <div className="flex items-center justify-between mb-1">
           <div className="text-sm font-semibold">{title}</div>
           <div className="text-[10px] text-gray-400">한국 공휴일 표시(더미)</div>
         </div>
         <div className="grid grid-cols-7 text-center text-[10px] text-gray-500 mb-1">
           {weekdays.map((w) => (
             <div key={w} className="py-0.5">
               {w}
             </div>
           ))}
         </div>
         <div className="grid grid-cols-7 gap-1">
           {cells.map((c) => {
             if (!c.day) return <div key={c.key} className="h-8 rounded bg-transparent border border-transparent"></div>;
             const isHoliday = Boolean(c.holidayName);
             return (
               <div
                 key={c.key}
                 className={`h-12 rounded border text-[11px] flex flex-col items-end p-1 ${
                   c.isToday ? "border-blue-500" : "border-gray-100"
                 } ${isHoliday ? "bg-red-50" : "bg-white"}`}
                 title={c.holidayName ?? ""}
               >
                 <span className={`leading-none ${isHoliday ? "text-red-600 font-semibold" : "text-gray-600"}`}>
                   {c.day}
                 </span>
                 {isHoliday ? (
                   <span className="mt-auto w-full text-[9px] text-left text-red-500 truncate leading-tight">
                     {c.holidayName}
                   </span>
                 ) : null}
               </div>
             );
           })}
         </div>
       </div>
     );
   };
   
   // ────────────────────────────────────────────────────────────────
   // 월별 출고량 그래프 (높이 축소 버전)
   // ────────────────────────────────────────────────────────────────
   const OutboundLineChart: React.FC = () => {
     const title = `${MM0 + 1}월 출고량`;
     return (
       <div className="rounded-2xl bg-white shadow-sm p-3 border border-gray-100">
         {/* 제목, 패딩을 조금 줄여 전체 높이 축소 */}
         <div className="text-sm font-semibold mb-1">{title}</div>
         {/* 기존 h-64 → h-52 로 줄여서 메인 페이지 오버플로우 방지 */}
         <div className="h-52 overflow-hidden">
           <ResponsiveContainer>
             <LineChart data={DAILY} margin={{ top: 8, right: 16, left: 8, bottom: 8 }}>
               <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" />
               <XAxis dataKey="d" tick={{ fontSize: 11, fill: "#6B7280" }} />
               <YAxis tick={{ fontSize: 11, fill: "#6B7280" }} />
               {/* [NOAH PATCH] 툴팁 값을 당일 출고건수로 표시 */}
               <ReTooltip
                 wrapperStyle={{ outline: "none" }}
                 formatter={(_, __, item: any) => {
                   const shipped = item?.payload?.shipped ?? 0; // 당일 출고건수
                   return [`${Number(shipped).toLocaleString()} 건`, "당일 출고건수"];
                 }}
                 labelFormatter={(l: any) => `${MM0 + 1}월 ${l}일`}
               />
               <Line
                 type="linear"
                 dataKey="shippedMA"
                 name="3일 이동평균"
                 stroke="#3B82F6"
                 strokeWidth={2.5}
                 dot={{ r: 3, stroke: "#ffffff", strokeWidth: 2, fill: "#3B82F6" }}
                 activeDot={{ r: 4 }}
               />
             </LineChart>
           </ResponsiveContainer>
         </div>
       </div>
     );
   };
   
   // ────────────────────────────────────────────────────────────────
   // 메인 페이지
   // ────────────────────────────────────────────────────────────────
   const MainPage: React.FC = () => {
     return (
       <div className="p-4 md:p-6 space-y-3">
         {/* 상단: 건수(4) + 아이템수(2줄) */}
         <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
           <KPISlim label="금일 입고건수" value={`${KPI.inboundToday} 건`} colorClass="text-emerald-600" />
           <KPISlim label="금일 출고건수" value={`${KPI.outboundToday} 건`} colorClass="text-blue-600" />
           <KPISlim
             label="금월 출고건수"
             value={`${KPI.outboundThisMonth.toLocaleString()} 건`}
             colorClass="text-indigo-600"
           />
           <KPISlim label="금월 취소건수" value={`${KPI.canceledThisMonth} 건`} colorClass="text-rose-600" />
           <KPITotalTwoLine items={KPI.totalItems} stocks={KPI.totalStocks} />
         </div>
   
         {/* 중단: 국가별 출고비율 / 달력 */}
         <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
           <CountryPie />
           <CalendarBox />
         </div>
   
         {/* 하단: 월별 출고량 그래프(라인만) */}
         <OutboundLineChart />
       </div>
     );
   };
   
   export default MainPage;
   