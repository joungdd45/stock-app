// C:\dev\stock-app\stock-gui\src\pages\settings\Basic\BasicPage.tsx
// 역할: 설정 > 기본설정 (사용자·권한, 페이지 설정) + 좌측 상단 로컬 탭
// 의존: react-router-dom(NavLink), Tailwind, settingsAdapter
// 비고: 페이지 설정은 백엔드 기준으로 저장하고, 일부를 로컬스토리지(settings.app)에 참고용으로 저장

import React, { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  settingsAdapter,
  type SettingsUserRole,
  type SettingsBasicUserItem,
  type SettingsBasicPageConfig,
} from "@/api/adapters/settings.adapter";
import { handleError } from "@/utils/handleError";

type Role = SettingsUserRole;

type NewUserForm = {
  username: string; // ID(이메일 아님)
  name: string;
  role: Role;
};

type AppSettings = {
  pageSize: number;
  theme: "라이트" | "다크";
};

const STORAGE_KEY = "settings.app";

const ROLE_LABEL: Record<Role, string> = {
  admin: "관리자",
  manager: "직원",
  user: "조회전용",
};

function loadLocalSettingsFallback(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { pageSize: 20, theme: "라이트" };
    const parsed = JSON.parse(raw);
    return {
      pageSize: Number(parsed.pageSize) || 20,
      theme: parsed.theme === "다크" ? "다크" : "라이트",
    };
  } catch {
    return { pageSize: 20, theme: "라이트" };
  }
}

function saveLocalSettings(data: AppSettings) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        pageSize: data.pageSize,
        theme: data.theme,
      }),
    );
  } catch {
    // 로컬스토리지 실패는 무시
  }
}

export default function BasicPage() {
  // ───────────────────────────────────────────────────────────
  // 로컬 탭 활성 라우팅
  const tabs = useMemo(
    () => [
      { to: "/settings/basic", label: "기본설정" },
      { to: "/settings/advanced", label: "고급설정" },
    ],
    [],
  );

  // ───────────────────────────────────────────────────────────
  // 사용자 목록 / 폼 상태
  const [users, setUsers] = useState<SettingsBasicUserItem[]>([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [isSavingUser, setIsSavingUser] = useState(false);

  const [newUser, setNewUser] = useState<NewUserForm>({
    username: "",
    name: "",
    role: "manager",
  });

  // 사용자 목록 조회
  const fetchUsers = async () => {
    setIsLoadingUsers(true);
    const res = await settingsAdapter.fetchUsers();
    setIsLoadingUsers(false);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      } else {
        alert("사용자 목록을 불러오지 못했습니다.");
      }
      return;
    }

    setUsers(res.data.items ?? []);
  };

  const handleNewUserChange =
    (field: keyof NewUserForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value = e.target.value;
      setNewUser((prev) => ({
        ...prev,
        [field]: field === "role" ? (value as Role) : value,
      }));
    };

  const handleCreateUser = async () => {
    if (!newUser.username.trim() || !newUser.name.trim()) {
      alert("이름과 아이디를 입력하세요.");
      return;
    }

    setIsSavingUser(true);
    const res = await settingsAdapter.createUser({
      username: newUser.username.trim(),
      name: newUser.name.trim(),
      role: newUser.role,
    });
    setIsSavingUser(false);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      } else {
        alert("사용자 추가에 실패했습니다.");
      }
      return;
    }

    setUsers((prev) => [...prev, res.data]);
    setNewUser({ username: "", name: "", role: "manager" });
    alert("사용자가 추가되었습니다.");
  };

  const handleUserFieldChange =
    (id: number, field: keyof SettingsBasicUserItem) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value =
        field === "is_active"
          ? (e as React.ChangeEvent<HTMLInputElement>).target.checked
          : e.target.value;

      setUsers((prev) =>
        prev.map((u) =>
          u.id === id
            ? {
                ...u,
                [field]:
                  field === "role"
                    ? (value as Role)
                    : field === "is_active"
                    ? Boolean(value)
                    : value,
              }
            : u,
        ),
      );
    };

  const handleUpdateUser = async (user: SettingsBasicUserItem) => {
    setIsSavingUser(true);
    const res = await settingsAdapter.updateUser(user.id, {
      name: user.name,
      role: user.role,
      is_active: user.is_active,
    });
    setIsSavingUser(false);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      } else {
        alert("사용자 수정에 실패했습니다.");
      }
      return;
    }

    setUsers((prev) => prev.map((u) => (u.id === user.id ? res.data! : u)));
    alert("사용자 정보가 저장되었습니다.");
  };

  const handleDeleteUser = async (user: SettingsBasicUserItem) => {
    if (!window.confirm(`정말로 '${user.name}' 사용자를 삭제하시겠습니까?`)) return;

    const res = await settingsAdapter.deleteUser(user.id);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      } else {
        alert("사용자 삭제에 실패했습니다.");
      }
      return;
    }

    setUsers((prev) => prev.filter((u) => u.id !== user.id));
    alert("사용자가 삭제되었습니다.");
  };

  // ───────────────────────────────────────────────────────────
  // 페이지 설정 (백엔드 + 로컬스토리지 참고)
  const [pageSettings, setPageSettings] = useState<AppSettings>(() =>
    loadLocalSettingsFallback(),
  );
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [isSavingPage, setIsSavingPage] = useState(false);

  const applyPageConfig = (config: SettingsBasicPageConfig) => {
    const mapped: AppSettings = {
      pageSize: config.page_size,
      theme: config.theme === "다크" ? "다크" : "라이트",
    };
    setPageSettings(mapped);
    saveLocalSettings(mapped);
  };

  const fetchMyPageConfig = async () => {
    setIsLoadingPage(true);
    const res = await settingsAdapter.getMyPageConfig();
    setIsLoadingPage(false);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      }
      // 실패해도 로컬 기본값으로 진행
      return;
    }

    applyPageConfig(res.data);
  };

  const handleSavePageConfig = async () => {
    setIsSavingPage(true);
    const res = await settingsAdapter.updateMyPageConfig({
      page_size: pageSettings.pageSize,
      theme: pageSettings.theme,
    });
    setIsSavingPage(false);

    if (!res.ok || !res.data) {
      if (res.error) {
        handleError(res.error);
      } else {
        alert("페이지 설정 저장에 실패했습니다.");
      }
      return;
    }

    applyPageConfig(res.data);
    alert("기본설정이 저장되었습니다.");
  };

  // ───────────────────────────────────────────────────────────
  // 초기 데이터 로딩
  useEffect(() => {
    fetchUsers();
    fetchMyPageConfig();
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
              value={newUser.name}
              onChange={handleNewUserChange("name")}
            />
            <input
              className="border rounded-lg px-3 py-2"
              placeholder="아이디"
              value={newUser.username}
              onChange={handleNewUserChange("username")}
            />
            <select
              className="border rounded-lg px-3 py-2"
              value={newUser.role}
              onChange={handleNewUserChange("role")}
            >
              <option value="admin">관리자</option>
              <option value="manager">직원</option>
              <option value="user">조회전용</option>
            </select>
          </div>

          <div className="mt-3">
            <button
              onClick={handleCreateUser}
              disabled={isSavingUser}
              className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm disabled:opacity-60"
            >
              {isSavingUser ? "저장 중..." : "사용자 추가"}
            </button>
          </div>

          <div className="mt-4">
            {isLoadingUsers ? (
              <p className="text-sm text-gray-500">
                사용자 목록을 불러오는 중입니다...
              </p>
            ) : users.length === 0 ? (
              <p className="text-sm text-gray-500">
                등록된 사용자가 없습니다.
              </p>
            ) : (
              <ul className="space-y-2">
                {users.map((u) => (
                  <li
                    key={u.id}
                    className="flex flex-col md:flex-row md:items-center md:justify-between border rounded-lg px-3 py-2 gap-2"
                  >
                    <div className="flex-1 text_sm space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          className="border rounded px-2 py-1 text-sm w-36"
                          value={u.name}
                          onChange={handleUserFieldChange(u.id, "name")}
                        />
                        <span className="text-gray-500 text-xs">
                          ID:{" "}
                          <span className="font-mono">{u.username}</span>
                        </span>
                        <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs">
                          {ROLE_LABEL[u.role]}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                        <label className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={u.is_active}
                            onChange={handleUserFieldChange(u.id, "is_active")}
                          />
                          <span>활성화</span>
                        </label>
                        <span>로그인 횟수 {u.login_count}</span>
                        <span>
                          마지막 로그인:{" "}
                          {u.last_login_at
                            ? new Date(
                                u.last_login_at,
                              ).toLocaleString()
                            : "없음"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <select
                        className="border rounded px-2 py-1 text-xs"
                        value={u.role}
                        onChange={handleUserFieldChange(u.id, "role")}
                      >
                        <option value="admin">관리자</option>
                        <option value="manager">직원</option>
                        <option value="user">조회전용</option>
                      </select>
                      <button
                        onClick={() => handleUpdateUser(u)}
                        className="px-2 py-1 rounded bg-gray-900 text-white"
                      >
                        저장
                      </button>
                      <button
                        onClick={() => handleDeleteUser(u)}
                        className="px-2 py-1 rounded border border-gray-300 text-gray-700"
                      >
                        삭제
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* 페이지 설정 */}
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-base font-semibold mb-4">페이지 설정</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col text-sm">
              <span className="mb-1 text-gray-600">페이지당 개수</span>
              <input
                type="number"
                min={5}
                max={200}
                className="border rounded-lg px-3 py-2"
                value={pageSettings.pageSize}
                onChange={(e) =>
                  setPageSettings((s) => ({
                    ...s,
                    pageSize: Number(e.target.value || 20),
                  }))
                }
              />
            </label>

            <label className="flex flex_col text-sm flex-col">
              <span className="mb-1 text-gray-600">테마</span>
              <select
                className="border rounded-lg px-3 py-2"
                value={pageSettings.theme}
                onChange={(e) =>
                  setPageSettings((s) => ({
                    ...s,
                    theme: e.target.value as AppSettings["theme"],
                  }))
                }
              >
                <option value="라이트">라이트</option>
                <option value="다크">다크</option>
              </select>
            </label>
          </div>

          <div className="mt-4">
            <button
              onClick={handleSavePageConfig}
              disabled={isSavingPage || isLoadingPage}
              className="px-3 py-2 rounded-xl bg-gray-900 text-white text-sm disabled:opacity-60"
            >
              {isSavingPage ? "저장 중..." : "저장"}
            </button>
          </div>

          <p className="mt-2 text-xs text-gray-500">
            ※ 백엔드에 저장된 설정을 기준으로 사용하며, 일부 값은 로컬에도
            참고용으로 저장합니다.
          </p>
        </section>
      </div>
    </div>
  );
}
