/* 📄 src/api/adapters/login.adapter.ts
   도메인: 로그인(login)
   역할:
     - 로그인 페이지에서 사용하는 API 호출 묶음
     - 로그인 헬스 체크, 아이디/비밀번호 기반 로그인 처리
   사용 예시(페이지):
     import { loginAdapter } from "@/api/adapters/login.adapter";

     const handleLogin = async () => {
       const res = await loginAdapter.login({ id, password });
       if (res.ok && res.data) {
         // res.data.access_token, res.data.user 등 사용
       } else if (res.error) {
         // res.error.code, res.error.message로 에러 표시
       }
     };
*/

import { apiHub, type ApiResult } from "@/api/hub/apiHub";

// ─────────────────────────────────────────────────────────
// 엔드포인트 상수
// ─────────────────────────────────────────────────────────

const LOGIN_PING_URL = "/api/login/ping";
const LOGIN_ACTION_URL = "/api/login/action";

// ─────────────────────────────────────────────────────────
// DTO 및 타입 정의
// ─────────────────────────────────────────────────────────

// 로그인 요청 바디
// 백엔드 예시:
// { "id": "admin", "password": "admin1234" }
export type LoginRequestDto = {
  id: string;
  password: string;
};

// 백엔드에서 내려오는 user 정보
export type LoginUser = {
  id: number;
  username: string;
  name: string;
  role: string;
  last_login_at: string | null;
  login_count: number;
};

// 로그인 성공 시 result 영역에 들어가는 데이터
// 백엔드 예시:
// {
//   "access_token": "...",
//   "refresh_token": "...",
//   "token_type": "bearer",
//   "user": { ...LoginUser }
// }
export type LoginResult = {
  access_token: string;
  refresh_token: string;
  token_type: string;
  user: LoginUser;
};

// 로그인 ping 결과 타입
// - 현재 구체 스펙이 없으므로, 우선 unknown으로 두고
//   추후 스펙 확정 시 LoginPingResult를 구체 타입으로 변경 예정.
export type LoginPingResult = unknown;

// ─────────────────────────────────────────────────────────
// 어댑터 함수들
// ─────────────────────────────────────────────────────────

// [system] 로그인 페이지 헬스 체크
// GET /api/login/ping
export async function ping(): Promise<ApiResult<LoginPingResult>> {
  return apiHub.get<LoginPingResult>(LOGIN_PING_URL);
}

// [login] 아이디/비밀번호 로그인
// POST /api/login/action
export async function login(
  payload: LoginRequestDto,
): Promise<ApiResult<LoginResult>> {
  return apiHub.post<LoginResult, LoginRequestDto>(LOGIN_ACTION_URL, payload);
}

// ─────────────────────────────────────────────────────────
// 어댑터 export
// ─────────────────────────────────────────────────────────

export const loginAdapter = {
  ping,
  login,
} as const;

export type LoginAdapter = typeof loginAdapter;
