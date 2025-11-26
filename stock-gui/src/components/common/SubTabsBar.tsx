// [NOAH PATCH START] SubTabsBar: 임시 인라인 스타일(타일윈드 미적용 대비)
import React from "react";
import { NavLink, useLocation } from "react-router-dom";

export type SubTabItem = {
  to: string;
  label: string;
  disabled?: boolean;
};

type Props = {
  tabs: SubTabItem[];
  right?: React.ReactNode;
  className?: string;
};

export default function SubTabsBar({ tabs, right }: Props) {
  const location = useLocation();

  const wrapStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 8,
  };

  const leftStyle: React.CSSProperties = {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  };

  const btnBase: React.CSSProperties = {
    padding: "6px 10px",
    fontSize: 13,
    borderRadius: 8,
    border: "1px solid var(--border-muted, #d9d9e3)",
    background: "var(--surface-card, #fff)",
    color: "var(--text-secondary, #475569)",
    textDecoration: "none",
    userSelect: "none",
  };

  const activeBtn: React.CSSProperties = {
    ...btnBase,
    color: "var(--primary, #2563eb)",
    borderColor: "var(--primary, #2563eb)",
    fontWeight: 600,
  };

  return (
    <div style={wrapStyle} role="tablist" aria-label="subtabs">
      <div style={leftStyle}>
        {tabs.map((t) => {
          const isActive =
            location.pathname === t.to ||
            (t.to !== "/" && location.pathname.startsWith(t.to + "/"));

          return (
            <NavLink
              key={t.to}
              to={t.disabled ? location.pathname : t.to}
              aria-disabled={t.disabled ? "true" : "false"}
              style={isActive ? activeBtn : btnBase}
              role="tab"
              aria-selected={isActive}
            >
              {t.label}
            </NavLink>
          );
        })}
      </div>
      {right ? <div>{right}</div> : null}
    </div>
  );
}
// [NOAH PATCH END]
