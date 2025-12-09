/* 📄 src/api/adapters/settings.adapter.ts
 * 도메인: 설정 - 기본설정(settings.basic) / 고급설정(settings.advanced)
 *
 * 역할:
 * - 기본설정
 *   - 사용자 목록 조회 / 추가 / 수정 / 삭제
 *   - 내 페이지 설정 조회 / 저장
 *   - 관리자: 특정 사용자 페이지 설정 조회 / 저장
 * - 고급설정
 *   - 보안 / 성능·캐시 / API 연결 설정 조회·저장
 *
 * 규칙:
 * - 모든 통신은 apiHub를 통해 수행
 * - 페이지에서는 이 어댑터만 import 해서 사용
 */

import { apiHub, type ApiResult } from "../hub/apiHub";

/* ───────────────────────────────────────────────
 * 0. 공통 타입 (기본설정)
 * ─────────────────────────────────────────────── */

export type SettingsUserRole = "admin" | "manager" | "user";

export interface SettingsBasicPingResponse {
  page: string; // "settings.basic"
  version: string;
  stage: string;
}

export interface SettingsBasicUserItem {
  id: number;
  username: string;
  name: string;
  role: SettingsUserRole;
  is_active: boolean;
  last_login_at: string | null;
  login_count: number;
}

export interface SettingsBasicUsersResponse {
  items: SettingsBasicUserItem[];
}

export interface SettingsBasicUserCreateDto {
  username: string;
  name: string;
  role: SettingsUserRole;
  /** 초기 비밀번호 (관리자가 직접 설정) */
  password?: string;
}

export type SettingsBasicUserCreateResponse = SettingsBasicUserItem;

export interface SettingsBasicUserUpdateDto {
  name: string;
  role: SettingsUserRole;
  is_active: boolean;
}

export type SettingsBasicUserUpdateResponse = SettingsBasicUserItem;

export interface SettingsBasicUserDeleteResponse {
  deleted_id: number;
  deleted_at: string;
}

export interface SettingsBasicUserPasswordUpdateDto {
  new_password: string;
}

export interface SettingsBasicUserPasswordUpdateResponse {
  id: number;
  username: string;
}

export interface SettingsBasicPageConfig {
  page_size: number;
  theme: string; // "라이트" | "다크"
}

export interface SettingsBasicPageUpdateDto {
  page_size: number;
  theme: string;
}

export type SettingsBasicPageUpdateResponse = SettingsBasicPageConfig;

export interface SettingsBasicAdminUserPageUpdateDto {
  page_size: number;
  theme: string;
}

export type SettingsBasicAdminUserPageUpdateResponse = SettingsBasicPageConfig;

/* ───────────────────────────────────────────────
 * 0-2. 고급설정 타입
 * ─────────────────────────────────────────────── */

export interface SettingsAdvancedSecurity {
  require_x_api_key: boolean;
  require_jwt_token: boolean;
  api_key: string;
}

export interface SettingsAdvancedPerformance {
  request_limit_per_minute: number;
  cache_ttl_seconds: number;
}

export interface SettingsAdvancedApi {
  api_base_url: string;
}

export interface SettingsAdvancedConfig {
  security: SettingsAdvancedSecurity;
  performance: SettingsAdvancedPerformance;
  api: SettingsAdvancedApi;
}

export type SettingsAdvancedUpdateDto = SettingsAdvancedConfig;
export type SettingsAdvancedResponse = SettingsAdvancedConfig;

/* ───────────────────────────────────────────────
 * 1. 엔드포인트 상수
 * ─────────────────────────────────────────────── */

// 기본설정
const SETTINGS_BASIC_PING_URL = "/api/settings/basic/ping";

const SETTINGS_BASIC_USERS_URL = "/api/settings/basic/users";
const SETTINGS_BASIC_USER_DETAIL_URL = (userId: number) =>
  `/api/settings/basic/users/${userId}`;
const SETTINGS_BASIC_USER_PASSWORD_URL = (userId: number) =>
  `/api/settings/basic/users/${userId}/password`;

const SETTINGS_BASIC_PAGE_URL = "/api/settings/basic/page";

const SETTINGS_BASIC_ADMIN_USER_PAGE_URL = (targetUserId: number) =>
  `/api/settings/basic/admin/users/${targetUserId}/page`;

// 고급설정
const SETTINGS_ADVANCED_URL = "/api/settings/advanced";

/* ───────────────────────────────────────────────
 * 2. 기본설정 - 핑
 * ─────────────────────────────────────────────── */

async function ping(): Promise<ApiResult<SettingsBasicPingResponse>> {
  return apiHub.get<SettingsBasicPingResponse>(SETTINGS_BASIC_PING_URL);
}

/* ───────────────────────────────────────────────
 * 3. 기본설정 - 사용자 관리
 * ─────────────────────────────────────────────── */

// 사용자 목록 조회
async function fetchUsers(): Promise<ApiResult<SettingsBasicUsersResponse>> {
  return apiHub.get<SettingsBasicUsersResponse>(SETTINGS_BASIC_USERS_URL);
}

// 사용자 추가 (비밀번호 포함)
async function createUser(
  payload: SettingsBasicUserCreateDto,
): Promise<ApiResult<SettingsBasicUserCreateResponse>> {
  return apiHub.post<SettingsBasicUserCreateResponse, SettingsBasicUserCreateDto>(
    SETTINGS_BASIC_USERS_URL,
    payload,
  );
}

// 사용자 수정 (비밀번호 제외)
async function updateUser(
  userId: number,
  payload: SettingsBasicUserUpdateDto,
): Promise<ApiResult<SettingsBasicUserUpdateResponse>> {
  const url = SETTINGS_BASIC_USER_DETAIL_URL(userId);
  return apiHub.put<SettingsBasicUserUpdateResponse, SettingsBasicUserUpdateDto>(
    url,
    payload,
  );
}

// 사용자 삭제(논리삭제)
async function deleteUser(
  userId: number,
): Promise<ApiResult<SettingsBasicUserDeleteResponse>> {
  const url = SETTINGS_BASIC_USER_DETAIL_URL(userId);
  return apiHub.delete<SettingsBasicUserDeleteResponse>(url);
}

// 사용자 비밀번호 재설정
async function updateUserPassword(
  userId: number,
  payload: SettingsBasicUserPasswordUpdateDto,
): Promise<ApiResult<SettingsBasicUserPasswordUpdateResponse>> {
  const url = SETTINGS_BASIC_USER_PASSWORD_URL(userId);
  return apiHub.put<
    SettingsBasicUserPasswordUpdateResponse,
    SettingsBasicUserPasswordUpdateDto
  >(url, payload);
}

/* ───────────────────────────────────────────────
 * 4. 기본설정 - 내 페이지 설정
 * ─────────────────────────────────────────────── */

// 내 페이지 설정 조회
async function getMyPageConfig(): Promise<ApiResult<SettingsBasicPageConfig>> {
  return apiHub.get<SettingsBasicPageConfig>(SETTINGS_BASIC_PAGE_URL);
}

// 내 페이지 설정 저장
async function updateMyPageConfig(
  payload: SettingsBasicPageUpdateDto,
): Promise<ApiResult<SettingsBasicPageUpdateResponse>> {
  return apiHub.put<SettingsBasicPageUpdateResponse, SettingsBasicPageUpdateDto>(
    SETTINGS_BASIC_PAGE_URL,
    payload,
  );
}

/* ───────────────────────────────────────────────
 * 5. 기본설정 - 관리자: 특정 사용자 페이지 설정
 * ─────────────────────────────────────────────── */

// 특정 사용자 페이지 설정 조회
async function getUserPageConfig(
  targetUserId: number,
): Promise<ApiResult<SettingsBasicPageConfig>> {
  const url = SETTINGS_BASIC_ADMIN_USER_PAGE_URL(targetUserId);
  return apiHub.get<SettingsBasicPageConfig>(url);
}

// 특정 사용자 페이지 설정 저장
async function updateUserPageConfig(
  targetUserId: number,
  payload: SettingsBasicAdminUserPageUpdateDto,
): Promise<ApiResult<SettingsBasicAdminUserPageUpdateResponse>> {
  const url = SETTINGS_BASIC_ADMIN_USER_PAGE_URL(targetUserId);
  return apiHub.put<
    SettingsBasicAdminUserPageUpdateResponse,
    SettingsBasicAdminUserPageUpdateDto
  >(url, payload);
}

/* ───────────────────────────────────────────────
 * 6. 고급설정 - 조회 / 저장
 * ─────────────────────────────────────────────── */

// 고급설정 조회
async function getAdvancedSettings(): Promise<ApiResult<SettingsAdvancedResponse>> {
  return apiHub.get<SettingsAdvancedResponse>(SETTINGS_ADVANCED_URL);
}

// 고급설정 저장
async function saveAdvancedSettings(
  payload: SettingsAdvancedUpdateDto,
): Promise<ApiResult<SettingsAdvancedResponse>> {
  return apiHub.post<SettingsAdvancedResponse, SettingsAdvancedUpdateDto>(
    SETTINGS_ADVANCED_URL,
    payload,
  );
}

/* ───────────────────────────────────────────────
 * 7. 어댑터 export
 * ─────────────────────────────────────────────── */

export const settingsAdapter = {
  // 기본설정
  ping,

  fetchUsers,
  createUser,
  updateUser,
  deleteUser,
  updateUserPassword,

  getMyPageConfig,
  updateMyPageConfig,

  getUserPageConfig,
  updateUserPageConfig,

  // 고급설정
  getAdvancedSettings,
  saveAdvancedSettings,
} as const;

export type SettingsAdapter = typeof settingsAdapter;
