// 📄 src/App.tsx
// 입출고시스템 GUI 스켈레톤 통합 버전 (구조·경로 대/소문자 동기화)
// ------------------------------------------------------
// 구조 원칙
// 1) Shell: 사이드바 + 상단 헤더 자리
// 2) Page: 헤더를 채우는 래퍼 (입고/출고/재고/상품/대시보드/설정)
// 3) SubPage: 실제 본문 표시 (Outlet 없음)
// 4) 입고등록 하위는 RegisterPage가 서브탭(조회/등록) 렌더 전담
// ------------------------------------------------------

import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import InventoryShell from "./layouts/InventoryShell";
import { ROUTES } from "./constants/routes";

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

// ✅ [NOAH PATCH] 로그인 페이지 (디자인 전용)
import LoginPage from "./pages/Login/LoginPage";

// ------------------------------------------------------

export default function App() {
  return (
    <Routes>
      {/* 루트 접근 시 메인으로 이동 */}
      <Route path={ROUTES.ROOT} element={<Navigate to={ROUTES.MAIN} replace />} />

      {/* [NOAH PATCH START] 로그인 페이지 미리보기 경로 */}
      <Route path="/login" element={<LoginPage />} />
      {/* [NOAH PATCH END] */}

      {/* 전역 Shell */}
      <Route element={<InventoryShell />}>
        {/* 🏠 메인 */}
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
        {/* 입고등록 서브탭 */}
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
        {/* 출고등록 서브탭 */}
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
        <Route path={ROUTES.SETTINGS.ROOT} element={<Navigate to={ROUTES.SETTINGS.BASIC} replace />} />
      </Route>

      {/* 잘못된 경로 → 메인으로 */}
      <Route path="*" element={<Navigate to={ROUTES.MAIN} replace />} />
    </Routes>
  );
}
