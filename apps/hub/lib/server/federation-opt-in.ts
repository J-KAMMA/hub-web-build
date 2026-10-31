import "server-only";

import { getFederationSettings } from "@/lib/server/federation-gateway";

/**
 * Whether a profile has turned federation on. Public protocol surfaces (RSS, email export)
 * must not publish a profile that has not opted in. Fails closed: if the Federation Worker
 * cannot be reached or answers anything but `enabled: true`, the profile counts as opted out.
 */
export async function isFederationOptedIn(profileId: string): Promise<boolean> {
  try {
    const settings = await getFederationSettings(profileId);
    return settings?.enabled === true;
  } catch {
    return false;
  }
}
