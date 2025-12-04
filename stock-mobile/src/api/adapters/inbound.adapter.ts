/* 📄 src/api/adapters/inbound.adapter.ts
   도메인: 입고관리(inbound)

   역할:
   - 등록탭(inbound-register-form)
   - 조회탭(inbound-register-query)
   - 입고 완료(inbound-complete)
   - 입고 처리(inbound-process)
   - 공통 상품 SKU 조회

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
 * 1. 입고 등록(등록 탭)
 *    POST /api/inbound/register-form
 * ─────────────────────────────────────────────── */

export interface InboundRegisterFormItemDto {
  order_date: string; // YYYYMMDD
  sku: string;
  name: string;
  qty: number;
  total_price: number;
  unit_price: number;
  supplier_name: string;
  memo: string;
}

export interface InboundRegisterFormRequestDto {
  items: InboundRegisterFormItemDto[];
}

export interface InboundRegisterCreatedItem {
  id: number;
  order_no: string;
  order_date: string; // YYYY-MM-DD
  supplier_name: string;
  sku: string;
  qty: number;
  unit_price: number;
  total_price: number;
  status: string;
}

export interface InboundRegisterSummary {
  count: number;
  total_qty: number;
  total_amount: number;
}

export interface InboundRegisterFormResult {
  page_id: string;
  page_version: string;
  created: InboundRegisterCreatedItem[];
  summary: InboundRegisterSummary;
}

/* ───────────────────────────────────────────────
 * 1-2. SKU 단건 조회
 *    GET /api/products/register/lookup-by-sku
 * ─────────────────────────────────────────────── */

export interface ProductLookupBySkuItemDto {
  sku: string;
  name: string;
  last_inbound_price: string | null;
  weight: string | null;
  barcode: string | null;
  is_bundle_related: boolean;
}

export interface ProductLookupBySkuResultDto {
  ok: boolean;
  item: ProductLookupBySkuItemDto | null;
}

/* ───────────────────────────────────────────────
 * 2. 입고등록 조회탭
 *    GET /api/inbound/register/query/list
 * ─────────────────────────────────────────────── */

export interface InboundRegisterQueryListItemDto {
  header_id: number;
  item_id: number;
  order_no: string;
  order_date: string;
  sku: string;
  name: string;
  qty: number;
  unit_price: number;
  total_price: number;
  supplier_name: string;
  status: string;
  barcode?: string | null; // ✅ 바코드(있을 수도, 없을 수도)
}

export interface InboundRegisterQueryListSummaryDto {
  count: number;
  total_qty: number;
  total_amount: number;
}

export interface InboundRegisterQueryListPaginationDto {
  page: number;
  size: number;
  count: number;
}

export interface InboundRegisterQueryListResultDto {
  page_id: string;
  page_version: string;
  filters: {
    date_from: string | null;
    date_to: string | null;
    keyword: string | null;
  };
  pagination: InboundRegisterQueryListPaginationDto;
  items: InboundRegisterQueryListItemDto[];
  summary: InboundRegisterQueryListSummaryDto;
}

export interface InboundRegisterQueryListParams {
  date_from?: string;
  date_to?: string;
  keyword?: string;
  page?: number;
  size?: number;
  sort_key?: string;
  sort_dir?: "ASC" | "DESC";
}

/* ───────────────────────────────────────────────
 * 3. 입고등록 수정/삭제
 * ─────────────────────────────────────────────── */

export interface InboundRegisterQueryUpdateRequestDto {
  item_id: number;
  qty: number;
  total_price: number;
  supplier_name?: string;
}

export interface InboundRegisterQueryUpdateResultDto {
  ok: boolean;
}

export interface InboundRegisterQueryDeleteRequestDto {
  item_ids: number[];
}

export interface InboundRegisterQueryDeleteResultDto {
  ok: boolean;
  deleted_count: number;
}

/* ───────────────────────────────────────────────
 * 4. 입고 완료(inbound-complete)
 *    GET  /api/inbound/complete/ping
 *    GET  /api/inbound/complete/list
 *    POST /api/inbound/complete/update
 *    POST /api/inbound/complete/delete
 *    POST /api/inbound/complete/export-xlsx
 * ─────────────────────────────────────────────── */

/** ping 응답 */
export interface InboundCompletePingDto {
  page: string;
  version: string;
  stage: string;
}

/** 목록 조회 item */
export interface InboundCompleteListItemDto {
  item_id: number;
  inbound_date: string | null;
  sku: string;
  product_name: string;
  qty: number;
  total_price: string;
  unit_price: string;
  supplier_name: string;
}

/** 목록 조회 result */
export interface InboundCompleteListResultDto {
  items: InboundCompleteListItemDto[];
  count: number;
  page: number;
  size: number;
}

/** 목록 조회 query 파라미터 */
export interface InboundCompleteListParams {
  start_date?: string | null;
  end_date?: string | null;
  keyword?: string | null;
  page?: number;
  size?: number;
}

/** 단건 수정 요청 */
export interface InboundCompleteUpdateRequestDto {
  item_id: number;
  qty?: number;
  total_price?: number;
  unit_price?: number;
  inbound_date?: string; // YYYY-MM-DD
  supplier_name?: string;
}

/** 단건 수정 결과 */
export type InboundCompleteUpdateResultDto = unknown;

/** 다건 삭제 요청 */
export interface InboundCompleteDeleteRequestDto {
  item_ids: number[];
}

/** 다건 삭제 결과 */
export type InboundCompleteDeleteResultDto = unknown;

/** 엑셀 다운로드 요청 */
export interface InboundCompleteExportXlsxRequestDto {
  item_ids: number[];
}

/** 엑셀 다운로드 결과 */
export type InboundCompleteExportXlsxResultDto = unknown;

/* ───────────────────────────────────────────────
 * 5. [입고 처리 - inbound-process]
 *    GET  /ping
 *    POST /scan
 *    POST /register-barcode
 *    POST /set-qty
 *    POST /confirm
 * ─────────────────────────────────────────────── */

/* 5-1) ping */
export interface InboundProcessPingDto {
  page: string;
  version: string;
  stage: string;
}

/* 5-2) scan */
export interface InboundProcessScanResult {
  sku: string;
  barcode: string;
  name: string;
  brand: string | null;
  category: string | null;
  last_inbound_unit_price: string | null;
  last_inbound_date: string | null;
  is_active: boolean;
}

export interface InboundProcessScanResponseDto {
  result: InboundProcessScanResult;
}

/* 5-3) register-barcode */
export interface InboundProcessRegisterBarcodeRequestDto {
  barcode: string;
  sku: string;
  name: string | null;
}

export interface InboundProcessRegisterBarcodeResult {
  sku: string;
  barcode: string;
  name: string;
}

export interface InboundProcessRegisterBarcodeResponseDto {
  result: InboundProcessRegisterBarcodeResult;
}

/* 5-4) set-qty */
export interface InboundProcessSetQtyRequestDto {
  sku: string;
  qty: number;
}

export interface InboundProcessSetQtyResultDto {
  sku: string;
  name: string;
  qty: number;
}

export interface InboundProcessSetQtyResponseDto {
  result: InboundProcessSetQtyResultDto;
}

/* 5-5) confirm */
export interface InboundProcessConfirmItemDto {
  item_id: number;
  sku: string;
  qty: number;
}

export interface InboundProcessConfirmRequestDto {
  header_id: number;
  items: InboundProcessConfirmItemDto[];
  operator: string;
}

export interface InboundProcessConfirmResultDto {
  header_id: number;
  confirmed_count: number;
  total_qty: number;
  operator: string;
}

export interface InboundProcessConfirmResponseDto {
  result: InboundProcessConfirmResultDto;
}

/* ───────────────────────────────────────────────
 * 6. Endpoint 정의
 * ─────────────────────────────────────────────── */

const INBOUND_REGISTER_FORM_CREATE_URL = "/api/inbound/register-form";
const PRODUCT_LOOKUP_BY_SKU_URL = "/api/products/register/lookup-by-sku";
const INBOUND_REGISTER_QUERY_LIST_URL = "/api/inbound/register/query/list";
const INBOUND_REGISTER_QUERY_UPDATE_URL = "/api/inbound/register/query/update";
const INBOUND_REGISTER_QUERY_DELETE_URL = "/api/inbound/register/query/delete";

const INBOUND_COMPLETE_PING_URL = "/api/inbound/complete/ping";
const INBOUND_COMPLETE_LIST_URL = "/api/inbound/complete/list";
const INBOUND_COMPLETE_UPDATE_URL = "/api/inbound/complete/update";
const INBOUND_COMPLETE_DELETE_URL = "/api/inbound/complete/delete";
const INBOUND_COMPLETE_EXPORT_XLSX_URL = "/api/inbound/complete/export-xlsx";

const INBOUND_PROCESS_PING_URL = "/api/inbound/process/ping";
const INBOUND_PROCESS_SCAN_URL = "/api/inbound/process/scan";
const INBOUND_PROCESS_REGISTER_BARCODE_URL =
  "/api/inbound/process/register-barcode";
const INBOUND_PROCESS_SET_QTY_URL = "/api/inbound/process/set-qty";
const INBOUND_PROCESS_CONFIRM_URL = "/api/inbound/process/confirm";

/* ───────────────────────────────────────────────
 * 7. 어댑터 함수 - 입고등록 / 조회탭
 * ─────────────────────────────────────────────── */

/** 등록탭 생성 */
async function registerFormCreate(
  payload: InboundRegisterFormRequestDto
): Promise<ApiResult<InboundRegisterFormResult>> {
  return apiHub.post<InboundRegisterFormResult, InboundRegisterFormRequestDto>(
    INBOUND_REGISTER_FORM_CREATE_URL,
    payload
  );
}

/** SKU 조회 */
async function lookupProductBySku(
  sku: string
): Promise<ApiResult<ProductLookupBySkuResultDto>> {
  return apiHub.get<ProductLookupBySkuResultDto>(PRODUCT_LOOKUP_BY_SKU_URL, {
    params: { sku },
  });
}

/** 조회탭 리스트 */
async function registerQueryList(
  params: InboundRegisterQueryListParams
): Promise<ApiResult<InboundRegisterQueryListResultDto>> {
  return apiHub.get<InboundRegisterQueryListResultDto>(
    INBOUND_REGISTER_QUERY_LIST_URL,
    { params }
  );
}

/** 조회탭 수정 */
async function registerQueryUpdate(
  payload: InboundRegisterQueryUpdateRequestDto
): Promise<ApiResult<InboundRegisterQueryUpdateResultDto>> {
  return apiHub.post<
    InboundRegisterQueryUpdateResultDto,
    InboundRegisterQueryUpdateRequestDto
  >(INBOUND_REGISTER_QUERY_UPDATE_URL, payload);
}

/** 조회탭 삭제 */
async function registerQueryDelete(
  payload: InboundRegisterQueryDeleteRequestDto
): Promise<ApiResult<InboundRegisterQueryDeleteResultDto>> {
  return apiHub.post<
    InboundRegisterQueryDeleteResultDto,
    InboundRegisterQueryDeleteRequestDto
  >(INBOUND_REGISTER_QUERY_DELETE_URL, payload);
}

/* ───────────────────────────────────────────────
 * 8. 어댑터 함수 - 입고 완료(inbound-complete)
 * ─────────────────────────────────────────────── */

/** 입고완료 ping */
async function completePing(): Promise<ApiResult<InboundCompletePingDto>> {
  return apiHub.get<InboundCompletePingDto>(INBOUND_COMPLETE_PING_URL);
}

/** 입고완료 목록 조회 */
async function completeList(
  params: InboundCompleteListParams
): Promise<ApiResult<InboundCompleteListResultDto>> {
  return apiHub.get<InboundCompleteListResultDto>(INBOUND_COMPLETE_LIST_URL, {
    params,
  });
}

/** 입고완료 단건 수정 */
async function completeUpdate(
  payload: InboundCompleteUpdateRequestDto
): Promise<ApiResult<InboundCompleteUpdateResultDto>> {
  return apiHub.post<
    InboundCompleteUpdateResultDto,
    InboundCompleteUpdateRequestDto
  >(INBOUND_COMPLETE_UPDATE_URL, payload);
}

/** 입고완료 다건 삭제 */
async function completeDelete(
  payload: InboundCompleteDeleteRequestDto
): Promise<ApiResult<InboundCompleteDeleteResultDto>> {
  return apiHub.post<
    InboundCompleteDeleteResultDto,
    InboundCompleteDeleteRequestDto
  >(INBOUND_COMPLETE_DELETE_URL, payload);
}

/** 입고완료 선택항목 엑셀 다운로드 */
async function completeExportXlsx(
  payload: InboundCompleteExportXlsxRequestDto
): Promise<ApiResult<InboundCompleteExportXlsxResultDto>> {
  return apiHub.post<
    InboundCompleteExportXlsxResultDto,
    InboundCompleteExportXlsxRequestDto
  >(INBOUND_COMPLETE_EXPORT_XLSX_URL, payload);
}

/* ───────────────────────────────────────────────
 * 9. 어댑터 함수 - 입고처리 API
 * ─────────────────────────────────────────────── */

/** ping */
async function processPing(): Promise<ApiResult<InboundProcessPingDto>> {
  return apiHub.get<InboundProcessPingDto>(INBOUND_PROCESS_PING_URL);
}

/** scan */
async function processScan(
  payload: { barcode: string }
): Promise<ApiResult<InboundProcessScanResponseDto>> {
  return apiHub.post<InboundProcessScanResponseDto, { barcode: string }>(
    INBOUND_PROCESS_SCAN_URL,
    payload
  );
}

/** register-barcode (입고처리 내부용) */
async function processRegisterBarcode(
  payload: InboundProcessRegisterBarcodeRequestDto
): Promise<ApiResult<InboundProcessRegisterBarcodeResponseDto>> {
  return apiHub.post<
    InboundProcessRegisterBarcodeResponseDto,
    InboundProcessRegisterBarcodeRequestDto
  >(INBOUND_PROCESS_REGISTER_BARCODE_URL, payload);
}

/** register-barcode (바코드 등록 페이지에서 사용) */
async function registerBarcode(
  payload: InboundProcessRegisterBarcodeRequestDto
): Promise<ApiResult<InboundProcessRegisterBarcodeResponseDto>> {
  return apiHub.post<
    InboundProcessRegisterBarcodeResponseDto,
    InboundProcessRegisterBarcodeRequestDto
  >(INBOUND_PROCESS_REGISTER_BARCODE_URL, payload);
}

/** set-qty */
async function processSetQty(
  payload: InboundProcessSetQtyRequestDto
): Promise<ApiResult<InboundProcessSetQtyResponseDto>> {
  return apiHub.post<
    InboundProcessSetQtyResponseDto,
    InboundProcessSetQtyRequestDto
  >(INBOUND_PROCESS_SET_QTY_URL, payload);
}

/** confirm */
async function processConfirm(
  payload: InboundProcessConfirmRequestDto
): Promise<ApiResult<InboundProcessConfirmResponseDto>> {
  return apiHub.post<
    InboundProcessConfirmResponseDto,
    InboundProcessConfirmRequestDto
  >(INBOUND_PROCESS_CONFIRM_URL, payload);
}

/* ───────────────────────────────────────────────
 * 10. export
 * ─────────────────────────────────────────────── */

export const inboundAdapter = {
  // 입고등록
  registerFormCreate,
  lookupProductBySku,

  // 조회탭
  registerQueryList,
  registerQueryUpdate,
  registerQueryDelete,

  // 입고완료
  completePing,
  completeList,
  completeUpdate,
  completeDelete,
  completeExportXlsx,

  // 입고처리
  processPing,
  processScan,
  processRegisterBarcode,
  registerBarcode, // 바코드 등록 페이지용
  processSetQty,
  processConfirm,
} as const;

export type InboundAdapter = typeof inboundAdapter;
