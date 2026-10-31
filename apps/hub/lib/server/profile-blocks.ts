import type { D1Database } from "@cloudflare/workers-types";

export class HubProfileBlockedError extends Error {
  constructor() {
    super("ブロックされているユーザーとは操作できません。");
    this.name = "HubProfileBlockedError";
  }
}

export async function hasD1BlockBetween(
  database: D1Database,
  firstProfileId: string,
  secondProfileId: string,
): Promise<boolean> {
  if (!firstProfileId || !secondProfileId || firstProfileId === secondProfileId) return false;
  const row = await database.prepare(`SELECT 1 AS blocked
    FROM thread_user_controls
    WHERE blocked = 1 AND (
      (owner_profile_id = ? AND target_profile_id = ?)
      OR (owner_profile_id = ? AND target_profile_id = ?)
    ) LIMIT 1`)
    .bind(firstProfileId, secondProfileId, secondProfileId, firstProfileId)
    .first<{ blocked: number }>();
  return Boolean(row);
}

export async function requireNoD1BlockBetween(
  database: D1Database,
  firstProfileId: string,
  secondProfileId: string | null | undefined,
) {
  if (secondProfileId && await hasD1BlockBetween(database, firstProfileId, secondProfileId)) {
    throw new HubProfileBlockedError();
  }
}
