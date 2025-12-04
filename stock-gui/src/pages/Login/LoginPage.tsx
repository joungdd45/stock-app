// 📄 src/pages/Login/LoginPage.tsx
// 역할: 로그인 페이지 (디자인 + 로그인 어댑터 연동)
// 규칙:
//  - 백엔드 호출은 loginAdapter만 사용
//  - axios, apiHub, "/api/..." 문자열을 직접 쓰지 않는다.

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loginAdapter } from "@/api/adapters/login.adapter";
import { handleError } from "@/utils/handleError";

export default function LoginPage() {
  const navigate = useNavigate();

  // 폼 상태
  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [rememberId, setRememberId] = useState(false);

  // 상태
  const [loading, setLoading] = useState(false);
  const [pingStatus, setPingStatus] =
    useState<"idle" | "ok" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // 페이지 진입 시 서버 핑
  useEffect(() => {
    const doPing = async () => {
      const res = await loginAdapter.ping();
      if (res.ok) {
        setPingStatus("ok");
      } else {
        setPingStatus("error");
        if (res.error) {
          handleError(res.error);
        }
      }
    };
    doPing();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!id || !password) {
      setErrorMessage("아이디와 비밀번호를 모두 입력해 주세요.");
      return;
    }

    setLoading(true);
    try {
      const res = await loginAdapter.login({ id, password });

      if (!res.ok || !res.data) {
        if (res.error) {
          handleError(res.error);
        } else {
          setErrorMessage(
            "로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.",
          );
        }
        return;
      }

      const result = res.data;
      const accessToken = result.access_token;
      const refreshToken = result.refresh_token;
      const user = result.user;

      if (accessToken) {
        localStorage.setItem("accessToken", accessToken);
      }
      if (refreshToken) {
        localStorage.setItem("refreshToken", refreshToken);
      }

      if (user) {
        const userSnapshot = {
          id: user.id,
          username: user.username,
          name: user.name,
          role: user.role,
        };
        localStorage.setItem("currentUser", JSON.stringify(userSnapshot));
      }

      // 아이디 저장 옵션 (추후 활용 가능)
      if (rememberId) {
        localStorage.setItem("rememberLoginId", id);
      } else {
        localStorage.removeItem("rememberLoginId");
      }

      navigate("/main");
    } catch (err) {
      setErrorMessage(
        "예상치 못한 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex items-center justify-center px-6"
      style={{ backgroundColor: "#0f172a" }} // 전체 남색 배경
    >
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-3xl shadow-xl border px-10 py-10">
          {/* 상단 타이틀 */}
          <div className="mb-6 text-center">
            <div className="inline-flex items-center gap-1 text-3xl font-extrabold tracking-tight text-slate-900">
              <span>재고</span>
              <span>이찌</span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              경영관리시스템
            </div>
          </div>

          {/* 서버 상태 */}
          <p className="mb-4 text-center text-[13px] text-slate-800">
            {pingStatus === "idle" && "서버 상태를 확인하는 중입니다..."}
            {pingStatus === "ok" && "서버 연결 정상입니다."}
            {pingStatus === "error" &&
              "서버 상태 확인에 실패했습니다. 설정의 API 주소를 확인해 주세요."}
          </p>

          {/* 에러 메시지 */}
          {errorMessage && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {errorMessage}
            </div>
          )}

          {/* 로그인 폼 */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 아이디 */}
            <label className="block text-sm">
              <span className="mb-0.5 inline-block text-slate-600">
                ID
              </span>
              <input
                type="text"
                value={id}
                onChange={(e) => setId(e.target.value)}
                placeholder="아이디"
                autoComplete="username"
                disabled={loading}
                className="w-full h-11 px-4 rounded-2xl border-2 border-slate-800 bg-white text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
              />
            </label>

            {/* 비밀번호 */}
            <label className="block text-sm">
              <span className="mb-0.5 inline-block text-slate-600">
                Password
              </span>
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="비밀번호"
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full h-11 px-4 pr-16 rounded-2xl border-2 border-slate-800 bg-white text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  disabled={loading}
                  className="absolute inset-y-0 right-2 px-3 text-xs text-slate-500 hover:text-slate-700"
                >
                  {showPw ? "숨기기" : "보기"}
                </button>
              </div>
            </label>

            {/* 옵션 라인 */}
            <div className="flex items-center justify-between pt-1">
              <label className="inline-flex items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={rememberId}
                  onChange={(e) => setRememberId(e.target.checked)}
                  disabled={loading}
                />
                <span>ID 저장</span>
              </label>
            </div>

            {/* 로그인 버튼 */}
            <button
              type="submit"
              disabled={loading}
              className={`mt-2 h-11 w-full rounded-2xl text-sm font-semibold tracking-wide transition ${
                loading
                  ? "bg-slate-300 text-slate-600 cursor-not-allowed"
                  : "bg-slate-900 text-white hover:bg-slate-800 active:translate-y-[1px]"
              }`}
            >
              {loading ? "로그인 중..." : "LOGIN"}
            </button>
          </form>

          {/* 하단 안내 */}
          <p className="mt-6 text-center text-[12px] text-slate-800">
            보안을 위해 공용 PC에서는 사용 후 <br />반드시 로그아웃하세요.
          </p>
        </div>
      </div>
    </div>
  );
}
