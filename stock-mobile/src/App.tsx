/* C:\dev\stock-mobile\src\App.tsx */
/**
 * 📱 재고이찌 — 모바일 GUI
 * - 라우터 구성 전담
 * - AuthProvider + RequireAuth 연결
 * - ✅ 전역 토스트 무대(항상 렌더)
 * - ✅ apiHub(handleError)가 사용할 토스트 함수 주입(setGlobalToast)
 * - ✅ 앱 시작 시 버전체크(서버 min_app_version) → 미달 시 오버레이 차단 + 종료
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { App as CapacitorApp } from "@capacitor/app";

import { AuthProvider } from "./auth/useAuth";
import { RequireAuth } from "./auth/RequireAuth";

import LoginPage from "./pages/login/LoginPage";
import MainPage from "./pages/main/MainPage";

import InboundListPage from "./pages/inbound/InboundListPage";
import InboundBarcodeScanPage from "./pages/inbound/InboundBarcodeScanPage";
import InboundBarcodeRegisterPage from "./pages/inbound/InboundBarcodeRegisterPage";

import OutboundInvoiceScanPage from "./pages/outbound/OutboundInvoiceScanPage";
import OutboundListPage from "./pages/outbound/OutboundListPage";
import OutboundScanPage from "./pages/outbound/OutboundScanPage";

import StockStatusPage from "./pages/stock/StockStatusPage";
import StockBarcodeScanPage from "./pages/stock/StockBarcodeScanPage";

import { setGlobalToast } from "@/api/hub/apiHub";

/* ─────────────────────────────────────────────
   ✅ 버전체크 설정
─────────────────────────────────────────────*/
const APP_VERSION = "1.0.0";
const VERSION_CHECK_URL = "/api/app/version";
const DEFAULT_BLOCK_MESSAGE = "최신 버전으로 업데이트해 주세요.";

/* ─────────────────────────────────────────────
   ✅ 버전 비교 유틸
─────────────────────────────────────────────*/
function compareVersion(a: string, b: string) {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

async function exitAppSafely() {
  try {
    await CapacitorApp.exitApp();
  } catch {
    try {
      window.close();
    } catch {
      // noop
    }
  }
}

/* ─────────────────────────────────────────────
   ✅ 전역 토스트 UI
─────────────────────────────────────────────*/
type ToastItem = { id: string; message: string };

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function GlobalToastHost({ items }: { items: ToastItem[] }) {
  return (
    <div className="fixed left-0 right-0 bottom-4 z-[9999] px-4 flex flex-col gap-2 items-center pointer-events-none">
      {items.map((t) => (
        <div
          key={t.id}
          className="w-full max-w-sm rounded-xl shadow-md border px-4 py-3 text-sm"
          style={{
            backgroundColor: "#111827",
            color: "#FFFFFF",
            borderColor: "#334155",
            whiteSpace: "pre-wrap",
          }}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   ✅ 차단 오버레이
─────────────────────────────────────────────*/
function VersionBlockedOverlay(props: {
  message: string;
  minVersion: string | null;
  appVersion: string;
  onExit: () => void;
}) {
  const { message, minVersion, appVersion, onExit } = props;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center px-6">
      <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.55)" }} />
      <div className="relative w-full max-w-sm rounded-2xl border shadow-md p-5 bg-white">
        <div className="text-base font-semibold mb-2">업데이트 필요</div>
        <div className="text-sm whitespace-pre-wrap leading-6 mb-4">{message}</div>

        <div className="text-xs opacity-80 leading-5 mb-4">
          <div>현재 앱 버전: {appVersion}</div>
          <div>필수 버전: {minVersion ?? "-"}</div>
        </div>

        <button
          type="button"
          onClick={onExit}
          className="w-full rounded-xl px-4 py-3 text-sm font-medium"
          style={{ backgroundColor: "#111827", color: "#FFFFFF" }}
        >
          확인
        </button>
      </div>
    </div>
  );
}

const RouterView: React.FC = () => {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        path="/"
        element={
          <RequireAuth>
            <MainPage />
          </RequireAuth>
        }
      />

      <Route
        path="/inbound"
        element={
          <RequireAuth>
            <InboundListPage />
          </RequireAuth>
        }
      />

      <Route
        path="/inbound/scan-barcode"
        element={
          <RequireAuth>
            <InboundBarcodeScanPage />
          </RequireAuth>
        }
      />

      <Route
        path="/inbound/register-barcode"
        element={
          <RequireAuth>
            <InboundBarcodeRegisterPage />
          </RequireAuth>
        }
      />

      <Route
        path="/outbound"
        element={
          <RequireAuth>
            <OutboundListPage />
          </RequireAuth>
        }
      />

      <Route
        path="/outbound/scan-invoice"
        element={
          <RequireAuth>
            <OutboundInvoiceScanPage />
          </RequireAuth>
        }
      />

      <Route
        path="/outbound/scan-items"
        element={
          <RequireAuth>
            <OutboundScanPage />
          </RequireAuth>
        }
      />

      <Route path="/stock" element={<Navigate to="/stock/status" />} />

      <Route
        path="/stock/status"
        element={
          <RequireAuth>
            <StockStatusPage />
          </RequireAuth>
        }
      />

      <Route
        path="/stock/scan-barcode"
        element={
          <RequireAuth>
            <StockBarcodeScanPage />
          </RequireAuth>
        }
      />

      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

export default function App() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // 버전체크 상태
  const [versionChecking, setVersionChecking] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [minVersion, setMinVersion] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<string>(DEFAULT_BLOCK_MESSAGE);

  const showToast = useCallback((message: string) => {
    const id = makeId();
    setToasts((prev) => [...prev, { id, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  }, []);

  // ✅ apiHub 전역 토스트 주입(항상)
  useEffect(() => {
    setGlobalToast(showToast);
    return () => setGlobalToast(null);
  }, [showToast]);

  // ✅ 버전체크
  useEffect(() => {
    let alive = true;

    const run = async () => {
      try {
        const res = await fetch(VERSION_CHECK_URL, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
        });

        const json = (await res.json()) as {
          data?: { min_app_version?: string; message?: string };
        };

        const serverMin = json?.data?.min_app_version?.trim() || "";
        const serverMsg = json?.data?.message?.trim() || DEFAULT_BLOCK_MESSAGE;

        if (!alive) return;

        if (serverMin) {
          setMinVersion(serverMin);
          if (compareVersion(APP_VERSION, serverMin) < 0) {
            setBlockedMessage(serverMsg || DEFAULT_BLOCK_MESSAGE);
            setBlocked(true);
          }
        }
      } catch {
        // 실패 시 차단하지 않음(운영 정책에 따라 나중에 변경 가능)
      } finally {
        if (!alive) return;
        setVersionChecking(false);
      }
    };

    run();
    return () => {
      alive = false;
    };
  }, []);

  const onExit = useCallback(() => {
    exitAppSafely();
  }, []);

  const blockMessageView = useMemo(
    () => blockedMessage || DEFAULT_BLOCK_MESSAGE,
    [blockedMessage]
  );

  return (
    <AuthProvider>
      <BrowserRouter>
        <RouterView />

        {/* ✅ 토스트는 어떤 상태든 항상 렌더 */}
        <GlobalToastHost items={toasts} />

        {/* ✅ 로딩/차단도 "오버레이"로만 처리 (라우터/토스트는 유지) */}
        {versionChecking && (
          <div className="fixed inset-0 z-[9997] flex items-center justify-center">
            <div className="absolute inset-0" style={{ backgroundColor: "rgba(0,0,0,0.35)" }} />
            <div className="relative text-sm px-4 py-3 rounded-xl bg-white shadow-md">
              버전 확인 중...
            </div>
          </div>
        )}

        {blocked && !versionChecking && (
          <VersionBlockedOverlay
            message={blockMessageView}
            minVersion={minVersion}
            appVersion={APP_VERSION}
            onExit={onExit}
          />
        )}
      </BrowserRouter>
    </AuthProvider>
  );
}
