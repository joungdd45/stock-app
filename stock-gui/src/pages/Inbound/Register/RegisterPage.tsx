// 📄 src/pages/Inbound/Register/RegisterPage.tsx
import React from "react";
import { NavLink } from "react-router-dom";
import { ROUTES } from "../../../constants/routes";

type Props = { children: React.ReactNode };

export default function RegisterPage({ children }: Props) {
  const base = ROUTES.INBOUND.REGISTER;

  return (
    <div className="flex flex-col gap-3">
      {/* 탭 바 */}
      <div className="flex items-center gap-2 border-b border-gray-200">
        <TabLink to={base.QUERY} label="조회" />
        <TabLink to={base.FORM} label="등록" />
      </div>

      {/* 실제 페이지 내용 */}
      <div>{children}</div>
    </div>
  );
}

function TabLink({ to, label }: { to: string; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          "px-4 py-2 text-sm rounded-t-lg",
          isActive
            ? "bg-white border border-b-0 border-gray-200 font-semibold"
            : "text-gray-600 hover:text-gray-800"
        ].join(" ")
      }
    >
      {label}
    </NavLink>
  );
}
