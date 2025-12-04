// 📄 src/api/hub/front_error_codes.ts
// 역할: 프론트 전용 에러코드/백엔드 에러코드 → 사용자 메시지 매핑
// 원칙:
//  - FRONT-xxx 는 네트워크/파싱/예상밖 오류 등 프론트 고유 에러
//  - AUTH-DENY-001/2/3 은 시나리오 구분을 위해 개별 유지
//  - FRONT-AUTH-UNAUTHORIZED-001 추가 (모바일/PC 통합 필요)
//  - 나머지 백엔드 에러는 <TYPE> 단위로 묶어서 공통 메시지 사용

export const FRONT_ERROR_CODES = {
  // ─────────────────────────────────────────
  // 프론트 전용(네트워크·파싱)
  // ─────────────────────────────────────────
  "FRONT-NET-001": "서버에 연결하지 못했습니다. 인터넷 상태를 확인해 주세요.",
  "FRONT-TIMEOUT-001": "요청이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.",
  "FRONT-PARSE-001": "응답 처리 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  "FRONT-UNEXPECTED-001": "예상하지 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",

  // ─────────────────────────────────────────
  // 프론트 인증 오류 (모바일/PC 공통)
  // ─────────────────────────────────────────
  "FRONT-AUTH-UNAUTHORIZED-001": "로그인이 필요합니다. 다시 로그인해 주세요.",

  // ─────────────────────────────────────────
  // AUTH 개별 코드 (UX상 구분이 중요한 것들)
  // ─────────────────────────────────────────
  "AUTH-DENY-001": "로그인이 필요합니다. 다시 로그인해 주세요.",
  "AUTH-DENY-002": "인증 정보가 유효하지 않습니다. 다시 로그인해 주세요.",
  "AUTH-DENY-003": "권한이 없습니다. 권한이 있는 계정으로 시도해 주세요.",
} as const;

export type FrontErrorCode = keyof typeof FRONT_ERROR_CODES;

// 백엔드 에러코드 패턴: <DOMAIN>-<TYPE>-<NNN>
type BackendType =
  | "VALID"
  | "NOTFOUND"
  | "CONFLICT"
  | "DENY"
  | "DISABLED"
  | "STATE"
  | "DB"
  | "UNKNOWN";

const BACKEND_CODE_PATTERN =
  /^(AUTH|INBOUND|OUTBOUND|PRODUCT|STOCK|REPORTS|SYSTEM)-(VALID|NOTFOUND|CONFLICT|DENY|DISABLED|STATE|DB|UNKNOWN)-\d{3}$/;

// TYPE 단위 기본 메시지 매핑
function getGenericByType(t: BackendType): string {
  switch (t) {
    case "VALID":
      return "요청 값이 올바르지 않습니다.";
    case "NOTFOUND":
      return "대상을 찾을 수 없습니다.";
    case "CONFLICT":
    case "STATE":
      return "현재 상태에서는 이 작업을 처리할 수 없습니다.";
    case "DISABLED":
      return "현재 기능이 비활성화되어 있습니다. 관리자에게 문의해 주세요.";
    case "DB":
      return "데이터 처리 중 오류가 발생했습니다.";
    case "DENY":
      return "권한이 없습니다.";
    case "UNKNOWN":
    default:
      return "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
}

/**
 * 코드 → 사용자 메시지 변환
 *
 * 우선순위:
 *  1) FRONT_ERROR_CODES (FRONT-xxx, AUTH-DENY-xxx 등)
 *  2) 백엔드 코드 패턴 파싱 → TYPE 기준 공통 메시지
 *  3) 그 외 예외 케이스 → 기본 메시지
 */
export function getFrontErrorMessage(code: string): string {
  if (!code) {
    return "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }

  const normalized = code.trim().toUpperCase();

  // 1) FRONT-xxx, AUTH-DENY-xxx
  if (normalized in FRONT_ERROR_CODES) {
    return FRONT_ERROR_CODES[normalized as FrontErrorCode];
  }

  // 2) 백엔드 코드 패턴: <DOMAIN>-<TYPE>-NNN>
  const match = BACKEND_CODE_PATTERN.exec(normalized);
  if (match) {
    const type = match[2] as BackendType;
    return getGenericByType(type);
  }

  // 3) 그 외 통합 메시지
  return "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}
