import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

/*
 * Every admin page prints its own name. This layout hands the shell one fixed
 * path for all of them, so without being told otherwise the shell called
 * itself the heading on eleven screens that already had one.
 */
export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell currentPath="/admin" notificationCount={0} messageCount={0} ownsHeading={false}>
      {children}
    </AppShell>
  );
}
