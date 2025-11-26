// src/constants/routes.ts
// 경로 상수(앱 전역 단일 진실)

export const ROUTES = {
  ROOT: "/",
  MAIN: "/main",

  INBOUND: {
    ROOT: "/inbound",
    PROCESS: "/inbound/process",
    REGISTER: {
      ROOT: "/inbound/register",
      QUERY: "/inbound/register/query",
      FORM: "/inbound/register/form",
    },
    DONE: "/inbound/done",
  },

  OUTBOUND: {
    ROOT: "/outbound",
    PROCESS: "/outbound/process",
    REGISTER: {
      ROOT: "/outbound/register",
      QUERY: "/outbound/register/query",
      FORM: "/outbound/register/form",
    },
    DONE: "/outbound/done",
    CANCELED: "/outbound/canceled",
  },

  INVENTORY: {
    ROOT: "/inventory",
    STATUS: "/inventory/status",
    HISTORY: "/inventory/history",
  },

  PRODUCTS: {
    ROOT: "/products",
    CREATE: "/products/create",
    EDIT: "/products/edit",
  },

  DASHBOARD: {
    ROOT: "/dashboard",
    WEEKLY: "/dashboard/weekly",
    MONTHLY: "/dashboard/monthly",
    TOP10: "/dashboard/top10",
  },

  SETTINGS: {
    ROOT: "/settings",
    BASIC: "/settings/basic",       // ✅ 추가
    ADVANCED: "/settings/advanced", // ✅ 추가
  },
} as const;

  export type RouteValue =
    | string
    | { [k: string]: RouteValue };
  
  export type Routes = typeof ROUTES;
  