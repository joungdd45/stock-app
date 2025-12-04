/* C:\dev\stock-mobile\src\auth\RequireAuth.tsx */
/**
 * 로그인 여부를 체크해서 보호된 라우트를 감싸는 컴포넌트
 * - 기준: useAuth().authed
 * - 미인증 시 /login 으로 리다이렉트
 */

import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./useAuth";

interface RequireAuthProps {
  children: React.ReactNode;
}

export const RequireAuth: React.FC<RequireAuthProps> = ({ children }) => {
  const { authed } = useAuth();
  const location = useLocation();

  if (!authed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <>{children}</>;
};
