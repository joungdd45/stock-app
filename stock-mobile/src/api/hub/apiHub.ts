// 📄 src/api/hub/apiHub.ts
// 역할: 백엔드와 통신하는 단일 허브 (모바일 전용 완성본)
//  - axios 인스턴스 관리
//  - 응답을 ApiResult<T> 형태로 정규화
//  - 네트워크/인증/도메인 에러를 통합 포맷으로 가공
//  - handleError 내장 (팝업/알림 통일)

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";

import {
  getFrontErrorMessage,
  type FrontErrorCode,
} from "./front_error_codes";

//
// ─────────────────────────────────────────────
// ApiResult 타입 정의
// ─────────────────────────────────────────────
//

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
};

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

type BackendSuccessEnvelope<T = unknown> = {
  ok: true;
  trace_id?: string | null;
  page?: string;
  version?: string;
  stage?: string;
  data?: {
    result?: T;
  };
};

type BackendErrorEnvelope = {
  ok: false;
  trace_id?: string | null;
  error: {
    code: string;
    message: string;
    hint?: string;
    detail?: unknown;
    ctx?: unknown;
    stage?: string;
    domain?: string | null;
    trace_id?: string;
    timestamp?: string;
    [key: string]: unknown;
  };
  meta?: unknown;
};

//
// ─────────────────────────────────────────────
// axios 인스턴스
// ─────────────────────────────────────────────
//

const API_BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL ?? "";

const instance: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
});

const ACCESS_TOKEN_STORAGE_KEY = "stockapp.access_token";
const ACCESS_TOKEN_LEGACY_KEY = "accessToken";

//
// ─────────────────────────────────────────────
// 토큰 관리
// ─────────────────────────────────────────────
//

function getAccessToken(): string | null {
  try {
    const v1 = window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
    if (v1) return v1;
    const v2 = window.localStorage.getItem(ACCESS_TOKEN_LEGACY_KEY);
    return v2;
  } catch {
    return null;
  }
}

function clearAccessToken() {
  try {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(ACCESS_TOKEN_LEGACY_KEY);
    window.sessionStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    window.sessionStorage.removeItem(ACCESS_TOKEN_LEGACY_KEY);
  } catch {
    // 무시
  }
}

function forceLogout() {
  clearAccessToken();

  try {
    if (window.location.pathname !== "/login") {
      window.location.href = "/login";
    }
  } catch {
    // 무시
  }
}

//
// 요청 인터셉터
//

instance.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers = config.headers ?? {};
    if (!("Authorization" in config.headers)) {
      (config.headers as any)["Authorization"] = `Bearer ${token}`;
    }
  }
  return config;
});

//
// ─────────────────────────────────────────────
// 성공 응답 벗기기
// ─────────────────────────────────────────────
//

function unwrapBackendSuccess<T>(
  data: any
): { payload: T; traceId?: string | null } {
  if (data && typeof data === "object") {
    const traceId =
      data.trace_id ?? data.data?.trace_id ?? null;

    if (data.data && "result" in data.data) {
      return {
        payload: data.data.result as T,
        traceId,
      };
    }

    if ("result" in data) {
      return {
        payload: data.result as T,
        traceId,
      };
    }

    if ("ok" in data && !("data" in data)) {
      return {
        payload: data as T,
        traceId,
      };
    }
  }

  return {
    payload: data as T,
    traceId: (data && data.trace_id) || null,
  };
}

//
// ─────────────────────────────────────────────
// 프론트 에러코드 생성
// ─────────────────────────────────────────────
//

function makeFrontError(code: FrontErrorCode, detail?: unknown): ApiError {
  const msg = getFrontErrorMessage(code as string);
  return {
    code: String(code),
    message: msg,
    detail,
    raw: detail,
  };
}

function isAuthTokenMissingError(body: BackendErrorEnvelope["error"]): boolean {
  const detailText = String(body.detail ?? "");
  const locationText = String(
    (body.ctx as any)?.location ?? (body.ctx as any)?.field ?? ""
  );

  if (detailText.includes("인증 토큰")) return true;
  if (locationText === "header.Authorization") return true;

  return false;
}

//
// ─────────────────────────────────────────────
// AxiosError → ApiFailure
// ─────────────────────────────────────────────
//

function normalizeAxiosError(error: AxiosError): ApiFailure {
  if (!error.response) {
    if (error.code === "ECONNABORTED") {
      return {
        ok: false,
        data: null,
        error: makeFrontError("FRONT-TIMEOUT-001", error.message),
      };
    }

    return {
      ok: false,
      data: null,
      error: makeFrontError("FRONT-NET-001", error.message),
    };
  }

  const res = error.response as AxiosResponse<any>;
  const data = res.data;
  const status = res.status;

  // 401 → 강제 로그아웃
  if (status === 401) {
    forceLogout();
    return {
      ok: false,
      data: null,
      error: makeFrontError("FRONT-AUTH-UNAUTHORIZED-001", data),
    };
  }

  if (data && typeof data === "object" && data.ok === false && data.error) {
    const backendError = data.error as BackendErrorEnvelope["error"];

    if (
      isAuthTokenMissingError(backendError) ||
      (typeof backendError.code === "string" &&
        backendError.code.startsWith("AUTH-"))
    ) {
      forceLogout();
      return {
        ok: false,
        data: null,
        error: makeFrontError(
          "FRONT-AUTH-UNAUTHORIZED-001",
          backendError.detail ?? backendError
        ),
      };
    }

    const code = backendError.code || "SYSTEM-UNKNOWN-999";

    return {
      ok: false,
      data: null,
      error: {
        code,
        message:
          (backendError.message as string | undefined) ||
          (backendError.detail as string | undefined) ||
          getFrontErrorMessage("FRONT-UNEXPECTED-001"),
        detail: backendError.detail,
        hint: backendError.hint,
        traceId: backendError.trace_id ?? data.trace_id ?? null,
        raw: data,
      },
    };
  }

  return {
    ok: false,
    data: null,
    error: makeFrontError("FRONT-PARSE-001", data),
  };
}

function normalizeUnknownError(error: unknown): ApiFailure {
  if (axios.isAxiosError(error)) {
    return normalizeAxiosError(error);
  }

  return {
    ok: false,
    data: null,
    error: makeFrontError("FRONT-UNEXPECTED-001", error),
  };
}

//
// ─────────────────────────────────────────────
// public 메서드
// ─────────────────────────────────────────────
//

async function get<T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<ApiResult<T>> {
  try {
    const res = await instance.get<
      BackendSuccessEnvelope<T> | T
    >(url, config);

    const { payload, traceId } = unwrapBackendSuccess<T>(res.data);

    return {
      ok: true,
      data: payload,
      error: null,
      traceId,
    };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function post<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  config?: AxiosRequestConfig
): Promise<ApiResult<TResponse>> {
  try {
    const res = await instance.post<
      BackendSuccessEnvelope<TResponse> | TResponse
    >(url, body, config);

    const { payload, traceId } = unwrapBackendSuccess<TResponse>(res.data);

    return {
      ok: true,
      data: payload,
      error: null,
      traceId,
    };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function patch<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  config?: AxiosRequestConfig
): Promise<ApiResult<TResponse>> {
  try {
    const res = await instance.patch<
      BackendSuccessEnvelope<TResponse> | TResponse
    >(url, body, config);
    const { payload, traceId } = unwrapBackendSuccess<TResponse>(res.data);

    return {
      ok: true,
      data: payload,
      error: null,
      traceId,
    };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function put<TResponse, TBody = unknown>(
  url: string,
  body?: TBody,
  config?: AxiosRequestConfig
): Promise<ApiResult<TResponse>> {
  try {
    const res = await instance.put<
      BackendSuccessEnvelope<TResponse> | TResponse
    >(url, body, config);
    const { payload, traceId } = unwrapBackendSuccess<TResponse>(res.data);

    return {
      ok: true,
      data: payload,
      error: null,
      traceId,
    };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

async function del<TResponse>(
  url: string,
  config?: AxiosRequestConfig
): Promise<ApiResult<TResponse>> {
  try {
    const res = await instance.delete<
      BackendSuccessEnvelope<TResponse> | TResponse
    >(url, config);

    const { payload, traceId } = unwrapBackendSuccess<TResponse>(res.data);

    return {
      ok: true,
      data: payload,
      error: null,
      traceId,
    };
  } catch (error) {
    return normalizeUnknownError(error);
  }
}

//
// ─────────────────────────────────────────────
// handleError (프론트 공통 팝업)
// ─────────────────────────────────────────────
//

export function handleError(error: ApiError): void {
  try {
    const msg = error.message || "오류가 발생했습니다.";

    let detailText = "";
    if (error.detail) {
      if (typeof error.detail === "string") {
        detailText = error.detail;
      } else {
        try {
          detailText = JSON.stringify(error.detail);
        } catch {
          detailText = String(error.detail);
        }
      }
    }

    const finalMsg =
      detailText && detailText !== msg
        ? `${msg}\n\n${detailText}`
        : msg;

    alert(finalMsg);
  } catch {
    alert("오류가 발생했습니다.");
  }
}

//
// ─────────────────────────────────────────────
// export
// ─────────────────────────────────────────────
//

export const apiHub = {
  get,
  post,
  patch,
  put,
  delete: del,
} as const;

export type ApiHub = typeof apiHub;
