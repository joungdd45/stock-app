// 📄 src/api/hub/apiHub.ts
// 역할: 백엔드와 통신하는 단일 허브
//  - axios 인스턴스를 한 곳에서만 관리
//  - 응답을 ApiResult<T> 형태로 정규화
//  - 네트워크/인증/도메인 에러를 한 가지 포맷으로 정리

import axios, {
  type AxiosError,
  type AxiosInstance,
  type AxiosRequestConfig,
  type AxiosResponse,
} from "axios";
import { getFrontErrorMessage } from "./front_error_codes";

// ─────────────────────────────────────────────
// ApiResult 타입 정의
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

// ─────────────────────────────────────────────
// axios 인스턴스
// ─────────────────────────────────────────────

const API_BASE_URL =
  (import.meta as any).env?.VITE_API_BASE_URL ?? "";

const instance: AxiosInstance = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
});

// ✅ 실제 localStorage 키: accessToken / (예비) stockapp.access_token
const ACCESS_TOKEN_STORAGE_KEY = "stockapp.access_token";
const ACCESS_TOKEN_LEGACY_KEY = "accessToken";

// ─────────────────────────────────────────────
// 토큰 관리 / 강제 로그아웃
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// 요청 인터셉터: 토큰 확인 + Authorization 헤더 자동 주입
// ─────────────────────────────────────────────

instance.interceptors.request.use((config) => {
  const token = getAccessToken();

  // 토큰이 완전히 빠진 상태라면 바로 로그인 페이지로 이동
  if (!token) {
    forceLogout();
    return config;
  }

  // 토큰이 있으면 Authorization 헤더 자동 주입
  config.headers = config.headers ?? {};
  if (!("Authorization" in config.headers)) {
    (config.headers as any)["Authorization"] = `Bearer ${token}`;
  }

  return config;
});

// ─────────────────────────────────────────────
// 성공 응답 벗기기
// ─────────────────────────────────────────────

function unwrapBackendSuccess<T>(
  data: any
): { payload: T; traceId?: string | null } {
  if (data && typeof data === "object") {
    const traceId: string | null =
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

// ─────────────────────────────────────────────
// 프론트 에러코드 생성 (front_error_codes 규칙 사용)
// ─────────────────────────────────────────────

function makeFrontError(code: string, detail?: unknown): ApiError {
  const msg = getFrontErrorMessage(code);
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

// ─────────────────────────────────────────────
// AxiosError → ApiFailure
// ─────────────────────────────────────────────

function normalizeAxiosError(error: AxiosError): ApiFailure {
  // 네트워크 레벨에서 응답 자체가 없는 경우
  if (!error.response) {
    if (error.code === "ECONNABORTED") {
      // FRONT-TIMEOUT-001
      return {
        ok: false,
        data: null,
        error: makeFrontError("FRONT-TIMEOUT-001", error.message),
      };
    }

    // FRONT-NET-001
    return {
      ok: false,
      data: null,
      error: makeFrontError("FRONT-NET-001", error.message),
    };
  }

  const res = error.response as AxiosResponse<any>;
  const data = res.data;
  const status = res.status;

  // 401 같은 명확한 인증 실패는 바로 로그아웃 처리
  if (status === 401) {
    forceLogout();
    // AUTH-DENY-001: "로그인이 필요합니다. 다시 로그인해 주세요."
    return {
      ok: false,
      data: null,
      error: makeFrontError("AUTH-DENY-001", data),
    };
  }

  if (data && typeof data === "object" && data.ok === false && data.error) {
    const backendError = data.error as BackendErrorEnvelope["error"];
    const backendCode =
      typeof backendError.code === "string"
        ? backendError.code.trim().toUpperCase()
        : "SYSTEM-UNKNOWN-999";

    // 백엔드 에러 내용이 "인증 토큰" 누락 관련일 때: 강제 로그아웃 + AUTH-DENY-001
    if (isAuthTokenMissingError(backendError)) {
      forceLogout();
      return {
        ok: false,
        data: null,
        error: makeFrontError(
          "AUTH-DENY-001",
          backendError.detail ?? backendError
        ),
      };
    }

    // 기타 AUTH-xxx 도메인 에러: 강제 로그아웃 + 코드 그대로 매핑
    if (backendCode.startsWith("AUTH-")) {
      forceLogout();
      return {
        ok: false,
        data: null,
        error: makeFrontError(
          backendCode,
          backendError.detail ?? backendError
        ),
      };
    }

    // 나머지 도메인 에러는 code 기준으로 front_error_codes의 패턴 매핑 사용
    const code = backendCode || "SYSTEM-UNKNOWN-999";

    return {
      ok: false,
      data: null,
      error: {
        code,
        // 우선순위: front_error_codes 매핑 → backend message/detail → 기본 메시지
        message:
          getFrontErrorMessage(code) ||
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

  // 파싱 문제나 예외적인 응답 형태
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

  // FRONT-UNEXPECTED-001
  return {
    ok: false,
    data: null,
    error: makeFrontError("FRONT-UNEXPECTED-001", error),
  };
}

// ─────────────────────────────────────────────
// public 메서드
// ─────────────────────────────────────────────

async function get<T>(
  url: string,
  config?: AxiosRequestConfig
): Promise<ApiResult<T>> {
  try {
    const res = await instance.get<BackendSuccessEnvelope<T> | T>(
      url,
      config
    );
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
