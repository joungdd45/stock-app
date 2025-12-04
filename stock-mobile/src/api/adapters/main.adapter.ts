/* ============================================================================
 * 📄 src/api/adapters/main.adapter.ts
 * 도메인: 메인(Main) 대시보드
 *
 * 역할:
 * - 메인 페이지 핑(헬스 체크)
 * - 메인 요약 정보 조회(오늘/이번달 입출고·취소, 총 아이템/재고, 국가 비율, 일별 출고량)
 * - 메인 캘린더 조회(연/월 기준, 일자별 정보)
 *
 * 사용 예시:
 *
 *   import { mainAdapter } from "@/api/adapters/main.adapter";
 *
 *   // 1) 핑
 *   const pingRes = await mainAdapter.ping();
 *
 *   // 2) 요약 정보
 *   const summaryRes = await mainAdapter.fetchSummary();
 *
 *   // 3) 캘린더
 *   const calendarRes = await mainAdapter.fetchCalendar({ year: 2025, month: 12 });
 * ============================================================================
 */

import { apiHub, type ApiResult } from "../hub/apiHub";

/* ─────────────────────────────────────────────
 * 1. 엔드포인트 상수
 * ───────────────────────────────────────────── */

const MAIN_PING_URL = "/api/main/page/ping";
const MAIN_SUMMARY_URL = "/api/main/page/summary";
const MAIN_CALENDAR_URL = "/api/main/page/calendar";

/* ─────────────────────────────────────────────
 * 2. 타입 정의
 * ───────────────────────────────────────────── */

/** 2.1 메인 페이지 핑 응답 */
export type MainPingResponse = {
  page: string;    // "main.page"
  version: string; // "v1.0"
  stage: string;   // "skeleton" 등
};

/** 2.2 메인 요약 정보 - 국가별 출고 비율 */
export type MainCountryRatioItem = {
  country: string; // "SG"
  count: number;   // 3
  ratio: number;   // 1 (비율)
};

/** 2.3 메인 요약 정보 - 일별 출고량 */
export type MainDailyOutboundItem = {
  day: number;   // 1
  count: number; // 3
};

/** 2.4 메인 요약 정보 result */
export type MainSummaryResult = {
  date: string;            // "2025-12-01"
  today_inbound: number;   // 금일 입고 건수
  today_outbound: number;  // 금일 출고 건수
  month_outbound: number;  // 금월 출고 건수
  month_cancel: number;    // 금월 취소 건수
  total_item_count: number; // 총 아이템 수
  total_stock_qty: number;  // 총 재고 수
  country_ratio: MainCountryRatioItem[];
  daily_outbound: MainDailyOutboundItem[];
};

/** 2.5 메인 캘린더 조회 - 요청 DTO */
export type MainCalendarQueryDto = {
  year: number;  // 예: 2025
  month: number; // 예: 11
};

/** 2.6 메인 캘린더 조회 - 일자 정보 */
export type MainCalendarDay = {
  date: string;      // "2025-11-01"
  dow: number;       // 요일(0:월 ... 6:일) - 백엔드 기준
  holiday: string | null; // 공휴일 명 또는 null
  is_today: boolean; // 오늘 여부
};

/** 2.7 메인 캘린더 조회 result */
export type MainCalendarResult = {
  year: number;           // 2025
  month: number;          // 11
  days: MainCalendarDay[]; // 해당 월 전체 일자
};

/* ─────────────────────────────────────────────
 * 3. 어댑터 함수
 * ───────────────────────────────────────────── */

/** 3.1 메인 페이지 핑(헬스 체크) */
async function ping(): Promise<ApiResult<MainPingResponse>> {
  return apiHub.get<MainPingResponse>(MAIN_PING_URL);
}

/** 3.2 메인 요약 정보 조회 */
async function fetchSummary(): Promise<ApiResult<MainSummaryResult>> {
  return apiHub.get<MainSummaryResult>(MAIN_SUMMARY_URL);
}

/** 3.3 메인 캘린더 조회(year, month) */
async function fetchCalendar(
  params: MainCalendarQueryDto
): Promise<ApiResult<MainCalendarResult>> {
  // year, month를 쿼리 파라미터로 전달하는 형태로 가정
  return apiHub.get<MainCalendarResult>(MAIN_CALENDAR_URL, params);
}

/* ─────────────────────────────────────────────
 * 4. 어댑터 export
 * ───────────────────────────────────────────── */

export const mainAdapter = {
  ping,
  fetchSummary,
  fetchCalendar,
} as const;

export type MainAdapter = typeof mainAdapter;
