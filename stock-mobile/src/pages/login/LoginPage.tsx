/* 📄 C:\dev\stock-mobile\src\pages\login\LoginPage.tsx
   역할:
   - 모바일 로그인
   - loginAdapter.login 사용
   - 로그인 성공 시 PC와 동일한 로컬스토리지 키로 토큰·유저정보 저장
   - 에러는 handleError로 일원화(토스트는 ApiHub 쪽에서 처리)
   - 서버 상태 확인 멘트 표시(PC처럼) — ping은 UI표시만, 토스트는 띄우지 않음
*/

import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { loginAdapter } from "../../api/adapters/login.adapter";
import { handleError } from "@/api/hub/apiHub";
import { COLORS } from "../../components/layout/AppShell";

type ServerStatus = "checking" | "ok" | "fail";

const LoginPage: React.FC = () => {
  const nav = useNavigate();
  const location = useLocation() as any;

  const [id, setId] = useState("");
  const [pw, setPw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ✅ 서버 상태 멘트 (PC처럼)
  const [serverStatus, setServerStatus] = useState<ServerStatus>("checking");
  const [serverHint, setServerHint] = useState<string>("서버 연결 확인 중...");

  const canSubmit = useMemo(() => {
    return !submitting && id.trim().length > 0 && pw.trim().length > 0;
  }, [id, pw, submitting]);

  const checkServerOnce = async () => {
    setServerStatus("checking");
    setServerHint("서버 연결 확인 중...");

    try {
      const res = await loginAdapter.ping();
      // ping은 "UI표시용"이므로 토스트를 띄우지 않는다.
      if (res.ok) {
        setServerStatus("ok");
        setServerHint("서버 연결됨");
      } else {
        setServerStatus("fail");
        setServerHint("서버 연결 불가");
      }
    } catch {
      // 네트워크 예외도 UI표시만
      setServerStatus("fail");
      setServerHint("서버 연결 불가");
    }
  };

  useEffect(() => {
    void checkServerOnce();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    setSubmitting(true);

    try {
      const res = await loginAdapter.login({ id: id.trim(), password: pw.trim() });

      if (res.ok && res.data) {
        // res.data 또는 res.data.result 둘 다 대응
        const raw: any = res.data;
        const payload =
          raw && "access_token" in raw
            ? raw
            : raw && raw.result && "access_token" in raw.result
            ? raw.result
            : null;

        if (!payload) {
          // 예상과 다른 응답 구조일 경우 에러로 처리(토스트)
          handleError({
            code: "FRONT-PARSE-001",
            message: "로그인 응답 형식이 올바르지 않습니다.",
          } as any);
          return;
        }

        const { access_token, refresh_token, user } = payload;

        // ✅ PC 웹과 동일한 키로 저장
        localStorage.setItem("accessToken", access_token);
        localStorage.setItem("refreshToken", refresh_token ?? "");
        localStorage.setItem("currentUser", JSON.stringify(user ?? null));
        localStorage.setItem("auth_token", "demo-token");
        localStorage.setItem("authed", "1");

        // ✅ 기존 모바일용 JWT 키도 유지
        localStorage.setItem("stock.jwt", access_token);

        const redirectTo = location.state?.from?.pathname ?? "/main";
        nav(redirectTo, { replace: true });
        return;
      }

      // ok=false + error 내려온 경우(토스트)
      if (res && (res as any).error) {
        handleError((res as any).error);
        return;
      }

      // 혹시 모를 예외 케이스(토스트)
      handleError({
        code: "FRONT-LOGIN-001",
        message: "로그인에 실패했습니다.",
      } as any);
    } catch (err) {
      // ✅ 네트워크/axios throw도 여기서 토스트로 일원화
      handleError(err as any);
    } finally {
      setSubmitting(false);
    }
  };

  const statusDotColor =
    serverStatus === "ok" ? "#16A34A" : serverStatus === "fail" ? "#DC2626" : "#64748B";

  const statusTextColor =
    serverStatus === "ok" ? "#16A34A" : serverStatus === "fail" ? "#DC2626" : "#64748B";

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundColor: COLORS.main }}
    >
      <div
        className="w-full max-w-sm bg-white rounded-2xl shadow-md border p-6"
        style={{ borderColor: COLORS.line }}
      >
        <div className="mb-4 text-center" style={{ color: COLORS.main }}>
          <div className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-tight">
            <span>재고</span>
            <span>이찌</span>
          </div>
          <div className="text-sm opacity-90 mt-1">경영관리시스템</div>

          {/* ✅ 서버 상태 멘트 (PC처럼) */}
          <div className="mt-3 flex items-center justify-center gap-2 text-sm">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: statusDotColor }}
            />
            <span style={{ color: statusTextColor }}>{serverHint}</span>

            <button
              type="button"
              onClick={() => void checkServerOnce()}
              className="ml-2 px-2 py-1 rounded-lg border text-xs"
              style={{ borderColor: COLORS.line, color: "#334155" }}
            >
              새로고침
            </button>
          </div>
        </div>

        <form onSubmit={onSubmit} className="space-y-3">
          {/* ID */}
          <label className="block text-sm">
            <span className="mb-1 inline-block" style={{ color: "#6B6B6B" }}>
              ID
            </span>
            <input
              className="w-full h-11 px-4 rounded-xl border-2 outline-none bg-white"
              style={{ borderColor: COLORS.line }}
              placeholder="아이디"
              value={id}
              onChange={(e) => setId(e.target.value)}
              autoComplete="username"
            />
          </label>

          {/* Password */}
          <label className="block text-sm">
            <span className="mb-1 inline-block" style={{ color: "#6B6B6B" }}>
              Password
            </span>
            <input
              type="password"
              className="w-full h-11 px-4 rounded-xl border-2 outline-none bg-white"
              style={{ borderColor: COLORS.line }}
              placeholder="비밀번호"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              autoComplete="current-password"
            />
          </label>

          {/* Save ID (기능은 나중에) */}
          <div className="flex items-center justify-between pt-1">
            <label
              className="inline-flex items-center gap-2 text-sm"
              style={{ color: "#6B6B6B" }}
            >
              <input type="checkbox" className="h-4 w-4" />
              <span>ID 저장</span>
            </label>
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={!canSubmit}
            className="h-11 w-full rounded-xl font-medium active:translate-y-[1px] disabled:opacity-50"
            style={{
              backgroundColor: COLORS.textWhite,
              color: "#1E293B",
            }}
          >
            {submitting ? "로그인 중..." : "LOGIN"}
          </button>

          {/* 서버 fail일 때 안내(토스트 대신 안내문) */}
          {serverStatus === "fail" && (
            <div className="text-xs text-center mt-2" style={{ color: "#DC2626" }}>
              서버가 꺼져있거나 네트워크가 불안정할 수 있어. 먼저 서버 상태를 확인해줘.
            </div>
          )}
        </form>
      </div>
    </div>
  );
};

export default LoginPage;
