/* 📄 src/api/adapters/reports.adapter.ts
   도메인: 대시보드 / 리포트(reports)
   역할:
   - 주간 현황(weekly)
   - 월간 현황(monthly)
   - TOP10 현황(top10)
   - 각 리포트의 xlsx 내보내기
*/

import { apiHub, type ApiResult } from "../hub/apiHub";

/* ───────────────────────────────────────────────
 * 공통 타입
 * ───────────────────────────────────────────────*/

export interface BaseExcelResult {
  file_name: string;
  content_type: string;
  content_base64: string;
}

/* ───────────────────────────────────────────────
 * 1. 주간 현황(Weekly)
 * ───────────────────────────────────────────────*/

export interface ReportsWeeklyListParams {
  year: number;
  month: number;
  week: number;
  query?: string;
  page?: number;
  page_size?: number;
  sort?: "qty_desc" | "sales_desc";
}

export interface ReportsWeeklyItem {
  sku: string;
  name: string;
  shipped_qty: number;
  revenue: number;
}

export interface ReportsWeeklyListResult {
  range_from: string;
  range_to: string;
  page: number;
  page_size: number;
  total: number;
  items: ReportsWeeklyItem[];
  meta: {
    currency: string;
    timezone: string;
  };
}

export interface ReportsWeeklyExcelResult extends BaseExcelResult {}

export interface ReportsWeeklyPingResponse {
  ok: boolean;
  trace_id: string | null;
  page: string;
  version: string;
  stage: string;
}

/* ───────────────────────────────────────────────
 * 2. 월간 현황(Monthly)
 * ───────────────────────────────────────────────*/

export interface ReportsMonthlyListParams {
  year: number;
  month: number;
  q?: string;
  page?: number;
  size?: number;
}

export interface ReportsMonthlyItem {
  sku: string;
  name: string;
  shipped_qty: number;
}

export interface ReportsMonthlyListResult {
  items: ReportsMonthlyItem[];
  count: number;
  page: number;
  size: number;
}

export interface ReportsMonthlyExcelResult extends BaseExcelResult {}

/* ───────────────────────────────────────────────
 * 3. TOP10 현황(Top10)
 * ───────────────────────────────────────────────*/

export interface ReportsTop10ListParams {
  year: number;
  month: number;
  keyword?: string;
}

export interface ReportsTop10Item {
  sku: string;
  name: string;
  shipped_qty: number;
  revenue: number;
}

export interface ReportsTop10ListResult {
  month: string; // "2025-11"
  count: number;
  items: ReportsTop10Item[];
}

export interface ReportsTop10ExcelResult extends BaseExcelResult {}

export interface ReportsTop10PingResponse {
  ok: boolean;
  trace_id: string | null;
  page: string;
  version: string;
  stage: string;
}

/* ───────────────────────────────────────────────
 * 1) 주간 현황 API
 * ───────────────────────────────────────────────*/

async function pingWeekly(): Promise<ApiResult<ReportsWeeklyPingResponse>> {
  return apiHub.get<ReportsWeeklyPingResponse>("/api/reports/weekly/ping");
}

async function fetchWeeklyList(
  params: ReportsWeeklyListParams
): Promise<ApiResult<ReportsWeeklyListResult>> {
  return apiHub.get<ReportsWeeklyListResult>("/api/reports/weekly", {
    params,
  });
}

async function exportWeeklyExcel(
  params: ReportsWeeklyListParams
): Promise<ApiResult<ReportsWeeklyExcelResult>> {
  return apiHub.get<ReportsWeeklyExcelResult>("/api/reports/weekly/export", {
    params,
  });
}

/* ───────────────────────────────────────────────
 * 2) 월간 현황 API
 * ───────────────────────────────────────────────*/

async function fetchMonthlyList(
  params: ReportsMonthlyListParams
): Promise<ApiResult<ReportsMonthlyListResult>> {
  return apiHub.get<ReportsMonthlyListResult>("/api/reports/monthly/list", {
    params,
  });
}

async function exportMonthlyExcel(
  params: ReportsMonthlyListParams
): Promise<ApiResult<ReportsMonthlyExcelResult>> {
  return apiHub.get<ReportsMonthlyExcelResult>("/api/reports/monthly/export", {
    params,
  });
}

/* ───────────────────────────────────────────────
 * 3) TOP10 현황 API
 * ───────────────────────────────────────────────*/

async function pingTop10(): Promise<ApiResult<ReportsTop10PingResponse>> {
  return apiHub.get<ReportsTop10PingResponse>("/api/reports/top10/ping");
}

async function fetchTop10List(
  params: ReportsTop10ListParams
): Promise<ApiResult<ReportsTop10ListResult>> {
  return apiHub.get<ReportsTop10ListResult>("/api/reports/top10/list", {
    params,
  });
}

async function exportTop10Excel(
  params: ReportsTop10ListParams
): Promise<ApiResult<ReportsTop10ExcelResult>> {
  return apiHub.get<ReportsTop10ExcelResult>("/api/reports/top10/export", {
    params,
  });
}

/* ───────────────────────────────────────────────
 * Adapter 객체
 * ───────────────────────────────────────────────*/

export const reportsAdapter = {
  // weekly
  pingWeekly,
  fetchWeeklyList,
  exportWeeklyExcel,

  // monthly
  fetchMonthlyList,
  exportMonthlyExcel,

  // top10
  pingTop10,
  fetchTop10List,
  exportTop10Excel,
};
