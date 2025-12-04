/* C:\dev\stock-mobile\src\components\layout\AppShell.tsx */
/**
 * 공통 레이아웃
 *  - COLORS 디자인 토큰
 *  - AppShell(헤더 + 본문 + 탭바)
 *  - TabBar
 *  - Card / Field / TextInput / PrimaryButton
 */

import React from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Home, PackagePlus, PackageMinus, Boxes } from "lucide-react";

export const COLORS = {
  primary: "#FCB40C",
  primaryShade: "#E09C00",
  main: "#1E293B",
  textWhite: "#FFFFFF",
  textGray: "#6B6B6B",
  bgLight: "#F8F9FA",
  line: "#939393",
  success: "#10B981",
  warning: "#F59E0B",
  error: "#EF4444",
} as const;

interface AppShellProps {
  children: React.ReactNode;
  title?: string;
}

export const AppShell: React.FC<AppShellProps> = ({ children, title }) => {
  const location = useLocation();
  const isLogin = location.pathname.startsWith("/login");

  return (
    <div
      className="mx-auto max-w-md min-h-screen flex flex-col"
      style={{ backgroundColor: COLORS.bgLight }}
    >
      {!isLogin && (
        <header className="px-4 pt-5 pb-3 bg-white sticky top-0 z-10 shadow-sm">
          <h1 className="text-xl font-semibold" style={{ color: COLORS.main }}>
            {title ?? ""}
          </h1>
        </header>
      )}

      <main className="flex-1 p-4">{children}</main>

      {!isLogin && <TabBar />}
    </div>
  );
};

const TabBar: React.FC = () => {
  const tabs = [
    { to: "/", label: "메인", icon: <Home size={20} /> },
    { to: "/inbound", label: "입고관리", icon: <PackagePlus size={20} /> },
    { to: "/outbound", label: "출고관리", icon: <PackageMinus size={20} /> },
    { to: "/stock", label: "재고관리", icon: <Boxes size={20} /> },
  ];

  return (
    <nav
      className="sticky bottom-0 bg-[#1E293B] border-t"
      style={{ borderColor: COLORS.main }}
    >
      <ul className="max-w-md mx-auto grid grid-cols-4">
        {tabs.map((t) => (
          <li key={t.to}>
            <NavLink
              to={t.to}
              className="flex flex-col items-center justify-center py-2 text-[12px] font-medium"
              end={t.to === "/"}
            >
              {({ isActive }) => (
                <div
                  className="flex flex-col items-center justify-center px-3 py-1 rounded-2xl"
                  style={{
                    backgroundColor: isActive ? COLORS.textWhite : "transparent",
                    color: isActive ? COLORS.main : COLORS.textWhite,
                  }}
                >
                  <div className="mb-0.5">{t.icon}</div>
                  <span>{t.label}</span>
                </div>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
};

interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export const Card: React.FC<CardProps> = ({ children, className = "" }) => (
  <div
    className={`bg-white rounded-2xl shadow-sm border ${className}`}
    style={{ borderColor: COLORS.line }}
  >
    {children}
  </div>
);

interface FieldProps {
  label?: string;
  children: React.ReactNode;
}

export const Field: React.FC<FieldProps> = ({ label, children }) => (
  <label className="block text-sm">
    {label && (
      <span className="mb-1 inline-block" style={{ color: COLORS.textGray }}>
        {label}
      </span>
    )}
    {children}
  </label>
);

export const TextInput: React.FC<
  React.InputHTMLAttributes<HTMLInputElement>
> = (props) => (
  <input
    {...props}
    className={`w-full h-11 px-4 rounded-xl border-2 outline-none bg-white ${
      props.className ?? ""
    }`}
    style={{ borderColor: COLORS.line }}
  />
);

export const PrimaryButton: React.FC<
  React.ButtonHTMLAttributes<HTMLButtonElement>
> = ({ children, className, ...rest }) => (
  <button
    {...rest}
    className={`h-11 w-full rounded-xl font-medium active:translate-y-[1px] disabled:opacity-50 ${
      className ?? ""
    }`}
    style={{ backgroundColor: COLORS.textWhite, color: COLORS.main }}
  >
    {children}
  </button>
);

export default AppShell;
