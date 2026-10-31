import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";

export default function SetupLayout({ children }: { children: ReactNode }) {
  return <AppShell currentPath="/setup/admin" notificationCount={0} messageCount={0}>{children}</AppShell>;
}
