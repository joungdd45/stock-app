// C:\dev\stock-app\stock-gui\src\pages\settings\Basic\BasicPage.tsx
// 역할: 설정 > 기본설정 (사용자·권한, 페이지 설정) + 좌측 상단 로컬 탭
// 의존: react-router-dom(NavLink), Tailwind
// 저장: 로컬스토리지 settings.app 에 일부 필드 저장 (참고용)

import React, { useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";

type Role = "admin" | "staff" | "viewer";

type NewUser = {
  name: string;
  email: string;
  role: Role;
};

type AppSettings = {
  pageSize: number;
  theme: "light" | "system";
  role?: Role; // 관리자 화면 노출 여부용(참고용)
  apiBase?: string; // 참고용: 고급설정과 연계 예정
};

const STORAGE_KEY = "settings.app";

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pageSize: 20, theme: "light" };
    const parsed = JSON.parse(raw);
    return {
      pageSize: Number(parsed.pageSize) || 20,
      theme: parsed.theme === "system" ? "system" : "light",
      role: parsed.role as Role | undefined,
      apiBase: typeof parsed.apiBase === "string" ? parsed.apiBase : undefined,
    };
  } catch {
    return { pageSize: 20, theme: "light" };
  }
}

export default function BasicPage() {
  const navigate = useNavigate();

  // ───────────────────────────────────────────────────────────
  // 로컬 탭 활성 라우팅
  const tabs = useMemo(
    () => [
      { to: "/settings/basic", label: "기본설정" },
      { to: "/settings/advanced", label: "고급설정" },
    ],
    []
  );

  // ───────────────────────────────────────────────────────────
  // 사용자 추가/권한설정(데모 상태)
  const [users, setUsers] = useState<NewUser[]>([]);
  const [form, setForm] = useState<NewUser>({ name: "", email: "", role: "staff" });

  const addUser = () => {
    if (!form.name.trim() || !form.email.trim()) return;
    setUsers((prev) => [...prev, form]);
    setForm({ name: "", email: "", role: "staff" });
  };

  const removeUser = (idx: number) => {
    setUsers((prev) => prev.filter((_, i) => i !== idx));
  };

  // ───────────────────────────────────────────────────────────
  // 페이지 설정(로컬스토리지 저장)
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings());
  const saveSettings = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    // 가벼운 안내: 토스트 시스템이 있다면 연결 가능(react-hot-toast 등)
    alert("기본설정이 저장되었습니다.");
  };

  useEffect(() => {
    // 관리자만 사이드바에서 설정 탭이 보인다는 요구사항은
    // 현재 OPEN 모드라 가정. 추후 role === "admin" 조건으로 전환 가능.
  }, []);

  return (
    <div className="p-4 space-y-6">
      {/* 로컬 탭: 메인창 좌측 상단 */}
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

      {/* 본문 */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* 사용자 추가 및 권한설정 */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold mb-4">사용자 추가 및 권한설정</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="이름"
              value={form.name}
              onChange={(e) => setForm((s) => ({ ...s, name: e.target.value }))}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="이메일"
              value={form.email}
              onChange={(e) => setForm((s) => ({ ...s, email: e.target.value }))}
            />
            <select
              className="border rounded-lg px-3 py-2"
              value={form.role}
              onChange={(e) => setForm((s) => ({ ...s, role: e.target.value as Role }))}
            >
              <option value="admin">관리자</option>
              <option value="staff">직원</option>
              <option value="viewer">조회</option>
            </select>
          </div>

          <div className="mt-3">
            <button
              onClick={addUser}
              className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm"
            >
              사용자 추가
            </button>
          </div>

          <div className="mt-4">
            {users.length === 0 ? (
              <p className="text-sm text-gray-500">추가된 사용자가 없습니다.</p>
            ) : (
              <ul className="space-y-2">
                {users.map((u, idx) => (
                  <li
                    key={`${u.email}-${idx}`}
                    className="flex items-center justify-between border rounded-lg px-3 py-2"
                  >
                    <div className="text-sm">
                      <span className="font-medium">{u.name}</span>{" "}
                      <span className="text-gray-500">({u.email})</span>{" "}
                      <span className="ml-2 inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs">
                        {u.role}
                      </span>
                    </div>
                    <button
                      onClick={() => removeUser(idx)}
                      className="text-sm text-gray-600 hover:text-gray-900"
                    >
                      제거
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 페이지 설정 */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold mb-4">페이지 설정</h2>

          {/* 역할 제거, 2열 레이아웃 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-600">페이지당 개수</span>
              <input
                type="number"
                min={5}
                max={200}
                className="border rounded-lg px-3 py-2"
                value={settings.pageSize}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    pageSize: Number(e.target.value || 20),
                  }))
                }
              />
            </label>

            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-600">테마</span>
              <select
                className="border rounded-lg px-3 py-2"
                value={settings.theme}
                onChange={(e) =>
                  setSettings((s) => ({
                    ...s,
                    theme: e.target.value as AppSettings["theme"],
                  }))
                }
              >
                <option value="light">라이트</option>
                <option value="system">시스템</option>
              </select>
            </label>
          </div>

          <div className="mt-4">
            <button
              onClick={saveSettings}
              className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm"
            >
              저장
            </button>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            ※ 현재는 로컬 저장만 수행. API 연동은 고급설정과 함께 다음 단계에서 연결.
          </p>
        </section>
      </div>
    </div>
  );
}
