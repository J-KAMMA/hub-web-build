import type { Metadata } from "next";
import { cookies } from "next/headers";

import { AdminAccessRequired } from "@/components/admin-access-required";
import { CopyrightQueue } from "@/components/copyright-moderation";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "著作権の申告 | Hub", robots: { index: false, follow: false } };

export default async function CopyrightQueuePage() {
  const cookieStore = await cookies();
  if (!isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value)) return <AdminAccessRequired />;
  return <CopyrightQueue authenticated />;
}
