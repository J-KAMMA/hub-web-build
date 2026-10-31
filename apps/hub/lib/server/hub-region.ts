import "server-only";

import { cookies } from "next/headers";

import { defaultHubRegion, HUB_REGION_COOKIE, resolveHubRegion } from "@/lib/hub-region";
import { getHubLocale } from "@/lib/server/locale";

export async function getHubRegion() {
  const savedRegion = resolveHubRegion((await cookies()).get(HUB_REGION_COOKIE)?.value);
  if (savedRegion) return savedRegion;
  return defaultHubRegion(await getHubLocale());
}
