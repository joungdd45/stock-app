/* 📄 src/api/adapters/stock.adapter.ts
   도메인: 재고관리(stock)

   역할:
   - 재고 이력(History)
     - [ping]   GET /api/stock/history/ping
     - [list]   GET /api/stock/history/list
     - [export] GET /api/stock/history/export

   - 재고 현황(Status)
     - [ping]         GET /api/stock/status/ping
     - [list]         GET /api/stock/status/list
     - [multi]        POST /api/stock/status/multi
     - [action]       POST /api/stock/status/action
     - ✅ [export-xlsx] GET /api/stock/status/export-xlsx (스트리밍 다운로드)
     - ✅ [bulk-adjust] POST /api/stock/status/bulk-adjust (PC 재고실사 대량확정)

   - 재고 실사(PC 대량등록 확정)
     - ✅ [bulk-adjust] POST /api/stock/status/bulk-adjust
       * payload: items[{ sku, final_qty, memo? }]
       * ✅ memo 정책: 프론트는 "자동 기본값"을 넣지 않는다(중복 방지)
         - memo가 필요하면 페이지에서 명시적으로 넣는다
         - 없으면 memo 필드를 보내지 않는다

   - ✅ 바코드 등록(대량용 단건 API)
     - ✅ POST /api/inbound/process/register-barcode
       * payload: { sku, barcode, name? }
       * name은 표시용(서버에서 무시해도 됨)

   ⚠️ 타입 주의:
   - ApiFailure가 data를 필수로 요구하는 구조라서
     ok:false 리턴에도 data를 반드시 넣는다.
*/

import { apiHub, type ApiResult } from "../hub/apiHub";

/* ───────────────────────────────────────────────
 * 0. 공통 상수
 * ─────────────────────────────────────────────── */

const STOCK_HISTORY_PING_URL = "/api/stock/history/ping";
const STOCK_HISTORY_LIST_URL = "/api/stock/history/list";
const STOCK_HISTORY_EXPORT_URL = "/api/stock/history/export";

const STOCK_STATUS_PING_URL = "/api/stock/status/ping";
const STOCK_STATUS_LIST_URL = "/api/stock/status/list";
const STOCK_STATUS_MULTI_URL = "/api/stock/status/multi";
const STOCK_STATUS_ACTION_URL = "/api/stock/status/action";
const STOCK_STATUS_EXPORT_XLSX_URL = "/api/stock/status/export-xlsx";

/** ✅ 재고실사 대량확정(PC) 엔드포인트 */
const STOCKTAKE_BULK_CONFIRM_URL = "/api/stock/status/bulk-adjust";

/** ✅ 바코드 등록(단건) 엔드포인트 (대량등록은 프론트에서 한 줄씩 호출) */
const REGISTER_BARCODE_URL = "/api/inbound/process/register-barcode";

/* ───────────────────────────────────────────────
 * 0-1. 다운로드 유틸
 * ─────────────────────────────────────────────── */

function parseFilenameFromContentDisposition(v: string | null): string | null {
  if (!v) return null;

  // filename*=UTF-8''xxx
  const m1 = v.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (m1?.[1]) return decodeURIComponent(m1[1].trim());

  // filename="xxx" or filename=xxx
  const m2 = v.match(/filename\s*=\s*"([^"]+)"/i) || v.match(/filename\s*=\s*([^;]+)/i);
  if (m2?.[1]) return m2[1].trim();

  return null;
}

/**
 * ✅ 서버에서 쓰는 토큰 키를 “추측”이 아니라 후보로 확실히 커버
 * - 가장 우선: stockapp.access_token
 * - 그다음: accessToken / access_token / token / jwt
 */
function getAccessToken(): string | null {
  try {
    return (
      localStorage.getItem("stockapp.access_token") ||
      sessionStorage.getItem("stockapp.access_token") ||
      localStorage.getItem("accessToken") ||
      sessionStorage.getItem("accessToken") ||
      localStorage.getItem("access_token") ||
      sessionStorage.getItem("access_token") ||
      localStorage.getItem("token") ||
      sessionStorage.getItem("token") ||
      localStorage.getItem("jwt") ||
      sessionStorage.getItem("jwt") ||
      null
    );
  } catch {
    return null;
  }
}

async function downloadBlob(res: Response, fallbackName: string) {
  const cd = res.headers.get("content-disposition");
  const filename = parseFilenameFromContentDisposition(cd) || fallbackName;

  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(objectUrl);
}

/* ============================================================
   ⬛ 1. 재고 이력(History)
   ============================================================ */

export interface StockHistoryPingResponse {
  page: string;
  version: string;
  stage: string;
}

async function pingHistory(): Promise<ApiResult<StockHistoryPingResponse>> {
  return apiHub.get<StockHistoryPingResponse>(STOCK_HISTORY_PING_URL);
}

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

async function getHistoryList(filters: StockHistoryListFiltersDto): Promise<ApiResult<StockHistoryListResult>> {
  return apiHub.get<StockHistoryListResult>(STOCK_HISTORY_LIST_URL, {
    params: filters,
  });
}

export interface StockHistoryExportResult {
  file_name: string;
  content_type: string;
  content_base64: string;
  count: number;
}

async function exportHistory(filters: StockHistoryListFiltersDto): Promise<ApiResult<StockHistoryExportResult>> {
  return apiHub.get<StockHistoryExportResult>(STOCK_HISTORY_EXPORT_URL, {
    params: filters,
  });
}

/* ============================================================
   ⬛ 2. 재고 현황(Status)
   ============================================================ */

export interface StockStatusPingResponse {
  page: string; // "stock.status"
  version: string; // 예: "v1.5"
  stage: string; // "implemented"
}

async function pingStatus(): Promise<ApiResult<StockStatusPingResponse>> {
  return apiHub.get<StockStatusPingResponse>(STOCK_STATUS_PING_URL);
}

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
  return apiHub.get<StockStatusListResult>(STOCK_STATUS_LIST_URL, { params });
}

/* 2-3. 재고 현황 다건 조회 */

export interface StockStatusMultiRequest {
  skus: string[];
  page: number;
  size: number;
  sort_by: string;
  order: "asc" | "desc";
}

async function multiStatus(body: StockStatusMultiRequest): Promise<ApiResult<StockStatusListResult>> {
  return apiHub.post<StockStatusListResult>(STOCK_STATUS_MULTI_URL, body);
}

/* 2-4. 재고 현황 액션(엑셀 export/base64 또는 조정 등) */

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

async function statusAction(body: StockStatusActionRequest): Promise<ApiResult<StockStatusActionExportResponse>> {
  return apiHub.post<StockStatusActionExportResponse>(STOCK_STATUS_ACTION_URL, body);
}

/* 2-5. ✅ 재고 현황 xlsx 다운로드 (스트리밍 다운로드) */

export interface StockStatusExportXlsxParams {
  sku?: string | null;
}

async function downloadStatusXlsx(params?: StockStatusExportXlsxParams): Promise<void> {
  const qs = new URLSearchParams();
  if (params?.sku) qs.set("sku", params.sku);

  const url = qs.toString().length > 0 ? `${STOCK_STATUS_EXPORT_XLSX_URL}?${qs.toString()}` : STOCK_STATUS_EXPORT_XLSX_URL;

  const token = getAccessToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, {
    method: "GET",
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`엑셀 다운로드 실패 (status=${res.status})`);
  }

  const fallbackName = `stock_status_${new Date().toISOString().slice(0, 10)}.xlsx`;
  await downloadBlob(res, fallbackName);
}

/* ============================================================
   ⬛ 3. 재고 실사(PC 대량등록 확정)
   ============================================================ */

export interface StocktakeBulkConfirmItem {
  sku: string;
  final_qty: number; // ✅ 서버 스펙 (필수)
  memo?: string | null; // ✅ 서버 스펙 (옵션)
}

export interface StocktakeBulkConfirmRequest {
  items: StocktakeBulkConfirmItem[];
}

/** 서버 응답 스펙은 라우터 확정 후 맞추면 됨 (일단 유연하게) */
export interface StocktakeBulkConfirmResponse {
  count?: number;
  message?: string;
}

async function stocktakeBulkConfirm(body: StocktakeBulkConfirmRequest): Promise<ApiResult<StocktakeBulkConfirmResponse>> {
  const normalized: StocktakeBulkConfirmRequest = {
    items: (body.items ?? []).map((it) => {
      const sku = String(it.sku ?? "").trim();
      const final_qty = Number(it.final_qty);
      const memo = String(it.memo ?? "").trim();

      return {
        sku,
        final_qty,
        ...(memo ? { memo } : {}), // ✅ memo가 있을 때만 보냄(자동 주입 금지)
      };
    }),
  };

  return apiHub.post<StocktakeBulkConfirmResponse>(STOCKTAKE_BULK_CONFIRM_URL, normalized);
}

/* ============================================================
   ⬛ 4. ✅ 바코드 등록(대량용 단건)
   ============================================================ */

export interface RegisterBarcodeForSkuRequest {
  sku: string;
  barcode: string;
  name?: string | null; // 표시용(서버에서 무시해도 됨)
}

/** 응답은 서버마다 다를 수 있으니, 페이지에서는 ok만 보게 최소한으로 둠 */
export interface RegisterBarcodeForSkuResponse {
  message?: string;
}

async function registerBarcodeForSku(
  body: RegisterBarcodeForSkuRequest
): Promise<ApiResult<RegisterBarcodeForSkuResponse>> {
  const sku = String(body.sku ?? "").trim();
  const barcode = String(body.barcode ?? "").trim();
  const name = String(body.name ?? "").trim();

  // ✅ ApiFailure가 data를 필수로 요구하는 구조라서, ok:false에도 data를 넣는다.
  if (!sku) {
    return {
      ok: false,
      data: null as any,
      error: { message: "SKU가 비어있어요." } as any,
    };
  }
  if (!barcode) {
    return {
      ok: false,
      data: null as any,
      error: { message: "바코드가 비어있어요." } as any,
    };
  }

  // name은 표시용이라 비어있으면 아예 보내지 않음
  const normalized: RegisterBarcodeForSkuRequest = {
    sku,
    barcode,
    ...(name ? { name } : {}),
  };

  return apiHub.post<RegisterBarcodeForSkuResponse>(REGISTER_BARCODE_URL, normalized);
}

/* ============================================================
   ⬛ 5. 어댑터 export
   ============================================================ */

export const stockAdapter = {
  // 재고 이력
  pingHistory,
  getHistoryList,
  exportHistory,

  // 재고 현황
  pingStatus,
  getStatusList,
  multiStatus,
  statusAction, // 레거시 유지
  downloadStatusXlsx, // ✅ 신규

  // 재고 실사(PC)
  stocktakeBulkConfirm, // ✅ 신규

  // ✅ 바코드 등록(대량)
  registerBarcodeForSku, // ✅ 신규
} as const;

export type StockAdapter = typeof stockAdapter;
