// [NOAH PATCH START] src/constants/navigation.ts — '입고 등록/출고 등록'을 ROOT 경로로 매칭
import { ROUTES } from "./routes";

export type NavItem = {
  label: string;
  path?: string;
  children?: NavItem[];
};

export const NAV_ITEMS: NavItem[] = [
  { label: "메인", path: ROUTES.MAIN },

  {
    label: "입고관리",
    children: [
      { label: "입고 처리", path: ROUTES.INBOUND.PROCESS },
      // 등록은 사이드바 1개만 표기하되, 매칭은 ROOT로(조회·등록 모두 매칭)
      { label: "입고 등록", path: ROUTES.INBOUND.REGISTER.ROOT }, // ← 여기!
      { label: "입고 완료", path: ROUTES.INBOUND.DONE },
    ],
  },

  {
    label: "출고관리",
    children: [
      { label: "출고 처리", path: ROUTES.OUTBOUND.PROCESS },
      // 동일하게 ROOT로 매칭
      { label: "출고 등록", path: ROUTES.OUTBOUND.REGISTER.ROOT }, // ← 여기!
      { label: "출고 완료", path: ROUTES.OUTBOUND.DONE },
      { label: "출고 취소", path: ROUTES.OUTBOUND.CANCELED },
    ],
  },

  {
    label: "재고관리",
    children: [
      { label: "재고 현황", path: ROUTES.INVENTORY.STATUS },
      { label: "재고 이력", path: ROUTES.INVENTORY.HISTORY },
    ],
  },

  {
    label: "상품관리", // ← 상위 라벨 변경(상품등록 → 상품관리)
    children: [
      { label: "상품 등록", path: ROUTES.PRODUCTS.CREATE },
      // { label: "상품 수정", path: ROUTES.PRODUCTS.EDIT }, // ← 탭 제거
    ],
  },

  {
    label: "대시보드",
    children: [
      { label: "주간 현황", path: ROUTES.DASHBOARD.WEEKLY },
      { label: "월간 현황", path: ROUTES.DASHBOARD.MONTHLY },
      { label: "TOP 10 현황", path: ROUTES.DASHBOARD.TOP10 },
    ],
  },
  {
    label: "설정",
    children: [
      { label: "기본설정", path: ROUTES.SETTINGS.BASIC },
      { label: "고급설정", path: ROUTES.SETTINGS.ADVANCED },
    ],
  }
];
// [NOAH PATCH END]
