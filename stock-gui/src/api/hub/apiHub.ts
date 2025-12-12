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

// 로그인으로 보내고, 토스트는 띄우지 않는 전용 에러
function makeSilentAuthError(
  code: string,
  detail?: unknown,
  traceId?: string | null
): ApiError {
  return {
    code: String(code),
    message: "", // 메시지를 비워서 handleError에서 토스트가 안 뜨도록
    detail,
    traceId: traceId ?? null,
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
//
// ✅ 목표
// 1) 백엔드가 내려준 { ok:false, error:{ code, message, detail, hint... } } 가 있으면 "무조건 우선" 사용
// 2) status===401 이더라도, 위 봉투(envelope)가 있으면 그 코드를 존중 (AUTH-DENY-002 같은 로그인 실패가 뭉개지지 않게)
// 3) forceLogout은 "토큰 누락/만료" 같은 경우에만 수행 (로그인 실패까지 강제 로그아웃 금지)
// 4) AUTH-*라도 전부 silent 처리하지 말고, 최소한 로그인 실패(AUTH-DENY-002)는 사용자 토스트로 보여줄 수 있게 남김
//

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

  // ✅ 1) 백엔드 에러 봉투(ok:false + error)가 있으면 "무조건 우선" 처리
  //    (401이든 뭐든, 여기서 code/message를 확정한다)
  if (data && typeof data === "object" && data.ok === false && data.error) {
    const backendError = data.error as BackendErrorEnvelope["error"];
    const backendCode =
      typeof backendError.code === "string"
        ? backendError.code.trim().toUpperCase()
        : "SYSTEM-UNKNOWN-999";

    // ✅ 토큰 누락/만료 등 "인증 토큰 문제"일 때만 강제 로그아웃 + silent
    if (isAuthTokenMissingError(backendError)) {
      forceLogout();
      return {
        ok: false,
        data: null,
        error: makeSilentAuthError(
          "AUTH-DENY-001",
          backendError.detail ?? backendError,
          backendError.trace_id ?? (data as any).trace_id
        ),
      };
    }

    // ✅ AUTH-* 중에서도 "정말 silent + logout"이 필요한 것만 제한적으로 처리
    //    - AUTH-DENY-001: 로그인 필요/토큰 문제 계열 (백엔드가 이렇게 내려주면 silent로 처리)
    //    - AUTH-DENY-003: 권한 없음(페이지 가드에서 처리하고 싶으면 silent 가능)
    //    - AUTH-DENY-002: 로그인 실패(아이디/비번) → 사용자에게 토스트로 보여주는 케이스(로그아웃 금지)
    if (backendCode === "AUTH-DENY-001") {
      forceLogout();
      return {
        ok: false,
        data: null,
        error: makeSilentAuthError(
          backendCode,
          backendError.detail ?? backendError,
          backendError.trace_id ?? (data as any).trace_id
        ),
      };
    }

    if (backendCode === "AUTH-DENY-003") {
      // 권한 없음은 토큰을 날릴 이유는 없으므로 logout은 하지 않음
      // 필요하면 silent 처리만 유지
      return {
        ok: false,
        data: null,
        error: makeSilentAuthError(
          backendCode,
          backendError.detail ?? backendError,
          backendError.trace_id ?? (data as any).trace_id
        ),
      };
    }

    // ✅ 나머지(INCLUDING AUTH-DENY-002 포함)는 "code 기준 메시지 매핑"으로 정상 노출
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
        traceId: backendError.trace_id ?? (data as any).trace_id ?? null,
        raw: data,
      },
    };
  }

  // ✅ 2) 봉투가 없는 상태에서의 401 처리 (정상적인 백엔드는 보통 봉투를 주지만, 예외 대비)
  //    여기서는 "무조건 logout" 하지 말고, silent 에러만 만든다.
  if (status === 401) {
    return {
      ok: false,
      data: null,
      error: makeSilentAuthError("AUTH-DENY-001", data, (data as any)?.trace_id),
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
