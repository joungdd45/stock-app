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
  status?: boolean; // ← 구버전 호환용
  is_active?: boolean; // ← 신규 활성 여부
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
  is_active?: boolean;
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

/* 📌 묶음설정(bundle-mapping) 전용 타입 */

export type BundleMappingItem = {
  component_sku: string;
  component_qty: number;
};

export type BundleMappingPayload = {
  bundle_sku: string;
  items: BundleMappingItem[];
};

type BundleMappingResult = {
  ok: boolean;
};

/**
 * ✅ bulk rows (백엔드 DTO에 맞춤)
 * backend BulkRowDTO:
 *  - sku (필수)
 *  - name (필수)
 *  - barcode (옵션)
 *  - weight (옵션)  <-- 템플릿의 weight_g를 여기로 매핑
 *  - last_inbound_price (옵션) <-- 템플릿의 unit_price를 여기로 매핑
 */
export type ProductBulkRow = {
  sku: string;
  name: string;
  barcode?: string | null;
  weight?: number | null;
  last_inbound_price?: number | null;
};

type ProductBulkUploadPayload = {
  rows: ProductBulkRow[];
};

type ProductBulkUploadResult = {
  ok: boolean;
  count: number;
};

/* ─────────────────────────────────────────────
   내부 유틸: CSV 파싱(간단/안전)
─────────────────────────────────────────────*/

function toNum(v: string): number {
  const cleaned = String(v ?? "").trim().replace(/[^\d.]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function splitCsvLine(line: string): string[] {
  // 따옴표 포함 CSV 최소 지원
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out.map((s) => s.trim());
}

function csvTextToBulkRows(text: string): ProductBulkRow[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];

  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];

  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  const idx = (key: string) => header.indexOf(key);

  const iSku = idx("sku");
  const iName = idx("name");
  const iBarcode = idx("barcode");

  // CreatePage에서 만든 헤더 기준
  const iWeightG = idx("weight_g");
  const iUnitPrice = idx("unit_price");

  if (iSku === -1 || iName === -1) return [];

  const rows: ProductBulkRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);

    const sku = String(cols[iSku] ?? "").trim();
    const name = String(cols[iName] ?? "").trim();
    if (!sku || !name) continue;

    const barcode = iBarcode >= 0 ? String(cols[iBarcode] ?? "").trim() : "";
    const weight = iWeightG >= 0 ? toNum(String(cols[iWeightG] ?? "")) : 0;
    const last_inbound_price =
      iUnitPrice >= 0 ? toNum(String(cols[iUnitPrice] ?? "")) : 0;

    rows.push({
      sku,
      name,
      barcode: barcode ? barcode : null,
      weight: Number.isFinite(weight) ? weight : 0,
      last_inbound_price: Number.isFinite(last_inbound_price)
        ? last_inbound_price
        : 0,
    });
  }

  return rows;
}

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

async function deleteItems(ids: string[]): Promise<ApiResult<ProductDeleteResult>> {
  const body: ProductDeletePayload = { ids };
  // 두 번째 인자는 AxiosRequestConfig 타입이므로 data로 감싸서 전달
  return apiHub.delete<ProductDeleteResult>(PRODUCTS_DELETE_URL, {
    data: body,
  });
}

/**
 * 📌 묶음설정 저장
 * - 항상 전체 replace
 */
async function updateBundleMapping(
  payload: BundleMappingPayload,
): Promise<ApiResult<BundleMappingResult>> {
  return apiHub.post<BundleMappingResult>(PRODUCTS_BUNDLE_URL, payload);
}

/**
 * ✅ 대량등록
 * - 기존: { text } 전송 → 백엔드에서 rows missing 에러
 * - 변경: CSV(text) → rows[]로 변환해서 { rows } 전송
 */
async function bulkUploadFromText(
  text: string,
): Promise<ApiResult<ProductBulkUploadResult>> {
  const rows = csvTextToBulkRows(text);

  const body: ProductBulkUploadPayload = { rows };

  // rows가 비었으면 프론트에서 바로 막아도 되지만, 여기서도 안전하게 처리
  if (!rows.length) {
    return {
      ok: false,
      error: {
        code: "FRONT-PRODUCT-BULK-INVALID-001",
        message: "대량등록 데이터가 비어있어요. (sku/name 확인)",
        detail: "대량등록 데이터가 비어있어요. (sku/name 확인)",
        traceId: null,
      } as any,
      data: null as any,
    } as any;
  }

  // 백엔드 응답은 ActionResponse 형태일 수 있으니,
  // apiHub가 이미 result를 풀어주지 않는 경우를 대비해 후처리까지 겸함
  const res = await apiHub.post<any>(PRODUCTS_BULK_URL, body);
  if (!res.ok) return res as any;

  const payload = res.data as any;

  // 케이스1) apiHub가 이미 result를 언랩해줌: { ok, count }
  if (payload?.count !== undefined) {
    return res as ApiResult<ProductBulkUploadResult>;
  }

  // 케이스2) ActionResponse: { data: { result: {...} } }
  const r = payload?.data?.result ?? payload?.result ?? payload;
  const count =
    r?.count ??
    r?.created ??
    (Array.isArray(r?.items) ? r.items.length : rows.length) ??
    rows.length;

  return {
    ...res,
    data: {
      ok: r?.ok ?? true,
      count: Number(count) || 0,
    },
  } as ApiResult<ProductBulkUploadResult>;
}

/* ─────────────────────────────────────────────
   export
─────────────────────────────────────────────*/

export const productsAdapter = {
  ping,
  fetchList,
  createOne,
  deleteItems,
  updateOne,
  bulkUploadFromText,
  updateBundleMapping,
} as const;

export type ProductsAdapter = typeof productsAdapter;
