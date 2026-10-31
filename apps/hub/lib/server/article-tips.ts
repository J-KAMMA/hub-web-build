import type { D1Database } from "@cloudflare/workers-types";

/*
 * 記事ごとの確定済み投げ銭の件数。書き手本人の統計だけが使う。
 * 数だけ返す。誰が・いくら送ったかは返さない（金額は台帳の中、送信者IDはここでは選ばない）。
 */
export async function loadAuthorArticleTipCounts(
  database: D1Database,
  authorProfileId: string,
): Promise<Map<string, number>> {
  const result = await database.prepare(`SELECT t.article_id AS article_id, COUNT(*) AS n
      FROM wallet_tip_transactions t
      WHERE t.recipient_profile_id = ? AND t.article_id IS NOT NULL
      GROUP BY t.article_id`)
    .bind(authorProfileId).all<{ article_id: string; n: number }>();
  return new Map((result.results ?? []).map((row) => [row.article_id, Number(row.n)]));
}
