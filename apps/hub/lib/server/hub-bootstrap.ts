/*
 * 自前ハブの最初の運営者を決める使い切りの手順（DESIGN.md 5.2）。
 * create-hub が乱数のトークンを作り、SHA-256 の16進だけを秘密 HUB_BOOTSTRAP_TOKEN_SHA256 に置く。
 * トークン本体は運営者の端末に一度だけ表示され、ここには届いても保存もログもしない。
 * 秘密が無い・運営者が既にいる・使用済みのとき、この手順は存在しない（404）。
 */
type D1Like = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta?: { changes?: number } }>;
    };
  };
  batch(statements: unknown[]): Promise<Array<{ meta?: { changes?: number } }>>;
};

type EnvLike = Record<string, string | undefined>;

export const BOOTSTRAP_MAX_FAILURES = 10;
export const BOOTSTRAP_WINDOW_MS = 15 * 60 * 1000;
const HEX64 = /^[0-9a-f]{64}$/;

export function configuredBootstrapHash(env: EnvLike = process.env): string | null {
  const value = env.HUB_BOOTSTRAP_TOKEN_SHA256?.trim().toLowerCase();
  return value && HEX64.test(value) ? value : null;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares two hex strings without an early exit on the first differing character. */
export function constantTimeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function tokenMatches(token: unknown, env: EnvLike = process.env): Promise<boolean> {
  const expected = configuredBootstrapHash(env);
  if (!expected || typeof token !== "string" || token.length < 16 || token.length > 256) return false;
  return constantTimeEqualHex(await sha256Hex(token), expected);
}

/** True while the one-time setup may still run. Any read failure counts as unavailable. */
export async function isBootstrapAvailable(
  database: D1Like,
  env: EnvLike = process.env,
  now: Date = new Date(),
): Promise<boolean> {
  if (!configuredBootstrapHash(env)) return false;
  if (env.HUB_OPERATOR_PROFILE_IDS?.split(",").some((id) => id.trim())) return false;
  try {
    const operator = await database.prepare("SELECT 1 AS found FROM hub_instance_operators LIMIT 1")
      .bind().first<{ found: number }>();
    if (operator) return false;
    const state = await database.prepare(
      "SELECT claimed_at AS claimedAt, failed_attempts AS failed, window_started_at AS windowStartedAt FROM hub_bootstrap_state WHERE id = 1",
    ).bind().first<{ claimedAt: string | null; failed: number; windowStartedAt: string | null }>();
    if (!state) return true;
    if (state.claimedAt) return false;
    const started = state.windowStartedAt ? Date.parse(state.windowStartedAt) : Number.NaN;
    const locked = state.failed >= BOOTSTRAP_MAX_FAILURES
      && Number.isFinite(started) && now.getTime() - started < BOOTSTRAP_WINDOW_MS;
    return !locked;
  } catch {
    return false;
  }
}

/** Counts a wrong token. Opens a fresh window when the previous one has expired. */
export async function recordBootstrapFailure(database: D1Like, now: Date = new Date()): Promise<void> {
  const iso = now.toISOString();
  const cutoff = new Date(now.getTime() - BOOTSTRAP_WINDOW_MS).toISOString();
  try {
    await database.prepare("INSERT OR IGNORE INTO hub_bootstrap_state (id) VALUES (1)").bind().run();
    await database.prepare(
      `UPDATE hub_bootstrap_state SET
         failed_attempts = CASE WHEN window_started_at IS NULL OR window_started_at < ? THEN 1 ELSE failed_attempts + 1 END,
         window_started_at = CASE WHEN window_started_at IS NULL OR window_started_at < ? THEN ? ELSE window_started_at END
       WHERE id = 1 AND claimed_at IS NULL`,
    ).bind(cutoff, cutoff, iso).run();
  } catch {
    // Counting is best effort; availability checks already fail closed.
  }
}

/**
 * Makes the profile the instance operator, once. The guarded insert only writes while no operator
 * exists and the state row is unclaimed; D1 runs the batch as one transaction, so only one caller wins.
 */
export async function claimFirstAdmin(database: D1Like, profileId: string, now: Date = new Date()): Promise<boolean> {
  const iso = now.toISOString();
  await database.prepare("INSERT OR IGNORE INTO hub_bootstrap_state (id) VALUES (1)").bind().run();
  const results = await database.batch([
    database.prepare(
      `INSERT INTO hub_instance_operators (profile_id, granted_at, source)
       SELECT ?, ?, 'bootstrap'
       WHERE NOT EXISTS (SELECT 1 FROM hub_instance_operators)
         AND EXISTS (SELECT 1 FROM hub_bootstrap_state WHERE id = 1 AND claimed_at IS NULL)`,
    ).bind(profileId, iso),
    database.prepare(
      `UPDATE hub_bootstrap_state SET claimed_at = ?, claimed_profile_id = ?
       WHERE id = 1 AND claimed_at IS NULL
         AND EXISTS (SELECT 1 FROM hub_instance_operators WHERE profile_id = ?)`,
    ).bind(iso, profileId, profileId),
  ]);
  return (results[0]?.meta?.changes ?? 0) === 1 && (results[1]?.meta?.changes ?? 0) === 1;
}
