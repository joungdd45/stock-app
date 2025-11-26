// src/pages/Products/ProductsPage.tsx
import React from "react";
import type { ReactNode } from "react";

/** 헤더는 Shell이 자동 처리. 자식만 렌더 */
export default function ProductsPage({ children }: { children?: ReactNode }) {
  return <>{children ?? null}</>;
}
