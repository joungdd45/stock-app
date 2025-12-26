// 📄 src/App.tsx
// v1.7-hotfix2
// - 보호영역 기준: "토큰 존재"가 아니라 "인증 필수 API 호출 결과 ok:true" 기준
// - apiHub.get은 실패해도 throw가 아니라 ok:false로 반환하므로, 여기서 res.ok를 직접 체크한다.
// - ok:false면 토큰 정리 후 /login 이동

import React, { useEffect, useState } from "react";
import { Routes, Route, Navigate, Outlet, useLocation } from "react-router-dom";

import InventoryShell from "./layouts/InventoryShell";
import { ROUTES } from "./constants/routes";
import { apiHub } from "./api/hub/apiHub";

// ✅ 메인
import MainPage from "./pages/Main/MainPage";

// ✅ 입고관리
import InboundPage from "./pages/Inbound/InboundPage";
import RegisterPage from "./pages/Inbound/Register/RegisterPage";
import RegisterQueryPage from "./pages/Inbound/Register/inboundRegisterQueryPage";
import RegisterFormPage from "./pages/Inbound/Register/inboundRegisterFormPage";
import ProcessPage from "./pages/Inbound/Process/inboundProcessPage";
import CompletePage from "./pages/Inbound/Complete/inboundCompletePage";

// ✅ 출고관리
import OutboundPage from "./pages/Outbound/OutboundPage";
import OutboundRegisterPage from "./pages/Outbound/Register/OutboundRegisterPage";
import OutboundProcessPage from "./pages/Outbound/Process/outboundProcessPage";
import OutboundCompletePage from "./pages/Outbound/Complete/OutboundCompletePage";
import OutboundCancelPage from "./pages/Outbound/Cancel/OutboundCancelPage";
import OutboundRegisterQueryPage from "./pages/Outbound/Register/OutboundRegisterQueryPage";
import OutboundRegisterFormPage from "./pages/Outbound/Register/OutboundRegisterFormPage";

// ✅ 재고관리
import StockPage from "./pages/Stock/StockPage";
import StatusPage from "./pages/Stock/Status/StatusPage";
import HistoryPage from "./pages/Stock/History/HistoryPage";

// ✅ 상품관리
import ProductPage from "./pages/Product/ProductPage";
import CreatePage from "./pages/Product/Create/CreatePage";

// ✅ 대시보드
import DashboardPage from "./pages/Dashboard/DashboardPage";
import WeeklyPage from "./pages/Dashboard/Weekly/WeeklyPage";
import MonthlyPage from "./pages/Dashboard/Monthly/MonthlyPage";
import Top10Page from "./pages/Dashboard/Top10/Top10Page";

// ✅ 설정
import SettingsPage from "./pages/Settings/SettingsPage";
import BasicPage from "./pages/Settings/Basic/BasicPage";
import AdvancedPage from "./pages/Settings/Advanced/AdvancedPage";

// ✅ 로그인
import LoginPage from "./pages/Login/LoginPage";

// ------------------------------------------------------
// 토큰 정리(브라우저 잔재 토큰 방지)
// ------------------------------------------------------
function clearAllAuthStorage() {
  try {
    // apiHub 기준 키 + 레거시 키
    window.localStorage.removeItem("stockapp.access_token");
    window.localStorage.removeItem("accessToken");

    // DJ 화면에 있던 잔재 키들
    window.localStorage.removeItem("refreshToken");
    window.localStorage.removeItem("currentUser");

    // 혹시 세션에 박힌 케이스도 정리
    window.sessionStorage.removeItem("stockapp.access_token");
    window.sessionStorage.removeItem("accessToken");
    window.sessionStorage.removeItem("refreshToken");
    window.sessionStorage.removeItem("currentUser");
  } catch {
    // 무시
  }
}

// ------------------------------------------------------
// 가드: 인증 필수 API 호출 결과(ok:true)여야만 진입 허용
// ------------------------------------------------------
function ProtectedRoute() {
  const loc = useLocation();

  const token =
    window.localStorage.getItem("stockapp.access_token") ||
    window.localStorage.getItem("accessToken");

  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState<boolean>(false);

  useEffect(() => {
    if (!token) {
      setAllowed(false);
      setChecking(false);
      return;
    }

    (async () => {
      try {
        // ✅ 인증 필수 API로 검증 (반드시 401/403이 나는 엔드포인트)
        const res = await apiHub.get("/api/stock/status/list?page=1&size=1&keyword=");

        // apiHub.get은 throw가 아니라 ok:false 반환이므로 여기서 직접 판정
        if (res && (res as any).ok === true) {
          setAllowed(true);
        } else {
          clearAllAuthStorage();
          setAllowed(false);
        }
      } finally {
        setChecking(false);
      }
    })();
  }, [token]);

  if (checking) return null;

  if (!token || !allowed) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />;
  }

  return <Outlet />;
}

export default function App() {
  return (
    <Routes>
      <Route path={ROUTES.ROOT} element={<Navigate to={ROUTES.MAIN} replace />} />

      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<InventoryShell />}>
          <Route path={ROUTES.MAIN} element={<MainPage />} />

          {/* 📦 입고관리 */}
          <Route
            path={ROUTES.INBOUND.REGISTER.ROOT}
            element={<Navigate to={ROUTES.INBOUND.REGISTER.QUERY} replace />}
          />
          <Route
            path={ROUTES.INBOUND.PROCESS}
            element={
              <InboundPage>
                <ProcessPage />
              </InboundPage>
            }
          />
          <Route
            path={ROUTES.INBOUND.DONE}
            element={
              <InboundPage>
                <CompletePage />
              </InboundPage>
            }
          />
          <Route
            path={ROUTES.INBOUND.REGISTER.QUERY}
            element={
              <InboundPage>
                <RegisterPage>
                  <RegisterQueryPage />
                </RegisterPage>
              </InboundPage>
            }
          />
          <Route
            path={ROUTES.INBOUND.REGISTER.FORM}
            element={
              <InboundPage>
                <RegisterPage>
                  <RegisterFormPage />
                </RegisterPage>
              </InboundPage>
            }
          />

          {/* 🚚 출고관리 */}
          <Route
            path={ROUTES.OUTBOUND.REGISTER.ROOT}
            element={<Navigate to={ROUTES.OUTBOUND.REGISTER.QUERY} replace />}
          />
          <Route
            path={ROUTES.OUTBOUND.PROCESS}
            element={
              <OutboundPage>
                <OutboundProcessPage />
              </OutboundPage>
            }
          />
          <Route
            path={ROUTES.OUTBOUND.DONE}
            element={
              <OutboundPage>
                <OutboundCompletePage />
              </OutboundPage>
            }
          />
          <Route
            path={ROUTES.OUTBOUND.CANCELED}
            element={
              <OutboundPage>
                <OutboundCancelPage />
              </OutboundPage>
            }
          />
          <Route
            path={ROUTES.OUTBOUND.REGISTER.QUERY}
            element={
              <OutboundRegisterPage>
                <OutboundRegisterQueryPage />
              </OutboundRegisterPage>
            }
          />
          <Route
            path={ROUTES.OUTBOUND.REGISTER.FORM}
            element={
              <OutboundRegisterPage>
                <OutboundRegisterFormPage />
              </OutboundRegisterPage>
            }
          />

          {/* 📊 재고관리 */}
          <Route
            path={ROUTES.INVENTORY.STATUS}
            element={
              <StockPage>
                <StatusPage />
              </StockPage>
            }
          />
          <Route
            path={ROUTES.INVENTORY.HISTORY}
            element={
              <StockPage>
                <HistoryPage />
              </StockPage>
            }
          />

          {/* 🧾 상품관리 */}
          <Route
            path={ROUTES.PRODUCTS.CREATE}
            element={
              <ProductPage>
                <CreatePage />
              </ProductPage>
            }
          />

          {/* 📈 대시보드 */}
          <Route
            path={ROUTES.DASHBOARD.WEEKLY}
            element={
              <DashboardPage>
                <WeeklyPage />
              </DashboardPage>
            }
          />
          <Route
            path={ROUTES.DASHBOARD.MONTHLY}
            element={
              <DashboardPage>
                <MonthlyPage />
              </DashboardPage>
            }
          />
          <Route
            path={ROUTES.DASHBOARD.TOP10}
            element={
              <DashboardPage>
                <Top10Page />
              </DashboardPage>
            }
          />

          {/* ⚙️ 설정 */}
          <Route
            path={ROUTES.SETTINGS.BASIC}
            element={
              <SettingsPage>
                <BasicPage />
              </SettingsPage>
            }
          />
          <Route
            path={ROUTES.SETTINGS.ADVANCED}
            element={
              <SettingsPage>
                <AdvancedPage />
              </SettingsPage>
            }
          />
          <Route
            path={ROUTES.SETTINGS.ROOT}
            element={<Navigate to={ROUTES.SETTINGS.BASIC} replace />}
          />

          <Route path="*" element={<Navigate to={ROUTES.MAIN} replace />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to={ROUTES.MAIN} replace />} />
    </Routes>
  );
}
