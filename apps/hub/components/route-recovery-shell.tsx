import React, { type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import type { AppShellData } from "@/lib/server/app-shell-data";

const ROUTE_RECOVERY_SHELL_DATA = {
  currentProfile: {
    id: "",
    handle: "guest",
    displayName: "ゲスト",
    bio: "",
    joinedAt: "",
  },
  socialPosts: [],
  follows: [],
  lists: [],
  unreadIndicatorCount: 0,
  unreadMessageCount: 0,
} satisfies AppShellData;

export function RouteRecoveryShell({
  children,
  currentPath,
}: {
  children: ReactNode;
  currentPath: string;
}) {
  return (
    <AppShell
      currentPath={currentPath}
      notificationCount={0}
      messageCount={0}
      shellData={ROUTE_RECOVERY_SHELL_DATA}
    >
      {children}
    </AppShell>
  );
}
