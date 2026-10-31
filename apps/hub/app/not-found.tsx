import React from "react";

import { RouteRecoveryPanel } from "@/components/route-recovery-panel";
import { RouteRecoveryShell } from "@/components/route-recovery-shell";

export default function HubNotFound() {
  return (
    <RouteRecoveryShell currentPath="/__not-found">
      <RouteRecoveryPanel kind="not-found" />
    </RouteRecoveryShell>
  );
}
