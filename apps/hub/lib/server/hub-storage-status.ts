import type { D1Database } from "@cloudflare/workers-types";

import { getHubStorageAccountClient } from "@/lib/server/hub-storage-account-client";
import { fireHubAutopayDueNotice, localStorageLimitBytes, reconcileHubAutopayMode } from "@/lib/server/hub-storage-usage";

// 保存容量の読み出し（PLAN.md §6.1）。合計の正本は Account だけ。
// 読めないときは null を返す。使用量 0 や無料の上限を代わりに返さない（黙って開かないため）。
export async function readHubStorageStatus(db: D1Database, profileId: string, options: { userStopped?: boolean } = {}): Promise<Record<string, unknown> | null> {
  const link = await db
    .prepare("SELECT pairwise_subject FROM account_profile_links WHERE profile_id = ?")
    .bind(profileId)
    .first<{ pairwise_subject: string }>();
  if (link?.pairwise_subject) {
    const client = getHubStorageAccountClient();
    const result = client.status ? await client.status({ subject: link.pairwise_subject }) : null;
    if (!result?.ok || result.limitBytes === null || result.usedBytes === null) return null;
    const renewal = result.renewal === "auto" && result.nextRenewalAt ? "auto" : "manual";
    // 3 日前の知らせはここで出す。読めたときだけ。Hub が持つのは方式と次の更新時刻だけ。
    if (result.renewal) await reconcileHubAutopayMode(db, profileId, renewal, options);
    if (renewal === "auto" && result.nextRenewalAt) await fireHubAutopayDueNotice(db, profileId, result.nextRenewalAt);
    return {
      renewal,
      nextRenewalAt: renewal === "auto" ? result.nextRenewalAt : null,
      planCode: result.planCode,
      state: result.state,
      planUntil: result.planUntil ?? null,
      limitBytes: result.limitBytes,
      usedBytes: result.usedBytes,
      byService: result.byService ?? [],
      linked: true,
    };
  }
  // Account につないでいないプロフィール：ハブの中だけの 100MB。
  const row = await db
    .prepare("SELECT committed_bytes, reserved_bytes FROM hub_storage_usage WHERE profile_id = ?")
    .bind(profileId)
    .first<{ committed_bytes: number; reserved_bytes: number }>();
  const committed = Number(row?.committed_bytes ?? 0);
  const reserved = Number(row?.reserved_bytes ?? 0);
  if (!Number.isSafeInteger(committed) || !Number.isSafeInteger(reserved)) return null;
  return {
    renewal: "manual",
    nextRenewalAt: null,
    planCode: "free",
    state: "free",
    planUntil: null,
    limitBytes: localStorageLimitBytes(),
    usedBytes: committed + reserved,
    byService: [{ service: "hub", committedBytes: committed, reservedBytes: reserved }],
    linked: false,
  };
}
