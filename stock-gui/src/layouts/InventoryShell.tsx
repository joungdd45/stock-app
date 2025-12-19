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
      {/* ✅ 화면(Viewport)에 고정: 바깥(body/html)은 스크롤 없음. 모든 렌더링은 이 안에서만 */}
      <div className="fixed inset-0 flex bg-slate-50 overflow-hidden">
        {/* ✅ 사이드바를 항상 “위 레이어”로: 우측 내용이 라인 위로 침범 못함 */}
        <aside className="relative z-20 w-[248px] shrink-0 overflow-hidden bg-slate-900">
          <Sidebar />
        </aside>

        {/* ✅ 우측 영역은 경계선 + 클리핑: 내용은 이 박스 안에서만 렌더링 */}
        <div className="relative z-10 flex-1 min-w-0 flex flex-col overflow-hidden border-l border-gray-200 bg-slate-50">
          {/* 헤더: 우측 영역 안에서만 존재 */}
          <header className="shrink-0 border-b border-gray-200 bg-white px-4 py-6">
            {title && <h1 className="text-lg font-semibold leading-7">{title}</h1>}
          </header>

          {/* ✅ 스크롤은 여기서만, 가로는 완전 차단 */}
          <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden">
            {/* ✅ Outlet도 우측 박스 안에만: 혹시 모를 overflow 방지 */}
            <div className="p-4 min-w-0 max-w-full overflow-hidden">
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
