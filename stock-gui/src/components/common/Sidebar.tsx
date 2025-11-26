// 📄 src/components/common/Sidebar.tsx
// 역할: NAV_ITEMS 기반 단일 아코디언 사이드바(클릭으로만 열림, 한 섹션만 열림)
// - 라우트 하이라이트는 NavLink가 맡고, 펼침/접힘은 로컬 상태로만 제어
// - 최상위 섹션만 아코디언(한 번에 한 섹션만 열림)
// - 하위(children)는 리스트로 렌더(필요하면 중첩 렌더 지원)

import React, { useCallback, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import type { NavItem } from "../../constants/navigation";
import { NAV_ITEMS } from "../../constants/navigation";

type ChildProps = {
  items: NavItem[];
  level: number;
};

const itemBase = "block px-4 py-2 text-sm rounded-r-2xl transition";
const itemActive = "bg-slate-800 text-white font-medium";
const itemIdle = "text-slate-300 hover:bg-slate-800/60 hover:text-white";

function ChildList({ items, level }: ChildProps) {
  const pad = 8 + level * 10;
  return (
    <ul className="space-y-1">
      {items.map((child, idx) => {
        const key = `${child.label}-${idx}`;
        const style = { paddingLeft: pad };
        const hasChildren = Boolean(child.children?.length);

        if (!hasChildren) {
          return (
            <li key={key}>
              {child.path ? (
                <NavLink
                  to={child.path}
                  className={({ isActive }) =>
                    [itemBase, isActive ? itemActive : itemIdle].join(" ")
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
          <li key={key}>
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
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggle = useCallback(
    (idx: number) => {
      setOpenIndex((prev) => (prev === idx ? null : idx));
    },
    [setOpenIndex]
  );

  return (
    <aside className="h-screen w-60 bg-slate-900 text-slate-100 flex flex-col">
      {/* 헤더 */}
      <div className="px-4 py-4 border-b border-slate-800">
        <div className="text-lg font-semibold">재고이찌</div>
        <div className="text-xs text-slate-400">Inventory System 2.0</div>
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 overflow-y-auto py-3">
        <div className="px-4 pb-2 text-xs text-slate-400"></div>

        <ul className="space-y-1">
          {topSections.map((item, idx) => {
            const hasChildren = Boolean(item.children?.length);
            const expanded = openIndex === idx;

            // [NOAH PATCH START] leaf(예: 메인) 클릭 시 아코디언 닫기
            if (!hasChildren) {
              return (
                <li key={`${item.label}-${idx}`}>
                  {item.path ? (
                    <NavLink
                      to={item.path}
                      onClick={() => setOpenIndex(null)} // ← 클릭 시 모든 섹션 접기
                      className={({ isActive }) =>
                        [itemBase, isActive ? itemActive : itemIdle].join(" ")
                      }
                    >
                      {item.label}
                    </NavLink>
                  ) : (
                    <div className={[itemBase, itemIdle].join(" ")}>
                      {item.label}
                    </div>
                  )}
                </li>
              );
            }
            // [NOAH PATCH END]

            return (
              <li key={`${item.label}-${idx}`}>
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  aria-expanded={expanded}
                  className={[
                    "w-full text-left px-4 py-2.5 text-sm rounded-r-2xl transition",
                    expanded ? itemActive : itemIdle,
                  ].join(" ")}
                >
                  {item.label}
                </button>

                {expanded && (
                  <div className="pl-2">
                    <ChildList items={item.children!} level={1} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </nav>

      {/* 푸터 */}
      <div className="px-4 py-3 border-t border-slate-800 text-[11px] text-slate-400">
        DJ정 제작 - 모두이찌
      </div>
    </aside>
  );
}
