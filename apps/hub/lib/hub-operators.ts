/*
 * Hub運営者の名簿。
 *
 * 誰が運営者かは環境の HUB_OPERATOR_PROFILE_IDS が決める。同じ判定を
 * API（app/api/community-verification/route.ts）と画面の入口の両方が使う。
 * 片方だけを直すと、押しても 403 になる入口か、誰も辿り着けない画面になる。
 */
export function hubOperatorIds(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}

/* 空の id は運営者ではない。未ログインを名簿の空欄と取り違えないため。 */
export function isHubOperator(profileId: string | null | undefined, value: string | undefined): boolean {
  if (!profileId) return false;
  return hubOperatorIds(value).has(profileId);
}

/*
 * 環境の名簿に加えて、自前ハブの /setup/admin で選ばれた最初の運営者（hub_instance_operators）も運営者とみなす。
 * 表が無い・読めないときは環境の名簿だけで判定する（失敗側＝運営者ではない）。
 */
export async function isInstanceOperator(
  database: { prepare(sql: string): { bind(...values: unknown[]): { first<T>(): Promise<T | null> } } },
  profileId: string | null | undefined,
  envValue: string | undefined,
): Promise<boolean> {
  if (!profileId) return false;
  if (isHubOperator(profileId, envValue)) return true;
  try {
    const row = await database.prepare("SELECT 1 AS found FROM hub_instance_operators WHERE profile_id = ?")
      .bind(profileId).first<{ found: number }>();
    return Boolean(row);
  } catch {
    return false;
  }
}
