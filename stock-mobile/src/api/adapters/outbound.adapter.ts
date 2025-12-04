/* 📄 src/api/adapters/outbound.adapter.ts
   도메인: 출고관리(outbound)

   역할:
   - 출고 등록(등록 탭) outbound-register-form
   - 출고 등록(조회 탭) outbound-register-list
   - 출고 처리(outbound-process)
   - 출고 완료(outbound-complete)
   - 출고 취소(outbound-cancel)

   통신 규칙:
   - 모든 요청/응답은 apiHub를 통해 이루어진다.
   - 페이지는 이 어댑터만 import 한다.
*/

import { apiHub, type ApiResult } from "../hub/apiHub";

/* ───────────────────────────────────────────────
 * 0. 공통 타입
 * ─────────────────────────────────────────────── */

export interface ActionEnvelope<T> {
  result: T;
}

/* ───────────────────────────────────────────────
 * 1. 출고 등록(등록 탭) - Ping
 *    GET /api/outbound/register-form/ping
 * ─────────────────────────────────────────────── */

/** 출고등록 - 등록 탭 핑 응답 DTO */
export interface OutboundRegisterFormPingResponse {
  page: string;
  version: string;
  stage: string;
}

const OUTBOUND_REGISTER_FORM_PING_URL =
  "/api/outbound/register-form/ping";

async function pingRegisterForm(): Promise<
  ApiResult<OutboundRegisterFormPingResponse>
> {
  return apiHub.get<OutboundRegisterFormPingResponse>(
    OUTBOUND_REGISTER_FORM_PING_URL,
  );
}

/* ───────────────────────────────────────────────
 * 2. 출고 등록(등록 탭) - 일괄 등록
 *    POST /api/outbound/register-form/register
 * ─────────────────────────────────────────────── */

/** 출고 등록(등록 탭) 한 줄 DTO */
export interface OutboundRegisterFormItemDto {
  country: string; // 국가코드(2자리)  예: "SG"
  order_number: string; // 주문번호
  tracking_number: string; // 송장번호
  sku: string; // 상품관리 SKU
  product_name: string; // 상품명 (SKU 기준 자동매핑)
  qty: number; // 출고수량
  total_price: number; // 총 가격(통화단위 무시, 숫자만)
}

/** 출고 등록(등록 탭) 요청 DTO */
export interface OutboundRegisterFormRequestDto {
  items: OutboundRegisterFormItemDto[];
}

/** 출고 등록(등록 탭) 성공 결과 DTO */
export interface OutboundRegisterFormRegisterResult {
  created_headers: number;
  created_items: number;
}

const OUTBOUND_REGISTER_FORM_REGISTER_URL =
  "/api/outbound/register-form/register";

async function registerForm(
  payload: OutboundRegisterFormRequestDto,
): Promise<
  ApiResult<ActionEnvelope<OutboundRegisterFormRegisterResult>>
> {
  return apiHub.post<
    ActionEnvelope<OutboundRegisterFormRegisterResult>,
    OutboundRegisterFormRequestDto
  >(OUTBOUND_REGISTER_FORM_REGISTER_URL, payload);
}

/* ───────────────────────────────────────────────
 * 3. 출고 등록(조회 탭) - 목록 조회
 *    GET /api/outbound/register/list
 * ─────────────────────────────────────────────── */

/** 조회 탭 하단 표 한 줄 */
export interface OutboundRegisterListItem {
  header_id: number;
  item_id: number;
  country: string;
  order_number: string;
  tracking_number: string | null;
  sku: string;
  product_name: string;
  qty: number;
  total_price: string; // "1500.00"
}

/** 조회 탭 목록 result */
export interface OutboundRegisterListResult {
  items: OutboundRegisterListItem[];
  total_count: number;
  page: number;
  size: number;
  sort_by: string;
  sort_dir: "asc" | "desc";
}

/** 조회 탭 목록 조회 쿼리 */
export interface OutboundRegisterListQuery {
  keyword?: string;
  page?: number;
  size?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}

const OUTBOUND_REGISTER_LIST_URL = "/api/outbound/register/list";

async function fetchRegisterList(
  params: OutboundRegisterListQuery,
): Promise<ApiResult<ActionEnvelope<OutboundRegisterListResult>>> {
  return apiHub.get<ActionEnvelope<OutboundRegisterListResult>>(
    OUTBOUND_REGISTER_LIST_URL,
    { params },
  );
}

/* ───────────────────────────────────────────────
 * 4. 출고 등록(조회 탭) - 액션
 *    POST /api/outbound/register/action
 * ─────────────────────────────────────────────── */

export type OutboundRegisterActionType = "update" | "delete" | "export";

/** 공통 액션 베이스 */
export interface OutboundRegisterBaseActionRequest {
  action: OutboundRegisterActionType;
}

/** update payload 필드 */
export interface OutboundRegisterUpdatePayload {
  country: string;
  order_number: string;
  tracking_number: string;
  sku: string;
  qty: number;
  total_price: string; // "1500.00"
}

/** 단건 수정 요청 */
export interface OutboundRegisterUpdateRequest
  extends OutboundRegisterBaseActionRequest {
  action: "update";
  ids: number[];
  payload: OutboundRegisterUpdatePayload;
}

/** 단건 수정 결과 */
export interface OutboundRegisterUpdateResult {
  item_id: number;
  header_id: number;
  updated_fields: OutboundRegisterUpdatePayload;
}

/** 다건 삭제 요청 */
export interface OutboundRegisterDeleteRequest
  extends OutboundRegisterBaseActionRequest {
  action: "delete";
  ids: number[];
  payload?: Record<string, unknown>;
}

/** 다건 삭제 결과 */
export interface OutboundRegisterDeleteResult {
  deleted_count: number;
  deleted_ids: number[];
}

/** xlsx 내보내기 요청 */
export interface OutboundRegisterExportRequest
  extends OutboundRegisterBaseActionRequest {
  action: "export";
  ids: number[];
  payload?: Record<string, unknown>;
}

/** xlsx 응답은 Blob */
export type OutboundRegisterExportResult = Blob;

const OUTBOUND_REGISTER_ACTION_URL = "/api/outbound/register/action";

async function updateRegisterItem(
  payload: OutboundRegisterUpdateRequest,
): Promise<ApiResult<ActionEnvelope<OutboundRegisterUpdateResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundRegisterUpdateResult>,
    OutboundRegisterUpdateRequest
  >(OUTBOUND_REGISTER_ACTION_URL, payload);
}

async function deleteRegisterItems(
  payload: OutboundRegisterDeleteRequest,
): Promise<ApiResult<ActionEnvelope<OutboundRegisterDeleteResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundRegisterDeleteResult>,
    OutboundRegisterDeleteRequest
  >(OUTBOUND_REGISTER_ACTION_URL, payload);
}

async function exportRegisterItems(
  payload: OutboundRegisterExportRequest,
): Promise<ApiResult<OutboundRegisterExportResult>> {
  return apiHub.post<
    OutboundRegisterExportResult,
    OutboundRegisterExportRequest
  >(OUTBOUND_REGISTER_ACTION_URL, payload, {
    responseType: "blob",
  });
}

/* ───────────────────────────────────────────────
 * 5. 출고 처리(outbound-process)
 *    - GET  /api/outbound/process/ping
 *    - GET  /api/outbound/process/invoice/{invoiceNo}
 *    - POST /api/outbound/process/scan
 *    - POST /api/outbound/process/weight
 *    - POST /api/outbound/process/confirm
 *    - GET  /api/outbound/process/state/{invoiceNo}
 * ─────────────────────────────────────────────── */

/** 핑 응답 */
export interface OutboundProcessPingResponse {
  page: string;
  version: string;
  stage: string;
}

/** 송장 품목 로드 result */
export interface OutboundProcessInvoiceItem {
  item_id: number;
  sku: string;
  qty: number;
  scanned_qty: number;
  status: string;
}

export interface OutboundProcessInvoiceSummary {
  total_qty: number;
  total_scanned: number;
}

export interface OutboundProcessInvoiceResult {
  invoice_no: string;
  header_id: number;
  status: string;
  weight_g: number | null;
  overall_status: string | null;
  items: OutboundProcessInvoiceItem[];
  summary: OutboundProcessInvoiceSummary;
}

/** 스캔 요청/응답 */
export interface OutboundProcessScanRequest {
  invoice_no: string;
  barcode: string;
}

export interface OutboundProcessScanItem {
  item_id: number;
  sku: string;
  qty: number;
  scanned_qty: number;
  status: string;
}

export interface OutboundProcessScanResult {
  invoice_no: string;
  header_id: number;
  item: OutboundProcessScanItem;
}

/** 중량 설정 요청/응답 */
export interface OutboundProcessWeightRequest {
  invoice_no: string;
  weight_g: number;
}

export interface OutboundProcessWeightResult {
  invoice_no: string;
  header_id: number;
  weight_g: number;
}

/** 확정 요청/응답 */
export interface OutboundProcessConfirmRequest {
  invoice_no: string;
}

export interface OutboundProcessConfirmResult {
  invoice_no: string;
  header_id: number;
  status: string;
}

/** 상태 조회 result */
export interface OutboundProcessStateSummary {
  total_qty: number;
  total_scanned: number;
}

export interface OutboundProcessStateResult {
  invoice_no: string;
  header_id: number;
  status: string;
  overall_status: string | null;
  weight_g: number | null;
  summary: OutboundProcessStateSummary;
}

/* 엔드포인트 상수 */

const OUTBOUND_PROCESS_PING_URL = "/api/outbound/process/ping";
const OUTBOUND_PROCESS_INVOICE_URL = "/api/outbound/process/invoice";
const OUTBOUND_PROCESS_SCAN_URL = "/api/outbound/process/scan";
const OUTBOUND_PROCESS_WEIGHT_URL = "/api/outbound/process/weight";
const OUTBOUND_PROCESS_CONFIRM_URL = "/api/outbound/process/confirm";
const OUTBOUND_PROCESS_STATE_URL = "/api/outbound/process/state";

/* 함수 구현 */

async function pingProcess(): Promise<
  ApiResult<OutboundProcessPingResponse>
> {
  return apiHub.get<OutboundProcessPingResponse>(
    OUTBOUND_PROCESS_PING_URL,
  );
}

async function fetchProcessInvoice(
  invoiceNo: string,
): Promise<ApiResult<ActionEnvelope<OutboundProcessInvoiceResult>>> {
  return apiHub.get<ActionEnvelope<OutboundProcessInvoiceResult>>(
    `${OUTBOUND_PROCESS_INVOICE_URL}/${encodeURIComponent(invoiceNo)}`,
  );
}

async function scanProcessItem(
  payload: OutboundProcessScanRequest,
): Promise<ApiResult<ActionEnvelope<OutboundProcessScanResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundProcessScanResult>,
    OutboundProcessScanRequest
  >(OUTBOUND_PROCESS_SCAN_URL, payload);
}

async function setProcessWeight(
  payload: OutboundProcessWeightRequest,
): Promise<ApiResult<ActionEnvelope<OutboundProcessWeightResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundProcessWeightResult>,
    OutboundProcessWeightRequest
  >(OUTBOUND_PROCESS_WEIGHT_URL, payload);
}

async function confirmProcess(
  payload: OutboundProcessConfirmRequest,
): Promise<ApiResult<ActionEnvelope<OutboundProcessConfirmResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundProcessConfirmResult>,
    OutboundProcessConfirmRequest
  >(OUTBOUND_PROCESS_CONFIRM_URL, payload);
}

async function fetchProcessState(
  invoiceNo: string,
): Promise<ApiResult<ActionEnvelope<OutboundProcessStateResult>>> {
  return apiHub.get<ActionEnvelope<OutboundProcessStateResult>>(
    `${OUTBOUND_PROCESS_STATE_URL}/${encodeURIComponent(invoiceNo)}`,
  );
}

/* ───────────────────────────────────────────────
 * 6. 출고 완료(outbound-complete)
 *    - GET  /api/outbound/complete/ping
 *    - GET  /api/outbound/complete/list
 *    - POST /api/outbound/complete/export
 *    - POST /api/outbound/complete/cancel
 * ─────────────────────────────────────────────── */

/** 출고 완료 핑 응답 */
export interface OutboundCompletePingResponse {
  page: "outbound.complete";
  version: string;
  stage: string;
}

/** 출고 완료 목록 아이템 */
export interface OutboundCompleteItem {
  header_id: number;
  item_id: number;
  outbound_date: string; // "2025-12-01"
  country: string;
  order_number: string;
  tracking_number: string;
  sku: string;
  product_name: string;
  qty: number;
  weight_g: number;
  sales_total: number;
}

/** 출고 완료 목록 result */
export interface OutboundCompleteListResult {
  items: OutboundCompleteItem[];
  count: number;
  order_count: number;
  page: number;
  size: number;
}

/** 출고 완료 목록 조회 쿼리 */
export interface OutboundCompleteListQuery {
  from_date?: string; // YYYY-MM-DD
  to_date?: string;   // YYYY-MM-DD
  q?: string;         // 국가/주문번호/트래킹번호/SKU/상품명
  page?: number;      // 1부터
  size?: number;      // 페이지 크기
  sort_by?: string;   // outbound_date, country 등
  sort_dir?: "asc" | "desc";
}

/** 출고 완료 엑셀 내보내기 요청 */
export interface OutboundCompleteExportRequestDto {
  ids: number[];
}

/** 출고 완료 엑셀 내보내기 결과 */
export interface OutboundCompleteExportResult {
  file_name: string;
  content_type: string;
  content_base64: string;
  count: number;
}

/** 출고 완료 출고취소 요청 */
export interface OutboundCompleteCancelRequestDto {
  ids: number[];
  reason: string;
}

/** 출고 완료 출고취소 결과 */
export interface OutboundCompleteCancelResult {
  ids: number[];
  header_id: number;
  order_number: string;
  item_count: number;
  action: "cancel";
}

/* 출고 완료 엔드포인트 상수 */

const OUTBOUND_COMPLETE_PING_URL = "/api/outbound/complete/ping";
const OUTBOUND_COMPLETE_LIST_URL = "/api/outbound/complete/list";
const OUTBOUND_COMPLETE_EXPORT_URL = "/api/outbound/complete/export";
const OUTBOUND_COMPLETE_CANCEL_URL = "/api/outbound/complete/cancel";

/* 출고 완료 함수 구현 */

async function pingComplete(): Promise<
  ApiResult<OutboundCompletePingResponse>
> {
  return apiHub.get<OutboundCompletePingResponse>(
    OUTBOUND_COMPLETE_PING_URL,
  );
}

async function fetchCompleteList(
  params: OutboundCompleteListQuery,
): Promise<ApiResult<ActionEnvelope<OutboundCompleteListResult>>> {
  return apiHub.get<ActionEnvelope<OutboundCompleteListResult>>(
    OUTBOUND_COMPLETE_LIST_URL,
    { params },
  );
}

async function exportComplete(
  payload: OutboundCompleteExportRequestDto,
): Promise<ApiResult<ActionEnvelope<OutboundCompleteExportResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundCompleteExportResult>,
    OutboundCompleteExportRequestDto
  >(OUTBOUND_COMPLETE_EXPORT_URL, payload);
}

async function cancelComplete(
  payload: OutboundCompleteCancelRequestDto,
): Promise<ApiResult<ActionEnvelope<OutboundCompleteCancelResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundCompleteCancelResult>,
    OutboundCompleteCancelRequestDto
  >(OUTBOUND_COMPLETE_CANCEL_URL, payload);
}

/* ───────────────────────────────────────────────
 * 7. 출고 취소(outbound-cancel)
 *    - GET  /api/outbound/cancel/ping
 *    - GET  /api/outbound/cancel/list
 *    - POST /api/outbound/cancel/reissue
 *    - GET  /api/outbound/cancel/export
 * ─────────────────────────────────────────────── */

/** 출고 취소 핑 응답 */
export interface OutboundCancelPingResponse {
  page: "outbound.cancel";
  version: string;
  stage: string;
}

/** 출고 취소 목록 필터 */
export interface OutboundCancelListFilters {
  date_from: string | null;
  date_to: string | null;
}

/** 출고 취소 목록 페이지네이션 */
export interface OutboundCancelListPagination {
  page: number;
  size: number;
  count: number;
}

/** 출고 취소 목록 아이템 */
export interface OutboundCancelListItem {
  header_id: number;
  item_id: number;
  country: string;
  order_number: string;
  tracking_number: string;
  sku: string;
  product_name: string;
  qty: number;
  total_price: number;
}

/** 출고 취소 목록 result */
export interface OutboundCancelListResult {
  page_id: "outbound.cancel";
  page_version: string;
  filters: OutboundCancelListFilters;
  pagination: OutboundCancelListPagination;
  items: OutboundCancelListItem[];
}

/** 출고 취소 목록 조회 쿼리 */
export interface OutboundCancelListQuery {
  from_date?: string;
  to_date?: string;
  page?: number;
  size?: number;
}

/** 출고 취소 → 재출고 요청 */
export interface OutboundCancelReissueRequestDto {
  header_ids: number[];
  action: "reissue";
}

/** 출고 취소 → 재출고 결과 */
export interface OutboundCancelReissueResult {
  action: "reissue";
  source_header_id: number;
  new_header_id: number;
  order_number: string;
  item_count: number;
}

/** 출고 취소 엑셀 다운로드 쿼리 */
export interface OutboundCancelExportQuery {
  from_date?: string;
  to_date?: string;
  /** 서버 스펙: 쿼리 문자열, 예: "1,2,3" */
  header_ids?: string;
}

/** 출고 취소 엑셀 응답: Blob */
export type OutboundCancelExportResult = Blob;

/* 출고 취소 엔드포인트 상수 */

const OUTBOUND_CANCEL_PING_URL = "/api/outbound/cancel/ping";
const OUTBOUND_CANCEL_LIST_URL = "/api/outbound/cancel/list";
const OUTBOUND_CANCEL_REISSUE_URL = "/api/outbound/cancel/reissue";
const OUTBOUND_CANCEL_EXPORT_URL = "/api/outbound/cancel/export";

/* 출고 취소 함수 구현 */

async function pingCancel(): Promise<
  ApiResult<OutboundCancelPingResponse>
> {
  return apiHub.get<OutboundCancelPingResponse>(
    OUTBOUND_CANCEL_PING_URL,
  );
}

async function fetchCancelList(
  params: OutboundCancelListQuery,
): Promise<ApiResult<ActionEnvelope<OutboundCancelListResult>>> {
  return apiHub.get<ActionEnvelope<OutboundCancelListResult>>(
    OUTBOUND_CANCEL_LIST_URL,
    { params },
  );
}

async function reissueFromCancel(
  payload: OutboundCancelReissueRequestDto,
): Promise<ApiResult<ActionEnvelope<OutboundCancelReissueResult>>> {
  return apiHub.post<
    ActionEnvelope<OutboundCancelReissueResult>,
    OutboundCancelReissueRequestDto
  >(OUTBOUND_CANCEL_REISSUE_URL, payload);
}

async function exportCancelExcel(
  params: OutboundCancelExportQuery,
): Promise<ApiResult<OutboundCancelExportResult>> {
  return apiHub.get<OutboundCancelExportResult>(
    OUTBOUND_CANCEL_EXPORT_URL,
    {
      params,
      responseType: "blob",
    },
  );
}

/* ───────────────────────────────────────────────
 * 8. 공통 SKU 단건 조회 (상품명/바코드 보강)
 *    GET /api/products/register/lookup-by-sku
 * ─────────────────────────────────────────────── */

export interface ProductLookupBySkuResult {
  sku: string;
  name: string;
  last_inbound_price: string | null;
  weight: string | null;
  barcode: string | null;
  is_bundle_related: boolean;
}

const PRODUCT_LOOKUP_BY_SKU_URL = "/api/products/register/lookup-by-sku";

async function lookupProductBySku(
  sku: string,
): Promise<ApiResult<ProductLookupBySkuResult>> {
  return apiHub.get<ProductLookupBySkuResult>(
    PRODUCT_LOOKUP_BY_SKU_URL,
    { params: { sku } },
  );
}

/* ───────────────────────────────────────────────
 * 9. 어댑터 export
 * ─────────────────────────────────────────────── */

export const outboundAdapter = {
  // 출고 등록 - 등록 탭
  pingRegisterForm,
  registerForm,

  // 출고 등록 - 조회 탭
  fetchRegisterList,
  updateRegisterItem,
  deleteRegisterItems,
  exportRegisterItems,

  // 출고 처리 - process
  pingProcess,
  fetchProcessInvoice,
  scanProcessItem,
  setProcessWeight,
  confirmProcess,
  fetchProcessState,

  // 출고 완료 - complete
  pingComplete,
  fetchCompleteList,
  exportComplete,
  cancelComplete,

  // 출고 취소 - cancel
  pingCancel,
  fetchCancelList,
  reissueFromCancel,
  exportCancelExcel,

  // 공통 SKU 조회
  lookupProductBySku,
} as const;

export type OutboundAdapter = typeof outboundAdapter;
