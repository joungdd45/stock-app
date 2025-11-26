// src/pages/outbound/Register/OutboundRegisterPage.tsx
import React, { useEffect } from "react";
import type { ReactNode } from "react";
import { useHeaderAddon } from "../../../layouts/InventoryShell";
import { ROUTES } from "../../../constants/routes";
import SubTabsBar from "../../../components/common/SubTabsBar";

type Props = { children?: ReactNode };

export default function OutboundRegisterPage({ children }: Props) {
  const setHeaderAddon = useHeaderAddon();

  useEffect(() => {
    setHeaderAddon(
      <SubTabsBar
        tabs={[
          { label: "조회", to: ROUTES.OUTBOUND.REGISTER.QUERY },
          { label: "등록", to: ROUTES.OUTBOUND.REGISTER.FORM },
        ]}
      />
    );
    return () => setHeaderAddon(null);
  }, [setHeaderAddon]);

  return <>{children ?? null}</>;
}
