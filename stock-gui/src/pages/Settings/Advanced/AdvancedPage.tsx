// C:\dev\stock-app\stock-gui\src\pages\settings\Advanced\AdvancedPage.tsx
// 역할: 설정 > 고급설정 (보안 + API 연결) + 좌측 상단 로컬 탭
// 저장: 로컬스토리지 settings.app 일부 필드 저장 (apiBase 등)

import React, { useMemo, useState } from "react";
import { NavLink } from "react-router-dom";

type AdvancedSettings = {
  // 보안
  requireApiKey: boolean;
  requireJwt: boolean;

  // API 연결
  apiBase: string;
  apiKey?: string;
};

const STORAGE_KEY = "settings.app";

function loadAdvanced(): AdvancedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const base = raw ? JSON.parse(raw) : {};
    return {
      requireApiKey: !!base.requireApiKey,
      requireJwt: !!base.requireJwt,
      apiBase: typeof base.apiBase === "string" ? base.apiBase : "",
      apiKey: typeof base.apiKey === "string" ? base.apiKey : "",
    };
  } catch {
    return { requireApiKey: false, requireJwt: false, apiBase: "", apiKey: "" };
  }
}

export default function AdvancedPage() {
  const tabs = useMemo(
    () => [
      { to: "/settings/basic", label: "기본설정" },
      { to: "/settings/advanced", label: "고급설정" },
    ],
    []
  );

  const [values, setValues] = useState<AdvancedSettings>(() => loadAdvanced());

  const save = () => {
    try {
      const prev = localStorage.getItem(STORAGE_KEY);
      const merged = { ...(prev ? JSON.parse(prev) : {}), ...values };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
      alert("고급설정이 저장되었습니다.");
    } catch {
      alert("저장 중 오류가 발생했습니다.");
    }
  };

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

      {/* 보안 */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold mb-4">보안</h2>
        <div className="flex flex-col gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.requireApiKey}
              onChange={(e) =>
                setValues((s) => ({ ...s, requireApiKey: e.target.checked }))
              }
            />
            X-API-Key 요구
          </label>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.requireJwt}
              onChange={(e) =>
                setValues((s) => ({ ...s, requireJwt: e.target.checked }))
              }
            />
            JWT 토큰 요구
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-600">API Key (보관 주의)</span>
              <input
                className="border rounded-lg px-3 py-2"
                value={values.apiKey ?? ""}
                onChange={(e) =>
                  setValues((s) => ({ ...s, apiKey: e.target.value }))
                }
                placeholder="예: sk_live_xxx"
              />
            </label>
          </div>
          <p className="text-xs text-gray-500">
            ※ 실제 백엔드 미들웨어 적용은 별도. 현재 화면은 설정 값을 보관하는 용도.
          </p>
        </div>
      </section>

      {/* API 연결 (성능·캐시 섹션 자리로 이동) */}
      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold mb-4">API 연결</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="flex flex-col text-sm">
            <span className="mb-1 text-gray-600">API Base URL</span>
            <input
              className="border rounded-lg px-3 py-2"
              value={values.apiBase}
              onChange={(e) =>
                setValues((s) => ({ ...s, apiBase: e.target.value }))
              }
              placeholder="예: http://localhost:8000"
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-gray-500">
          ※ apiClient에서 VITE_API_BASE_URL 또는 settings.app.apiBase를 읽어 사용하도록 후속 연결 가능.
        </p>
      </section>

      <div>
        <button
          onClick={save}
          className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm"
        >
          저장
        </button>
      </div>
    </div>
  );
}
