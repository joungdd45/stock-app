/* C:\dev\stock-mobile\src\auth\useAuth.tsx */
/**
 * 인증 컨텍스트 + 훅
 * - loginAdapter.login 사용
 * - access_token / user 정보를 localStorage에 보관
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import {
  loginAdapter,
  type LoginUser,
  type LoginResult,
} from "@/api/adapters/login.adapter";

interface AuthContextValue {
  authed: boolean;
  token: string | null;
  user: LoginUser | null;
  login: (userId: string, password: string) => Promise<boolean>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [authed, setAuthed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<LoginUser | null>(null);

  // 앱 시작 시 저장된 토큰/유저 복구
  useEffect(() => {
    const savedToken = localStorage.getItem(TOKEN_KEY);
    const savedUser = localStorage.getItem(USER_KEY);

    if (savedToken) {
      setToken(savedToken);
      setAuthed(true);
    }
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser) as LoginUser);
      } catch {
        setUser(null);
      }
    }
  }, []);

  // 로그인: loginAdapter.login 사용
  const login = async (userId: string, password: string): Promise<boolean> => {
    if (!userId || !password) {
      return false;
    }

    try {
      const res = await loginAdapter.login({ id: userId, password });

      if (res.ok && res.data) {
        const result: LoginResult = res.data;

        // access_token / user 저장
        localStorage.setItem(TOKEN_KEY, result.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify(result.user));

        setToken(result.access_token);
        setUser(result.user);
        setAuthed(true);
        return true;
      }

      // 에러가 있는 경우 false 반환
      return false;
    } catch (err) {
      console.error("login failed", err);
      return false;
    }
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
    setAuthed(false);
  };

  const value: AuthContextValue = {
    authed,
    token,
    user,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth는 AuthProvider 안에서만 사용할 수 있습니다.");
  }
  return ctx;
};
