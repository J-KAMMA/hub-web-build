import type { D1Database } from "@cloudflare/workers-types";

export const GATE_CHECK_WINDOW_MS = 60 * 60 * 1000;
export const GATE_CHECK_LIMIT = 30;

/** Durable fixed-window quota (30 per hour per profile). Returns false when the profile is over the limit. */
export async function consumeGateCheckQuota(
  database: D1Database,
  profileId: string,
  now = Date.now(),
): Promise<boolean> {
  const windowStart = Math.floor(now / GATE_CHECK_WINDOW_MS) * GATE_CHECK_WINDOW_MS;
  const result = await database.prepare(`INSERT INTO access_gate_check_rate (profile_id, window_start, count)
      VALUES (?, ?, 1)
      ON CONFLICT(profile_id, window_start) DO UPDATE SET count = count + 1
      WHERE count < ?`)
    .bind(profileId, windowStart, GATE_CHECK_LIMIT).run();
  if (!result.meta.changes) return false;
  // Opportunistic cleanup of finished windows; failure must not block the check.
  await database.prepare("DELETE FROM access_gate_check_rate WHERE window_start < ?")
    .bind(windowStart - GATE_CHECK_WINDOW_MS).run().catch(() => undefined);
  return true;
}
