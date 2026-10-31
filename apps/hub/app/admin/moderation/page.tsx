import { cookies } from "next/headers";

import { ModerationWorkspace } from "@/components/moderation-workspace";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";

export default async function ModerationPage() {
  const cookieStore = await cookies();
  const authenticated = isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value);
  return <ModerationWorkspace authenticated={authenticated} />;
}
