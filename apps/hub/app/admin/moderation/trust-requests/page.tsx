import { cookies } from "next/headers";
import { AdminAccessRequired } from "@/components/admin-access-required";

import { TrustRequestModeration } from "@/components/trust-request-moderation";
import {
  isModerationAdminToken,
  MODERATION_ADMIN_COOKIE,
} from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";

export default async function TrustRequestsPage() {
  const cookieStore = await cookies();
  if (!isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value)) {
    return <AdminAccessRequired />;
  }
  return <TrustRequestModeration />;
}
