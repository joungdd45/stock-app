/* C:\dev\stock-mobile\src\App.tsx */
/**
 * 📱 재고이찌 — 모바일 GUI 실사용 준비 v1.3
 * 역할:
 *  - 라우터 구성 전담
 *  - AuthProvider + RequireAuth 연결
 *  - 각 페이지 파일을 라우트에만 매핑
 */

import React from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AuthProvider } from "./auth/useAuth";
import { RequireAuth } from "./auth/RequireAuth";

import LoginPage from "./pages/login/LoginPage";
import MainPage from "./pages/main/MainPage";

import InboundListPage from "./pages/inbound/InboundListPage";
import InboundBarcodeScanPage from "./pages/inbound/InboundBarcodeScanPage";
import InboundBarcodeRegisterPage from "./pages/inbound/InboundBarcodeRegisterPage"; // ✅ 바코드 등록 페이지

import OutboundInvoiceScanPage from "./pages/outbound/OutboundInvoiceScanPage";
import OutboundListPage from "./pages/outbound/OutboundListPage";
import OutboundScanPage from "./pages/outbound/OutboundScanPage";

import StockStatusPage from "./pages/stock/StockStatusPage";
import StockBarcodeScanPage from "./pages/stock/StockBarcodeScanPage";

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
  return (
    <AuthProvider>
      <BrowserRouter>
        <RouterView />
      </BrowserRouter>
    </AuthProvider>
  );
}
