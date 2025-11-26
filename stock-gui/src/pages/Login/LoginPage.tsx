// 📄 src\pages\Login\LoginPage.tsx
// 목적: 로그인 페이지 (디자인 전용, API 연동 없음)

import React, { useState } from "react";

export default function LoginPage() {
  const [showPw, setShowPw] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-6">
        <div className="bg-white shadow-lg rounded-2xl p-8">
          {/* 타이틀 */}
          <h1 className="text-2xl font-bold text-gray-900 mb-6 text-center">
            로그인
          </h1>

          {/* 이메일 입력 */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              이메일
            </label>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* 비밀번호 입력 */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              비밀번호
            </label>
            <div className="relative">
              <input
                type={showPw ? "text" : "password"}
                placeholder="비밀번호"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                className="absolute inset-y-0 right-0 px-3 text-sm text-gray-500"
              >
                {showPw ? "숨기기" : "보기"}
              </button>
            </div>
          </div>

          {/* 로그인 버튼 */}
          <button className="w-full rounded-xl bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-700 transition">
            로그인
          </button>

          {/* 하단 안내 */}
          <p className="mt-6 text-center text-xs text-gray-500">
            보안을 위해 공용 PC에서는 사용 후 반드시 로그아웃하세요.
          </p>
        </div>
      </div>
    </div>
  );
}
