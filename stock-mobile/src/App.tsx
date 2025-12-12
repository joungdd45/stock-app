/* C:\dev\stock-mobile\src\App.tsx */
/**
 * 📱 재고이찌 — 모바일 GUI 실사용 준비 v1.3
 * 역할:
 *  - 라우터 구성 전담
 *  - AuthProvider + RequireAuth 연결
 *  - ✅ 전역 토스트 무대(항상 렌더)
 *  - ✅ apiHub(handleError)가 사용할 토스트 함수 주입(setGlobalToast)
 */

import React, { useCallback, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

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

// ✅ apiHub 전역 토스트 주입
import { setGlobalToast } from "@/api/hub/apiHub";

// ─────────────────────────────────────────────
// ✅ 전역 토스트 UI (App에 고정 렌더)
// ─────────────────────────────────────────────

type ToastItem = {
  id: string;
  message: string;
};

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

const RouterView: React.FC = () => {
  return (
    <Routes>
      {/* 로그인 */}
      <Route path="/login" element={<LoginPage />} />

      {/* 메인 */}
      <Route
        path="/"
        element={
          <RequireAuth>
            <MainPage />
          </RequireAuth>
        }
      />

      {/* 입고관리 */}
      <Route
        path="/inbound"
        element={
          <RequireAuth>
            <InboundListPage />
          </RequireAuth>
        }
      />

      {/* 바코드 스캔 페이지 (바코드가 있는 전표) */}
      <Route
        path="/inbound/scan-barcode"
        element={
          <RequireAuth>
            <InboundBarcodeScanPage />
          </RequireAuth>
        }
      />

      {/* 바코드 등록 페이지 (바코드가 없는 전표) */}
      <Route
        path="/inbound/register-barcode"
        element={
          <RequireAuth>
            <InboundBarcodeRegisterPage />
          </RequireAuth>
        }
      />

      {/* 출고관리 */}
      <Route
        path="/outbound"
        element={
          <RequireAuth>
            <OutboundListPage />
          </RequireAuth>
        }
      />

      {/* 송장 스캔 페이지 */}
      <Route
        path="/outbound/scan-invoice"
        element={
          <RequireAuth>
            <OutboundInvoiceScanPage />
          </RequireAuth>
        }
      />

      {/* 상품 스캔 페이지 */}
      <Route
        path="/outbound/scan-items"
        element={
          <RequireAuth>
            <OutboundScanPage />
          </RequireAuth>
        }
      />

      {/* 재고관리 */}
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

      {/* fallback */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
};

export default function App() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string) => {
    const id = makeId();
    setToasts((prev) => [...prev, { id, message }]);

    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2400);
  }, []);

  // ✅ 앱 시작 시 1회: apiHub에 전역 토스트 함수 주입
  useEffect(() => {
    setGlobalToast(showToast);
    return () => setGlobalToast(null);
  }, [showToast]);

  return (
    <AuthProvider>
      <BrowserRouter>
        <RouterView />

        {/* ✅ 토스트는 라우트 밖에서 항상 렌더 */}
        <GlobalToastHost items={toasts} />
      </BrowserRouter>
    </AuthProvider>
  );
}
