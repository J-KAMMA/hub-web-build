import type { D1Database } from "@cloudflare/workers-types";

/**
 * 成人表示のオプトインをアカウントに保存する。
 *
 * Cookieは端末ごとに消え、アプリとも共有されない。
 * 「有効にした人だけに見せる」を成立させるには、設定は利用者に紐づいている必要がある。
 */
interface AdultOptInRow {
  enabled: number;
  enabled_at: string | null;
}

export async function getD1AdultOptIn(
  database: D1Database,
  profileId: string,
): Promise<{ enabled: boolean; enabledAt: string | null }> {
  const row = await database
    .prepare("SELECT enabled, enabled_at FROM profile_adult_opt_in WHERE profile_id = ? LIMIT 1")
    .bind(profileId)
    .first<AdultOptInRow>();
  return { enabled: row?.enabled === 1, enabledAt: row?.enabled_at ?? null };
}

export async function setD1AdultOptIn(
  database: D1Database,
  profileId: string,
  enabled: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  await database
    .prepare(
      `INSERT INTO profile_adult_opt_in (profile_id, enabled, enabled_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(profile_id) DO UPDATE SET
         enabled = excluded.enabled,
         -- 解除しても enabled_at は消さない。最後に有効にした時刻を残す。
         enabled_at = CASE WHEN excluded.enabled = 1 THEN excluded.enabled_at ELSE profile_adult_opt_in.enabled_at END,
         updated_at = excluded.updated_at`,
    )
    .bind(profileId, enabled ? 1 : 0, enabled ? now : null, now)
    .run();
}
