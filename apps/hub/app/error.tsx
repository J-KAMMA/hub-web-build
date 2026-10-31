"use client";

import React, { useEffect, useRef } from "react";

import { RouteRecoveryClientShell } from "@/components/route-recovery-client-shell";
import { RouteRecoveryPanel } from "@/components/route-recovery-panel";

export default function HubError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    console.error(JSON.stringify({ event: "hub_route_error", digest: error.digest ?? "unavailable" }));
    headingRef.current?.focus({ preventScroll: true });
  }, [error]);

  return (
    <RouteRecoveryClientShell>
      <RouteRecoveryPanel kind="error" onRetry={reset} headingRef={headingRef} />
    </RouteRecoveryClientShell>
  );
}
