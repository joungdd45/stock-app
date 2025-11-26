// src/layouts/InventoryShell.tsx
// 역할: 전역 레이아웃. 좌측 Sidebar + 우측 컨텐츠 + 동적 헤더
import React, { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "../components/common/Sidebar";
import { NAV_ITEMS } from "../constants/navigation";

// ───────────────────────────────────────────────────────────
// HeaderAddonContext: 서브탭/추가요소 등록용 컨텍스트
type HeaderAddonCtx = { setHeaderAddon: (node: ReactNode) => void };
const HeaderAddonContext = createContext<HeaderAddonCtx | null>(null);

export function useHeaderAddon() {
  const ctx = useContext(HeaderAddonContext);
  if (!ctx) throw new Error("useHeaderAddon은 InventoryShell 내부에서만 사용할 수 있습니다.");
  return ctx.setHeaderAddon;
}

export function useHeader() {
  console.warn(
    "useHeader는 더 이상 제목을 직접 세팅하지 않습니다. 서브탭 등 추가영역만 필요하면 useHeaderAddon을 사용하세요."
  );
  return useHeaderAddon();
}
// ───────────────────────────────────────────────────────────
// findLabelsByPath: 부분경로 매칭 지원(등록/조회 탭 공통 타이틀 처리)
function findLabelsByPath(pathname: string): { parent?: string; current?: string } {
  function dfs(items: typeof NAV_ITEMS, parentLabel?: string): { parent?: string; current?: string } | null {
    for (const it of items) {
      // 정확히 일치하거나, 하위 경로가 포함되는 경우도 허용
      if (it.path && (pathname === it.path || pathname.startsWith(it.path + "/"))) {
        return parentLabel ? { parent: parentLabel, current: it.label } : { current: it.label };
      }
      if (it.children && it.children.length) {
        const found = dfs(it.children, it.label);
        if (found) return found;
      }
    }
    return null;
  }
  return dfs(NAV_ITEMS) ?? {};
}
// ───────────────────────────────────────────────────────────

export default function InventoryShell() {
  const [headerAddon, setHeaderAddon] = useState<ReactNode>(null);
  const { pathname } = useLocation();

  const labels = useMemo(() => findLabelsByPath(pathname), [pathname]);
  const title =
    labels.parent && labels.current
      ? `${labels.parent} - ${labels.current}`
      : labels.current ?? labels.parent ?? "";

  const ctxValue = useMemo<HeaderAddonCtx>(() => ({ setHeaderAddon }), []);

  return (
    <HeaderAddonContext.Provider value={ctxValue}>
      {/* [NOAH PATCH] 레이아웃 안정화: 사이드바 고정폭, 본문 가로 넘침 차단, 내부 스크롤 고정 */}
      <div className="min-h-screen w-full flex bg-slate-50 overflow-hidden">
        {/* 좌측 사이드바: 고정폭 + shrink-0로 폭 유지 */}
        <aside className="w-[248px] shrink-0">
          <Sidebar />
        </aside>

        {/* 우측 영역: 가로 넘침 차단을 위해 min-w-0 + overflow-x-hidden */}
        <div className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
          {/* 헤더: 타이틀 (고정 영역) */}
          <header className="border-b border-gray-200 bg-white px-4 py-6">
            {title && <h1 className="text-lg font-semibold leading-7">{title}</h1>}
          </header>

          {/* 메인: 내부 스크롤 컨테이너에서만 세로 스크롤 → 사이드바 흔들림 방지 */}
          <main
            className="flex-1 overflow-y-scroll"
            style={{ scrollbarGutter: "stable both-edges" }}
          >
            <div className="p-4">
              {/* 서브탭/추가영역을 좌측 상단에 고정 표시 */}
              {headerAddon && (
                <div
                  className="
                    mb-3
                    [&_*]:mb-0
                    [&>div]:mb-0
                    [&>button]:mb-0
                  "
                >
                  {headerAddon}
                </div>
              )}

              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </HeaderAddonContext.Provider>
  );
}
