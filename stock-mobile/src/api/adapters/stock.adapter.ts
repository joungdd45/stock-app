/* 📄 src/api/adapters/stock.adapter.ts
   도메인: 재고관리(stock)

   역할:
   - 재고 이력(History)
     - [ping]   GET /api/stock/history/ping
     - [list]   GET /api/stock/history/list
     - [export] GET /api/stock/history/export

   - 재고 현황(Status)
     - [ping]   GET  /api/stock/status/ping
     - [list]   GET  /api/stock/status/list
     - [scan]   POST /api/stock/status/scan   ✅ (바코드 스캔 단건)
     - [multi]  POST /api/stock/status/multi
     - [action] POST /api/stock/status/action
*/

import { apiHub, type ApiResult } from "../hub/apiHub";

/* ───────────────────────────────────────────────
 * 0. 공통 상수
 * ─────────────────────────────────────────────── */

const STOCK_HISTORY_PING_URL   = "/api/stock/history/ping";
const STOCK_HISTORY_LIST_URL   = "/api/stock/history/list";
const STOCK_HISTORY_EXPORT_URL = "/api/stock/history/export";

const STOCK_STATUS_PING_URL    = "/api/stock/status/ping";
const STOCK_STATUS_LIST_URL    = "/api/stock/status/list";
const STOCK_STATUS_SCAN_URL    = "/api/stock/status/scan";   // ✅ 추가
const STOCK_STATUS_MULTI_URL   = "/api/stock/status/multi";
const STOCK_STATUS_ACTION_URL  = "/api/stock/status/action";

/* ============================================================
   ⬛ 1. 재고 이력(History)
   ============================================================ */

/* 1-1. 재고 이력 핑 */

export interface StockHistoryPingResponse {
  page: string;
  version: string;
  stage: string;
}

async function pingHistory(): Promise<ApiResult<StockHistoryPingResponse>> {
  return apiHub.get<StockHistoryPingResponse>(STOCK_HISTORY_PING_URL);
}

/* 1-2. 재고 이력 목록 조회 */

export interface StockHistoryListFiltersDto {
  from_date?: string | null;
  to_date?: string | null;
  sku?: string | null;
  keyword?: string | null;
  page?: number;
  size?: number;
}

export interface StockHistoryListItem {
  ledger_id: number;
  process_date: string;
  event_type: string;
  event_label: string;
  sku: string;
  product_name: string;
  qty_in: number;
  qty_out: number;
  current_stock: number;
  last_unit_price: number | null;
  memo: string | null;
  handler: string | null;
}

export interface StockHistoryListResult {
  items: StockHistoryListItem[];
  count: number;
  page: number;
  size: number;
}

async function getHistoryList(
  filters: StockHistoryListFiltersDto
): Promise<ApiResult<StockHistoryListResult>> {
  return apiHub.get<StockHistoryListResult>(STOCK_HISTORY_LIST_URL, {
    params: filters,
  });
}

/* 1-3. 재고 이력 엑셀 export */

export interface StockHistoryExportResult {
  file_name: string;
  content_type: string;
  content_base64: string;
  count: number;
}

async function exportHistory(
  filters: StockHistoryListFiltersDto
): Promise<ApiResult<StockHistoryExportResult>> {
  return apiHub.get<StockHistoryExportResult>(STOCK_HISTORY_EXPORT_URL, {
    params: filters,
  });
}

/* ============================================================
   ⬛ 2. 재고 현황(Status)
   ============================================================ */

/* 2-1. 재고 현황 핑 */

export interface StockStatusPingResponse {
  page: string;    // "stock.status"
  version: string; // 예: "v1.5"
  stage: string;   // "implemented"
}

async function pingStatus(): Promise<ApiResult<StockStatusPingResponse>> {
  return apiHub.get<StockStatusPingResponse>(STOCK_STATUS_PING_URL);
}

/* 2-2. 재고 현황 목록 조회 */

export interface StockStatusItem {
  sku: string;
  name: string;
  current_qty: number;
  available_qty: number;
  last_price: number | null;
}

export interface StockStatusListResult {
  items: StockStatusItem[];
  count: number;
  page: number;
  size: number;
}

async function getStatusList(params: {
  page?: number;
  size?: number;
  sku?: string | null;
  keyword?: string | null;
}): Promise<ApiResult<StockStatusListResult>> {
  return apiHub.get<StockStatusListResult>(STOCK_STATUS_LIST_URL, {
    params,
  });
}

/* 2-2-1. ✅ 바코드 스캔 단건 조회 (정확 매칭) */

export interface StockStatusScanRequest {
  barcode: string;
}

export interface StockStatusScanResult {
  sku: string;
  name: string;
  current_qty: number;
  available_qty: number;
  last_price: number | null;
}

async function scanStatusByBarcode(
  body: StockStatusScanRequest
): Promise<ApiResult<StockStatusScanResult>> {
  return apiHub.post<StockStatusScanResult>(STOCK_STATUS_SCAN_URL, body);
}

/* 2-3. 재고 현황 다건 조회 */

export interface StockStatusMultiRequest {
  skus: string[];
  page: number;
  size: number;
  sort_by: string;
  order: "asc" | "desc";
}

async function multiStatus(
  body: StockStatusMultiRequest
): Promise<ApiResult<StockStatusListResult>> {
  return apiHub.post<StockStatusListResult>(STOCK_STATUS_MULTI_URL, body);
}

/* 2-4. 재고 현황 액션(엑셀 export / 조정 등) */

export interface StockStatusActionRequest {
  action: "export" | "adjust";
  sku?: string;
  final_qty?: number;
  memo?: string;
  selected_skus?: string[];
}

export interface StockStatusActionExportResponse {
  file_name: string;
  content_type: string;
  content_base64: string;
  count: number;
}

async function statusAction(
  body: StockStatusActionRequest
): Promise<ApiResult<StockStatusActionExportResponse>> {
  return apiHub.post<StockStatusActionExportResponse>(
    STOCK_STATUS_ACTION_URL,
    body
  );
}

/* ============================================================
   ⬛ 3. 어댑터 export
   ============================================================ */

export const stockAdapter = {
  // 재고 이력
  pingHistory,
  getHistoryList,
  exportHistory,

  // 재고 현황
  pingStatus,
  getStatusList,
  scanStatusByBarcode, // ✅ 추가
  multiStatus,
  statusAction,
} as const;

export type StockAdapter = typeof stockAdapter;
