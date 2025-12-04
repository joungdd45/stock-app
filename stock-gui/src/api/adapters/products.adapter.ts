/* 📄 src/api/adapters/products.adapter.ts
   도메인: 상품관리(product.register)
   역할:
   - 상품등록 페이지에서 사용할 API 호출 모음
   - 허브(apiHub)를 통해 백엔드와 통신
   - 페이지에서는 이 어댑터만 사용
*/

import { apiHub, type ApiResult } from "@/api/hub/apiHub";

/* ─────────────────────────────────────────────
   엔드포인트 상수
─────────────────────────────────────────────*/

const PRODUCTS_PING_URL = "/api/products/register/ping";
const PRODUCTS_LIST_URL = "/api/products/register/list";
const PRODUCTS_CREATE_URL = "/api/products/register/create";
const PRODUCTS_UPDATE_BASE_URL = "/api/products/register";
const PRODUCTS_DELETE_URL = "/api/products/register/delete";
const PRODUCTS_BUNDLE_URL = "/api/products/register/bundle-mapping";
const PRODUCTS_BULK_URL = "/api/products/register/bulk";

/* ─────────────────────────────────────────────
   타입 정의
─────────────────────────────────────────────*/

export type ProductListItem = {
  id?: string | number;
  sku: string;
  name: string;
  unit_price: number;
  weight_g: number | null;
  barcode: string | null;
  status: boolean;
  bundle_qty: number;
};

export type ProductListResponse = {
  items: ProductListItem[];
};

export type ProductCreatePayload = {
  sku: string;
  name: string;
  barcode: string;
  status: boolean;
  unit_price: number;
  weight_g: number;
  bundle_qty: number;
};

export type ProductUpdatePayload = {
  name?: string;
  barcode?: string;
  weight_g?: number;
};

type ProductPingResponse = {
  ok: boolean;
  page?: string;
  version?: string;
  stage?: string;
};

type ProductCreateResult = {
  ok: boolean;
};

type ProductUpdateResult = {
  ok: boolean;
};

type ProductDeletePayload = {
  ids: string[];
};

type ProductDeleteResult = {
  ok: boolean;
  deleted?: number;
};

type ProductBundleUpdatePayload = {
  ids: string[];
  bundle_qty: number;
};

type ProductBundleUpdateResult = {
  ok: boolean;
  updated?: number;
};

type ProductBulkUploadPayload = {
  text: string;
};

type ProductBulkUploadResult = {
  ok: boolean;
  count: number;
};

/* ─────────────────────────────────────────────
   어댑터 함수 구현
─────────────────────────────────────────────*/

async function ping(): Promise<ApiResult<ProductPingResponse>> {
  return apiHub.get<ProductPingResponse>(PRODUCTS_PING_URL);
}

async function fetchList(): Promise<ApiResult<ProductListResponse>> {
  return apiHub.get<ProductListResponse>(PRODUCTS_LIST_URL);
}

async function createOne(
  payload: ProductCreatePayload,
): Promise<ApiResult<ProductCreateResult>> {
  return apiHub.post<ProductCreateResult>(PRODUCTS_CREATE_URL, payload);
}

async function updateOne(
  sku: string,
  payload: ProductUpdatePayload,
): Promise<ApiResult<ProductUpdateResult>> {
  const url = `${PRODUCTS_UPDATE_BASE_URL}/${encodeURIComponent(sku)}`;
  return apiHub.patch<ProductUpdateResult>(url, payload);
}

async function deleteItems(
  ids: string[],
): Promise<ApiResult<ProductDeleteResult>> {
  const body: ProductDeletePayload = { ids };
  // ⚠ 여기서 두 번째 인자는 AxiosRequestConfig 타입이기 때문에 data로 감싸서 전달
  return apiHub.delete<ProductDeleteResult>(PRODUCTS_DELETE_URL, {
    data: body,
  });
}

async function updateBundleMany(
  ids: string[],
  bundleQty: number,
): Promise<ApiResult<ProductBundleUpdateResult>> {
  const body: ProductBundleUpdatePayload = {
    ids,
    bundle_qty: bundleQty,
  };
  return apiHub.post<ProductBundleUpdateResult>(PRODUCTS_BUNDLE_URL, body);
}

async function bulkUploadFromText(
  text: string,
): Promise<ApiResult<ProductBulkUploadResult>> {
  const body: ProductBulkUploadPayload = { text };
  return apiHub.post<ProductBulkUploadResult>(PRODUCTS_BULK_URL, body);
}

/* ─────────────────────────────────────────────
   export
─────────────────────────────────────────────*/

export const productsAdapter = {
  ping,
  fetchList,
  createOne,
  deleteItems,
  updateBundleMany,
  updateOne,
  bulkUploadFromText,
} as const;

export type ProductsAdapter = typeof productsAdapter;
