import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";

export default function CommunityReviewLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell currentPath="/community/review" notificationCount={0} messageCount={0} ownsHeading={false}>
      {children}
    </AppShell>
  );
}
