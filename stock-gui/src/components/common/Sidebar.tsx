// 📄 src/components/common/Sidebar.tsx
// 역할: NAV_ITEMS 기반 단일 아코디언 사이드바

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import type { NavItem } from "../../constants/navigation";
import { NAV_ITEMS } from "../../constants/navigation";

type ChildProps = {
  items: NavItem[];
  level: number;
};

const itemBase = "block px-4 py-2 text-sm rounded-r-2xl transition";
const itemIdle = "text-slate-300 hover:bg-slate-800/60 hover:text-white";

// 페이지 강조는 "색상"만, 왼쪽 실선 제거
const childActive = "bg-slate-800 text-[#059669] font-semibold";

// 도메인 섹션 스타일 (여기에만 실선 유지)
const sectionBase =
  "w-full text-left px-4 py-2.5 text-sm rounded-r-2xl transition";
const sectionActive =
  "bg-slate-900 text-white font-semibold border-l-4 border-[#059669]";
const sectionIdle = itemIdle;

// 현재 경로가 섹션/페이지 안에 포함되는지
const hasActivePath = (item: NavItem, pathname: string): boolean => {
  if (item.path && pathname.startsWith(item.path)) return true;
  if (item.children && item.children.length)
    return item.children.some((child) => hasActivePath(child, pathname));
  return false;
};

function ChildList({ items, level }: ChildProps) {
  const pad = 8 + level * 10;

  return (
    <ul className="space-y-1">
      {items.map((child, idx) => {
        const hasChildren = child.children && child.children.length > 0;
        const style = { paddingLeft: pad };

        if (!hasChildren) {
          return (
            <li key={child.label + idx}>
              {child.path ? (
                <NavLink
                  to={child.path}
                  className={({ isActive }) =>
                    [itemBase, isActive ? childActive : itemIdle].join(" ")
                  }
                  style={style}
                >
                  {child.label}
                </NavLink>
              ) : (
                <div className={[itemBase, itemIdle].join(" ")} style={style}>
                  {child.label}
                </div>
              )}
            </li>
          );
        }

        return (
          <li key={child.label + idx}>
            <div className={[itemBase, itemIdle].join(" ")} style={style}>
              {child.label}
            </div>
            <div className="pl-2">
              <ChildList items={child.children!} level={level + 1} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default function Sidebar() {
  const topSections = useMemo(() => NAV_ITEMS, []);
  const location = useLocation();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = useCallback(
    (idx: number) => setOpenIndex((prev) => (prev === idx ? null : idx)),
    []
  );

  // 현재 경로의 섹션 자동 오픈
  useEffect(() => {
    const idx = topSections.findIndex((item) =>
      hasActivePath(item, location.pathname)
    );
    if (idx !== -1) setOpenIndex(idx);
  }, [location.pathname, topSections]);

  return (
    <aside className="h-screen w-60 bg-slate-900 text-slate-100 flex flex-col">
      {/* 헤더 */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="text-lg font-semibold">재고이찌</div>
        <div className="text-xs text-slate-400">Inventory System 2.0</div>
      </div>

      {/* NAV */}
      <nav className="flex-1 overflow-y-auto py-3">
        <ul className="space-y-2">
          {topSections.map((sec, idx) => {
            const expanded = openIndex === idx;
            const hasChildren = sec.children && sec.children.length > 0;

            if (!hasChildren) {
              return (
                <li key={sec.label + idx}>
                  <NavLink
                    to={sec.path || "#"}
                    onClick={() => setOpenIndex(null)}
                    className={({ isActive }) =>
                      [itemBase, isActive ? "bg-slate-800 text-white" : itemIdle].join(
                        " "
                      )
                    }
                  >
                    {sec.label}
                  </NavLink>
                </li>
              );
            }

            return (
              <li key={sec.label + idx}>
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className={[
                    sectionBase,
                    expanded ? sectionActive : sectionIdle,
                  ].join(" ")}
                >
                  {sec.label}
                </button>

                {expanded && (
                  <div className="pl-2 mt-1">
                    {/* hasChildren이 true일 때만 오므로 non-null 보장 */}
                    <ChildList items={sec.children!} level={1} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-400">
        DJ정 제작 - 모두이찌
      </div>
    </aside>
  );
}
