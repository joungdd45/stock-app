// 📄 src/api/hub/apiHub.ts
// 역할: 백엔드와 통신하는 단일 허브 (모바일 전용)
//  - axios 인스턴스 관리
//  - 응답을 ApiResult<T> 형태로 정규화
//  - 백엔드 ok:false(HTTP 200 포함)도 실패로 처리
//  - handleError: front_error_codes 기반 메시지 + App 주입 토스트로 출력

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";

import { getFrontErrorMessage, type FrontErrorCode } from "./front_error_codes";

// ─────────────────────────────────────────────
// ApiResult 타입
// ─────────────────────────────────────────────

export type ApiError = {
  code: string;
  message: string;
  detail?: unknown;
  hint?: string;
  traceId?: string | null;
  raw?: unknown;
};

export type ApiSuccess<T> = {
  ok: true;
  data: T;
  error: null;
  traceId?: string | null;
};

export type ApiFailure = {
  ok: false;
  data: null;
  error: ApiError;
  traceId?: string | null;
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

// ─────────────────────────────────────────────
// ✅ App에서 주입하는 전역 토스트 함수
// ─────────────────────────────────────────────

type GlobalToastFn = (message: string) => void;
let globalToastFn: GlobalToastFn | null = null;

export function setGlobalToast(fn: GlobalToastFn | null) {
  globalToastFn = fn;
}

// ─────────────────────────────────────────────
// axios 인스턴스
// ─────────────────────────────────────────────

const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL ?? "";

const instance: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
});

// ─────────────────────────────────────────────
// 토큰/무토큰 허용 URL
// ─────────────────────────────────────────────

const ACCESS_TOKEN_STORAGE_KEY = "stockapp.access_token";
const ACCESS_TOKEN_LEGACY_KEY = "accessToken";
const ACCESS_TOKEN_MOBILE_JWT_KEY = "stock.jwt";

/**
 * ✅ 무토큰 허용 URL
 * - 로그인/핑은 무토큰 요청
 * - 실제 프로젝트에서 login 경로가 2종 이상이라 넓혀둠
 */
const OPEN_URLS = [
  "/api/login/ping",
  "/api/login/action",
  "/api/auth/login",
  "/api/system/health",
];

function getAccessToken(): string | null {
  try {
    return (
      window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) ||
      window.localStorage.getItem(ACCESS_TOKEN_LEGACY_KEY) ||
      window.localStorage.getItem(ACCESS_TOKEN_MOBILE_JWT_KEY) ||
      null
    );
  } catch {
    return null;
  }
}

function clearAccessToken() {
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(ACCESS_TOKEN_LEGACY_KEY);
    window.localStorage.removeItem(ACCESS_TOKEN_MOBILE_JWT_KEY);

    window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(ACCESS_TOKEN_LEGACY_KEY);
    window.sessionStorage.removeItem(ACCESS_TOKEN_MOBILE_JWT_KEY);
  } catch {
    // ignore
  }
}

function forceLogout() {
  clearAccessToken();
  try {
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  } catch {
    // ignore
  }
}

// ─────────────────────────────────────────────
// 요청 인터셉터
//  - OPEN_URLS는 무토큰 통과
//  - 그 외 토큰 없으면 forceLogout (단, 요청을 막진 않음)
// ─────────────────────────────────────────────

instance.interceptors.request.use((config) => {
  const url = String(config.url ?? "");

  // ✅ 무토큰 허용
  if (OPEN_URLS.some((p) => url.startsWith(p))) {
    return config;
  }

  const token = getAccessToken();
  if (!token) {
    // 여기서 강제 이동은 하되, 요청 자체를 throw 하진 않는다.
    forceLogout();
    return config;
  }

  config.headers = config.headers ?? {};
  if (!(config.headers as any).Authorization) {
    (config.headers as any).Authorization = `Bearer ${token}`;
  }

  return config;
});

// ─────────────────────────────────────────────
// 백엔드 응답 엔벨로프 인식
//  - HTTP 200이어도 ok:false면 실패 처리
// ─────────────────────────────────────────────

type BackendFailureEnvelope = {
  ok: false;
  error: any;
  trace_id?: string | null;
  meta?: any;
};

function isBackendFailureEnvelope(x: any): x is BackendFailureEnvelope {
  return !!x && typeof x === "object" && x.ok === false && !!x.error && typeof x.error === "object";
}

function unwrapBackendSuccess<T>(x: any): { payload: T; traceId: string | null } {
  const traceId = (x?.trace_id ?? x?.data?.trace_id ?? null) as string | null;

  // { ok:true, data:{ result } }
  if (x && typeof x === "object" && x.data && typeof x.data === "object" && "result" in x.data) {
    return { payload: x.data.result as T, traceId };
  }

  // { result: ... }
  if (x && typeof x === "object" && "result" in x) {
    return { payload: x.result as T, traceId };
  }

  // raw 자체가 payload
  return { payload: x as T, traceId };
}

// ─────────────────────────────────────────────
// FrontError 생성(FrontErrorCode 정합 유지)
// ─────────────────────────────────────────────

function makeFrontError(code: FrontErrorCode, rawMessage?: string): ApiError {
  const message = getFrontErrorMessage(code) || rawMessage || "오류가 발생했습니다.";
  return { code, message, detail: rawMessage ?? null, traceId: null, raw: null };
}

function normalizeBackendFailureEnvelope(dataAny: any): ApiFailure {
  const be = dataAny?.error ?? {};
  const traceId = (be.trace_id ?? dataAny?.trace_id ?? null) as string | null;

  return {
    ok: false,
    data: null,
    error: {
      code: String(be.code ?? "FRONT-UNEXPECTED-001"),
      message: String(be.message ?? "처리 중 오류가 발생했습니다."),
      detail: be.detail ?? null,
      hint: be.hint ?? undefined,
      traceId,
      raw: dataAny,
    },
    traceId,
  };
}

// ─────────────────────────────────────────────
// AxiosError → ApiFailure
// ─────────────────────────────────────────────

function normalizeAxiosError(error: AxiosError): ApiFailure {
  // 응답이 없는 경우: 네트워크/타임아웃 등
  if (!error.response) {
    if (error.code === "ECONNABORTED") {
      return { ok: false, data: null, error: makeFrontError("FRONT-TIMEOUT-001", error.message) };
    }
    return { ok: false, data: null, error: makeFrontError("FRONT-NET-001", error.message) };
  }

  const res = error.response as AxiosResponse<any>;
  const data = res.data;
  const status = res.status;

  // 401: 강제 로그아웃 + FRONT-AUTH-UNAUTHORIZED-001 (front_error_codes에 존재)
  if (status === 401) {
    forceLogout();
    return {
      ok: false,
      data: null,
      error: makeFrontError(
        "FRONT-AUTH-UNAUTHORIZED-001",
        "로그인이 필요합니다. 다시 로그인해 주세요.",
      ),
      traceId: data?.trace_id ?? data?.traceId ?? null,
    };
  }

  // 백엔드가 에러를 표준 형태로 내려주는 경우 우선 사용
  const code = data?.error?.code ?? data?.code ?? "FRONT-UNEXPECTED-001";
  const message =
    data?.error?.message ??
    data?.message ??
    `요청 처리 중 오류가 발생했습니다. (HTTP ${status})`;

  const detail = data?.error?.detail ?? data?.detail ?? null;
  const hint = data?.error?.hint ?? data?.hint ?? undefined;
  const traceId = data?.trace_id ?? data?.traceId ?? null;

  return {
    ok: false,
    data: null,
    error: {
      code: String(code),
      message: String(message),
      detail,
      hint,
      traceId,
      raw: data,
    },
    traceId,
  };
}

function normalizeUnknownError(error: unknown): ApiFailure {
  const ax = error as AxiosError;
  if (ax && (ax as any).isAxiosError) {
    return normalizeAxiosError(ax);
  }

  return {
    ok: false,
    data: null,
    error: {
      code: "FRONT-UNEXPECTED-001",
      message: getFrontErrorMessage("FRONT-UNEXPECTED-001"),
      detail: null,
      traceId: null,
      raw: error,
    },
  };
}

// ─────────────────────────────────────────────
// 요청 메서드들 (HTTP 200 + ok:false도 실패 처리)
// ─────────────────────────────────────────────

async function get<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResult<T>> {
  try {
    const res = await instance.get<any>(url, config);
    const dataAny: any = res.data;

    if (isBackendFailureEnvelope(dataAny)) {
      return normalizeBackendFailureEnvelope(dataAny);
    }

    const { payload, traceId } = unwrapBackendSuccess<T>(dataAny);
    return { ok: true, data: payload, error: null, traceId };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function post<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<ApiResult<T>> {
  try {
    const res = await instance.post<any>(url, body, config);
    const dataAny: any = res.data;

    if (isBackendFailureEnvelope(dataAny)) {
      return normalizeBackendFailureEnvelope(dataAny);
    }

    const { payload, traceId } = unwrapBackendSuccess<T>(dataAny);
    return { ok: true, data: payload, error: null, traceId };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function patch<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<ApiResult<T>> {
  try {
    const res = await instance.patch<any>(url, body, config);
    const dataAny: any = res.data;

    if (isBackendFailureEnvelope(dataAny)) {
      return normalizeBackendFailureEnvelope(dataAny);
    }

    const { payload, traceId } = unwrapBackendSuccess<T>(dataAny);
    return { ok: true, data: payload, error: null, traceId };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function put<T, B = unknown>(
  url: string,
  body?: B,
  config?: AxiosRequestConfig,
): Promise<ApiResult<T>> {
  try {
    const res = await instance.put<any>(url, body, config);
    const dataAny: any = res.data;

    if (isBackendFailureEnvelope(dataAny)) {
      return normalizeBackendFailureEnvelope(dataAny);
    }

    const { payload, traceId } = unwrapBackendSuccess<T>(dataAny);
    return { ok: true, data: payload, error: null, traceId };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function del<T>(url: string, config?: AxiosRequestConfig): Promise<ApiResult<T>> {
  try {
    const res = await instance.delete<any>(url, config);
    const dataAny: any = res.data;

    if (isBackendFailureEnvelope(dataAny)) {
      return normalizeBackendFailureEnvelope(dataAny);
    }

    const { payload, traceId } = unwrapBackendSuccess<T>(dataAny);
    return { ok: true, data: payload, error: null, traceId };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

// ─────────────────────────────────────────────
// handleError (프론트 공통 토스트)
//  - FRONT-AUTH-UNAUTHORIZED-001 도 토스트 1번은 보여준다(원인 가시화)
// ─────────────────────────────────────────────

export function handleError(err: ApiError | unknown): void {
  try {
    const e = (err ?? {}) as any;
    const code = String(e.code ?? "FRONT-UNEXPECTED-001");
    const message = String(e.message ?? getFrontErrorMessage("FRONT-UNEXPECTED-001"));

    // ✅ 인증 만료도 토스트는 1번 띄우고, 이후 로직 종료
    if (code === "FRONT-AUTH-UNAUTHORIZED-001") {
      if (globalToastFn) globalToastFn(message);
      return;
    }

    let detailText = "";
    if (e.detail) {
      if (typeof e.detail === "string") detailText = e.detail;
      else {
        try {
          detailText = JSON.stringify(e.detail);
        } catch {
          detailText = String(e.detail);
        }
      }
    }

    const finalMsg = detailText ? `${message}\n\n[상세]\n${detailText}` : message;

    if (globalToastFn) {
      globalToastFn(finalMsg);
      return;
    }

    // 개발 중 안전장치(주입 안 된 경우)
    alert(finalMsg);
  } catch {
    if (globalToastFn) {
      globalToastFn("처리 중 오류가 발생했습니다.");
      return;
    }
    alert("처리 중 오류가 발생했습니다.");
  }
}

// ─────────────────────────────────────────────
// export
// ─────────────────────────────────────────────

export const apiHub = {
  get,
  post,
  patch,
  put,
  delete: del,
} as const;

export type ApiHub = typeof apiHub;
