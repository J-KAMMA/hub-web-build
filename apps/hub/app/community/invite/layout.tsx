import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function CommunityInviteLayout({ children }: { children: ReactNode }) {
  return <AppShell currentPath="/community" notificationCount={0} messageCount={0}>{children}</AppShell>;
}
