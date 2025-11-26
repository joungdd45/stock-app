/* ============================================================================
 * 📄 C:\dev\stock-app\stock-gui\src\lib\api\apiClient.ts
 * 역할: 전역 API 클라이언트(fetch 기반, 실사용 안정판)
 *
 * 변경 요약(v5.0.0 - fetch 전환)
 * - ✅ axios 제거, 표준 fetch 기반으로 전환
 * - ✅ 헤더 자동 부착: Authorization(Bearer), X-API-Key, X-Request-Id
 * - ✅ 401/403 시 토큰 제거 + auth:logout 이벤트 디스패치
 * - ✅ 429/5xx 지수 백오프 + Retry-After(seconds) 지원
 * - ✅ JSON/텍스트 자동 파싱, Blob 다운로드 전용 getBlob 제공
 * - ⚠️ 업로드 진행률(onProgress)은 fetch 한계로 미지원(XHR 대안 필요)
 * ========================================================================== */

export type ApiError = {
  status: number;
  message: string;
  code?: string;
  details?: any;
  url?: string;
  method?: string;
};

export type ApiClientOptions = {
  baseURL?: string;
  timeout?: number;        // ms (fetch는 하드타임아웃 없음 → AbortController 사용)
  maxRetries?: number;     // 기본 3
  retryBaseDelay?: number; // ms, 기본 300
  retryOn?: (status: number) => boolean; // 기본: 429, 500에서 599
  getToken?: () => string | null;
  getApiKey?: () => string | null;
};

type Json = Record<string, any>;

/* ────────────────────────────────────────────────────────────────
 * 로컬 스토리지 도우미
 * ────────────────────────────────────────────────────────────────*/
function readSettings() {
  try {
    const raw = localStorage.getItem("settings.app");
    return raw ? (JSON.parse(raw) as { apiBase?: string; apiKey?: string }) : {};
  } catch {
    return {};
  }
}
function readToken() {
  try {
    return localStorage.getItem("auth.token");
  } catch {
    return null;
  }
}
function clearAuth() {
  try {
    localStorage.removeItem("auth.token");
  } catch {}
}

/* ────────────────────────────────────────────────────────────────
 * 쿼리 직렬화
 * ────────────────────────────────────────────────────────────────*/
export function toSearchParams(query?: Record<string, any>): URLSearchParams | undefined {
  if (!query) return undefined;
  const params = new URLSearchParams();
  Object.entries(query).forEach(([k, v]) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      v.forEach((item) => params.append(k, String(item)));
    } else if (typeof v === "object") {
      params.set(k, JSON.stringify(v));
    } else {
      params.set(k, String(v));
    }
  });
  return params;
}
function joinUrl(base: string, path: string, query?: Record<string, any>): string {
  const hasProto = /^https?:\/\//i.test(path);
  const url = hasProto ? new URL(path) : new URL(path.replace(/^\//, ""), base.endsWith("/") ? base : base + "/");
  const sp = toSearchParams(query);
  if (sp) sp.forEach((v, k) => url.searchParams.append(k, v));
  return url.toString();
}

/* ────────────────────────────────────────────────────────────────
 * 에러 표준화
 * ────────────────────────────────────────────────────────────────*/
export function toApiError(err: unknown, ctx?: { url?: string; method?: string }): ApiError {
  if (err instanceof ApiClientError) {
    return {
      status: err.status,
      message: err.message,
      code: err.code,
      details: err.details,
      url: err.url ?? ctx?.url,
      method: err.method ?? ctx?.method,
    };
  }
  if (err instanceof Error) {
    return {
      status: 0,
      message: err.message,
      url: ctx?.url,
      method: ctx?.method,
    };
  }
  return {
    status: 0,
    message: "알 수 없는 오류가 발생했습니다.",
    url: ctx?.url,
    method: ctx?.method,
  };
}

class ApiClientError extends Error {
  status: number;
  code?: string;
  details?: any;
  url?: string;
  method?: string;
  constructor(init: { status: number; message: string; code?: string; details?: any; url?: string; method?: string }) {
    super(init.message);
    this.name = "ApiClientError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.url = init.url;
    this.method = init.method;
  }
}

/* ────────────────────────────────────────────────────────────────
 * 재시도/백오프
 * ────────────────────────────────────────────────────────────────*/
function defaultRetryOn(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
}
function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
function computeBackoffDelay(attempt: number, base: number, retryAfter?: string | number) {
  if (retryAfter !== undefined) {
    const n = Number(retryAfter);
    if (!Number.isNaN(n) && n > 0) return n * 1000;
  }
  const expo = base * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 120);
  return expo + jitter;
}

/* ────────────────────────────────────────────────────────────────
 * 본체: 클라이언트 생성
 * ────────────────────────────────────────────────────────────────*/
export function createApiClient(opts?: ApiClientOptions) {
  const settings = readSettings();

  const baseURL =
    opts?.baseURL ??
    settings.apiBase ??
    window.location.origin;

  const getToken = opts?.getToken ?? readToken;
  const getApiKey = opts?.getApiKey ?? (() => readSettings().apiKey ?? null);
  const maxRetries = Math.max(0, opts?.maxRetries ?? 3);
  const retryBaseDelay = Math.max(50, opts?.retryBaseDelay ?? 300);
  const shouldRetry = opts?.retryOn ?? defaultRetryOn;

  async function fetchWithTimeout(input: RequestInfo, init: RequestInit & { timeout?: number } = {}) {
    const controller = new AbortController();
    const id = init.timeout ? setTimeout(() => controller.abort(), init.timeout) : null;
    try {
      return await fetch(input, { ...init, signal: init.signal ?? controller.signal });
    } finally {
      if (id) clearTimeout(id);
    }
  }

  function buildHeaders(extra?: Record<string, string>): Headers {
    const h = new Headers();
    const token = getToken();
    const apiKey = getApiKey();

    h.set("Accept", "application/json, text/plain, */*");
    if (token) h.set("Authorization", `Bearer ${token}`);
    if (apiKey) h.set("X-API-Key", apiKey);
    if (!extra || !extra["X-Request-Id"]) {
      h.set("X-Request-Id", `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
    }
    if (extra) Object.entries(extra).forEach(([k, v]) => h.set(k, v));
    return h;
  }

  async function parseResponse<T>(res: Response): Promise<T> {
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      // JSON이지만 빈 본문 방어
      const text = await res.text();
      return text ? (JSON.parse(text) as T) : (undefined as unknown as T);
    }
    // 그 외는 텍스트로 시도
    const text = await res.text();
    return (text as unknown) as T;
  }

  async function requestWithRetry<T = any>(args: {
    method: string;
    url: string;
    query?: Record<string, any>;
    body?: any;
    headers?: Record<string, string>;
    timeout?: number;
    signal?: AbortSignal;
  }): Promise<T> {
    const { method, url, query, body, headers, timeout, signal } = args;
    const fullUrl = joinUrl(baseURL, url, query);

    let attempt = 0;
    while (true) {
      const reqInit: RequestInit & { timeout?: number } = {
        method,
        headers: buildHeaders(headers),
        timeout: timeout ?? 15000,
        signal,
      };

      // Body 세팅(JSON이면 자동 직렬화, FormData/Blob/ArrayBuffer는 그대로)
      if (body !== undefined && body !== null) {
        const isFormData = typeof FormData !== "undefined" && body instanceof FormData;
        const isBlob = typeof Blob !== "undefined" && body instanceof Blob;
        const isArrayBuffer = typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer;

        if (isFormData || isBlob || isArrayBuffer) {
          reqInit.body = body as BodyInit;
          // fetch는 FormData일 때 boundary 자동 설정. Content-Type 넣지 말 것.
        } else {
          (reqInit.headers as Headers).set("Content-Type", "application/json");
          reqInit.body = JSON.stringify(body);
        }
      }

      let res: Response;
      try {
        res = await fetchWithTimeout(fullUrl, reqInit);
      } catch (e) {
        // 네트워크/타임아웃 → 상태 코드 없음 → 재시도 불가, 바로 throw
        throw toApiError(e, { url: fullUrl, method });
      }

      if (res.ok) {
        // 204 No Content 방어
        if (res.status === 204) return undefined as unknown as T;
        return parseResponse<T>(res);
      }

      // 401/403 → 토큰 클리어 + 이벤트, 그 후 에러 throw(재시도 안 함)
      if (res.status === 401 || res.status === 403) {
        clearAuth();
        try {
          window.dispatchEvent(new CustomEvent("auth:logout"));
        } catch {}
        const errBody = await safeErrorBody(res);
        throw new ApiClientError({
          status: res.status,
          message: errBody.message ?? errBody.detail ?? `인증 오류(${res.status})`,
          code: errBody.code,
          details: errBody.details ?? errBody,
          url: fullUrl,
          method,
        });
      }

      // 재시도 대상?
      if (attempt < maxRetries && shouldRetry(res.status)) {
        const retryAfter = res.headers.get("retry-after") ?? undefined;
        const delay = computeBackoffDelay(attempt, retryBaseDelay, retryAfter as any);
        await sleep(delay);
        attempt += 1;
        continue;
      }

      // 최종 실패 → 표준화 에러 throw
      const errBody = await safeErrorBody(res);
      throw new ApiClientError({
        status: res.status,
        message: errBody.message ?? errBody.detail ?? `요청 실패(${res.status})`,
        code: errBody.code,
        details: errBody.details ?? errBody,
        url: fullUrl,
        method,
      });
    }
  }

  async function safeErrorBody(res: Response): Promise<any> {
    const ct = res.headers.get("content-type") || "";
    try {
      if (ct.includes("application/json")) return await res.json();
      const t = await res.text();
      return t ? { message: t } : {};
    } catch {
      return {};
    }
  }

  /* ──────────────────────────────────────────────────────────────
   * 퍼블릭 API
   * ──────────────────────────────────────────────────────────────*/
  function get<T = any>(
    url: string,
    options?: {
      query?: Record<string, any>;
      signal?: AbortSignal;
      headers?: Record<string, string>;
      timeout?: number;
    }
  ) {
    return requestWithRetry<T>({
      method: "GET",
      url,
      query: options?.query,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
  }

  function post<T = any>(
    url: string,
    data?: Json | FormData | ArrayBuffer | Blob,
    options?: {
      query?: Record<string, any>;
      signal?: AbortSignal;
      headers?: Record<string, string>;
      timeout?: number;
    }
  ) {
    return requestWithRetry<T>({
      method: "POST",
      url,
      query: options?.query,
      body: data,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
  }

  function patch<T = any>(
    url: string,
    data?: Json,
    options?: {
      query?: Record<string, any>;
      signal?: AbortSignal;
      headers?: Record<string, string>;
      timeout?: number;
    }
  ) {
    return requestWithRetry<T>({
      method: "PATCH",
      url,
      query: options?.query,
      body: data,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
  }

  function del<T = any>(
    url: string,
    options?: {
      query?: Record<string, any>;
      signal?: AbortSignal;
      headers?: Record<string, string>;
      timeout?: number;
    }
  ) {
    return requestWithRetry<T>({
      method: "DELETE",
      url,
      query: options?.query,
      headers: options?.headers,
      timeout: options?.timeout,
      signal: options?.signal,
    });
  }

  // 파일 다운로드(Blob 전용)
  async function getBlob(
    url: string,
    options?: {
      query?: Record<string, any>;
      signal?: AbortSignal;
      headers?: Record<string, string>;
      timeout?: number;
    }
  ): Promise<Blob> {
    const fullUrl = joinUrl(baseURL, url, options?.query);
    const res = await fetchWithTimeout(fullUrl, {
      method: "GET",
      headers: buildHeaders(options?.headers),
      signal: options?.signal,
      timeout: options?.timeout ?? 30000,
    });
    if (!res.ok) {
      const errBody = await safeErrorBody(res);
      throw new ApiClientError({
        status: res.status,
        message: errBody.message ?? errBody.detail ?? `다운로드 실패(${res.status})`,
        code: errBody.code,
        details: errBody.details ?? errBody,
        url: fullUrl,
        method: "GET",
      });
    }
    return await res.blob();
  }

  // 멀티파트 업로드(FormData) — fetch는 진행률 콜백 미지원
  function uploadForm<T = any>(
    url: string,
    form: FormData,
    options?: {
      query?: Record<string, any>;
      signal?: AbortSignal;
      headers?: Record<string, string>;
      // onProgress?: (pct: number) => void; // ⚠️ 미지원
      timeout?: number;
    }
  ) {
    return post<T>(url, form, {
      query: options?.query,
      signal: options?.signal,
      headers: options?.headers,
      timeout: options?.timeout,
    });
  }

  // 서버식 페이지네이션 도우미(limit, offset)
  async function fetchPage<T = any>(
    url: string,
    args: {
      limit?: number;
      offset?: number;
      sort?: string; // 예: "created_at DESC"
      filters?: Record<string, any>;
      signal?: AbortSignal;
      timeout?: number;
    } = {}
  ) {
    const { limit = 20, offset = 0, sort, filters, signal, timeout } = args;
    return get<{ rows: T[]; total: number }>(url, {
      signal,
      timeout,
      query: { limit, offset, sort, ...(filters ?? {}) },
    });
  }

  return {
    get,
    post,
    patch,
    del,
    getBlob,
    uploadForm,
    fetchPage,
  };
}

/* ────────────────────────────────────────────────────────────────
 * 기본 인스턴스
 * ────────────────────────────────────────────────────────────────*/
const api = createApiClient();
export default api;
