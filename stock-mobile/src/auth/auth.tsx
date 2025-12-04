// src/auth/auth.tsx
/**
 * 📄 auth.tsx
 * - useAuth: loginAdapter를 사용하는 인증 훅
 * - RequireAuth: 토큰/플래그 없으면 /login 으로 이동
 *
 * 나중에:
 *  - 토큰 유효성 검사(만료 여부)는 별도 adapter/api로 확장 가능
 */

import React, { useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { loginAdapter, type LoginRequest } from "../api/adapters/login.adapter";

export type LoginPayload = LoginRequest;

export const useAuth = () => {
  const [authed, setAuthed] = useState<boolean>(() => {
    const token = localStorage.getItem("access_token");
    const flag = localStorage.getItem("authed") === "1";
    return !!token && flag;
  });

  const login = async (payload: LoginPayload): Promise<boolean> => {
    const res = await loginAdapter.login(payload);
    if (!res.ok || !res.data) {
      return false;
    }

    // for reference:
    //  - 여기서 user_name, 권한 등도 로컬에 저장 가능
    localStorage.setItem("authed", "1");
    setAuthed(true);
    return true;
  };

  const logout = () => {
    loginAdapter.logout();
    setAuthed(false);
  };

  return { authed, login, logout };
};

export const RequireAuth: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const token = localStorage.getItem("access_token");
  const flag = localStorage.getItem("authed") === "1";
  const isAuthed = !!token && flag;

  const location = useLocation();

  if (!isAuthed) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <>{children}</>;
};
