// C:\dev\stock-app\stock-gui\src\pages\settings\Advanced\AdvancedPage.tsx
// 페이지: 설정 > 고급설정
// 역할: 최고권한 관리자가 보안 / 성능·캐시 / API 연결 설정을 조회·저장
// 통신: GET/POST /api/settings/advanced (settingsAdapter 사용)
// 참고: 일부 값은 settings.app 로컬스토리지에 함께 보관(apiBase 등)

import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  settingsAdapter,
  type SettingsAdvancedConfig,
} from "@/api/adapters/settings.adapter";
import { handleError } from "@/utils/handleError";

type AdvancedForm = SettingsAdvancedConfig;

const STORAGE_KEY = "settings.app";

const defaultForm: AdvancedForm = {
  security: {
    require_x_api_key: false,
    require_jwt_token: false,
    api_key: "",
  },
  performance: {
    request_limit_per_minute: 60,
    cache_ttl_seconds: 60,
  },
  api: {
    api_base_url: "",
  },
};

// 로컬 fallback (옛날 settings.app 구조를 최대한 살려서 읽기)
function loadLocalAdvancedFallback(): AdvancedForm {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultForm;
    const base = JSON.parse(raw);

    return {
      security: {
        require_x_api_key: !!base.requireApiKey,
        require_jwt_token: !!base.requireJwt,
        api_key: typeof base.apiKey === "string" ? base.apiKey : "",
      },
      performance: {
        request_limit_per_minute:
          typeof base.requestLimitPerMinute === "number"
            ? base.requestLimitPerMinute
            : defaultForm.performance.request_limit_per_minute,
        cache_ttl_seconds:
          typeof base.cacheTtlSeconds === "number"
            ? base.cacheTtlSeconds
            : defaultForm.performance.cache_ttl_seconds,
      },
      api: {
        api_base_url:
          typeof base.apiBase === "string" ? base.apiBase : defaultForm.api.api_base_url,
      },
    };
  } catch {
    return defaultForm;
  }
}

// 로컬 저장 (apiBase 등은 계속 활용 가능)
function saveLocalAdvanced(config: AdvancedForm) {
  try {
    const prevRaw = localStorage.getItem(STORAGE_KEY);
    const prev = prevRaw ? JSON.parse(prevRaw) : {};
    const merged = {
      ...prev,
      requireApiKey: config.security.require_x_api_key,
      requireJwt: config.security.require_jwt_token,
      apiKey: config.security.api_key,
      apiBase: config.api.api_base_url,
      requestLimitPerMinute: config.performance.request_limit_per_minute,
      cacheTtlSeconds: config.performance.cache_ttl_seconds,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    // 로컬 저장 실패는 무시
  }
}

// 어떤 형태로 오든 간에 AdvancedForm으로 맞춰주는 정규화 함수
function normalizeConfig(raw: unknown): AdvancedForm {
  const anyRaw = raw as any;

  const candidates: any[] = [
    anyRaw,
    anyRaw?.result,
    anyRaw?.data,
    anyRaw?.data?.result,
  ];

  for (const c of candidates) {
    if (!c) continue;
    if (c.security && c.performance && c.api) {
      return {
        security: { ...defaultForm.security, ...c.security },
        performance: { ...defaultForm.performance, ...c.performance },
        api: { ...defaultForm.api, ...c.api },
      };
    }
  }

  // 혹시 모르면 기본값
  return defaultForm;
}

export default function AdvancedPage() {
  const tabs = useMemo(
    () => [
      { to: "/settings/basic", label: "기본설정" },
      { to: "/settings/advanced", label: "고급설정" },
    ],
    [],
  );

  // 초기값은 로컬 fallback → 이후에는 항상 백엔드가 진실
  const [form, setForm] = useState<AdvancedForm>(() => loadLocalAdvancedFallback());
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // ───────────────── patch helpers ─────────────────
  const patchSecurity =
    (field: keyof AdvancedForm["security"]) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value =
        field === "require_x_api_key" || field === "require_jwt_token"
          ? e.target.checked
          : e.target.value;
      setForm((prev) => ({
        ...prev,
        security: {
          ...prev.security,
          [field]: value,
        },
      }));
    };

  const patchPerformance =
    (field: keyof AdvancedForm["performance"]) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = Number(e.target.value || 0);
      setForm((prev) => ({
        ...prev,
        performance: {
          ...prev.performance,
          [field]: value,
        },
      }));
    };

  const patchApi =
    (field: keyof AdvancedForm["api"]) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;
      setForm((prev) => ({
        ...prev,
        api: {
          ...prev.api,
          [field]: value,
        },
      }));
    };

  // ───────────────── 백엔드 연동 ─────────────────
  const loadAdvanced = async () => {
    setIsLoading(true);
    const res = await settingsAdapter.getAdvancedSettings();
    setIsLoading(false);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      } else {
        alert("고급설정을 불러오지 못했습니다.");
      }
      return;
    }

    const cfg = normalizeConfig(res.data);
    setForm(cfg);
    saveLocalAdvanced(cfg);
  };

  const handleSave = async () => {
    setIsSaving(true);
    const res = await settingsAdapter.saveAdvancedSettings(form);
    setIsSaving(false);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      } else {
        alert("고급설정 저장에 실패했습니다.");
      }
      return;
    }

    const cfg = normalizeConfig(res.data);
    setForm(cfg);
    saveLocalAdvanced(cfg);
    alert("고급설정이 저장되었습니다.");
  };

  useEffect(() => {
    loadAdvanced();
  }, []);

  const security = form.security;
  const performance = form.performance;
  const api = form.api;

  return (
    <div className="p-4 space-y-6">
      {/* 로컬 탭 */}
      <nav className="flex gap-2">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              [
                "px-3 py-1.5 rounded-xl text-sm border",
                isActive
                  ? "bg-gray-900 text-white border-gray-900"
                  : "bg-white text-gray-700 border-gray-200 hover:bg-gray-50",
              ].join(" ")
            }
          >
            {t.label}
          </NavLink>
        ))}
      </nav>

      {/* 안내 영역 */}
      <section className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <h1 className="text-base font-semibold mb-1">고급설정</h1>
        <p>
          이 페이지는 최고권한 관리자만 접근할 수 있습니다. 보안, 성능·캐시, API 연결 설정을
          변경하면 시스템 전체 동작에 직접 영향을 줍니다.
        </p>
      </section>

      {isLoading && (
        <p className="text-sm text-gray-500">고급설정을 불러오는 중입니다...</p>
      )}

      {/* 상단: 보안 설정 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold mb-4">보안 설정</h2>
        <div className="flex flex-col gap-3 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={security.require_x_api_key}
              onChange={patchSecurity("require_x_api_key")}
            />
            <span>X-API-Key 요구</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={security.require_jwt_token}
              onChange={patchSecurity("require_jwt_token")}
            />
            <span>JWT 토큰 요구</span>
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-600">API Key (보관 주의)</span>
              <input
                className="border rounded-lg px-3 py-2"
                value={security.api_key ?? ""}
                onChange={patchSecurity("api_key")}
                placeholder="예: x-api-key 값"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            ※ 운영 환경의 API Key는 외부에 노출되지 않도록 주의하세요.
          </p>
        </div>
      </section>

      {/* 중단: 성능 및 캐시 설정 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold mb-4">성능 및 캐시 설정</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
          <label className="flex flex-col">
            <span className="mb-1 text-gray-600">요청 한도(분당)</span>
            <input
              type="number"
              min={1}
              className="border rounded-lg px-3 py-2"
              value={performance.request_limit_per_minute}
              onChange={patchPerformance("request_limit_per_minute")}
            />
            <span className="mt-1 text-xs text-gray-400">
              너무 낮으면 사용성이 떨어지고, 너무 높으면 서버 부하가 커질 수 있습니다.
            </span>
          </label>

          <label className="flex flex-col">
            <span className="mb-1 text-gray-600">캐시 TTL(초)</span>
            <input
              type="number"
              min={0}
              className="border rounded-lg px-3 py-2"
              value={performance.cache_ttl_seconds}
              onChange={patchPerformance("cache_ttl_seconds")}
            />
            <span className="mt-1 text-xs text-gray-400">
              0이면 캐시를 사용하지 않고, 값이 클수록 응답은 빠르지만 최신성이 떨어질 수 있습니다.
            </span>
          </label>
        </div>
      </section>

      {/* 하단: API 연결 설정 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold mb-4">API 연결 설정</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <label className="flex flex-col">
            <span className="mb-1 text-gray-600">API Base URL</span>
            <input
              className="border rounded-lg px-3 py-2"
              value={api.api_base_url}
              onChange={patchApi("api_base_url")}
              placeholder="예: http://localhost:8000"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ※ apiClient에서 VITE_API_BASE_URL 또는 settings.app.apiBase를 읽어 사용하도록 후속
          연결이 가능합니다.
        </p>
      </section>

      {/* 하단 버튼 */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={loadAdvanced}
          disabled={isLoading || isSaving}
          className="px-3 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 disabled:opacity-60"
        >
          다시 불러오기
        </button>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm disabled:opacity-60"
        >
          {isSaving ? "저장 중..." : "저장"}
        </button>
      </div>
    </div>
  );
}
