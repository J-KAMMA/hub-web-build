import "server-only";
import type { D1Database } from "@cloudflare/workers-types";

export const SOCIAL_POST_AUTO_HOLD_THRESHOLD = 3;

type ReportReceipt = {
  reportId: string;
  reportStatus: string;
  postReviewStatus: "published" | "under_review" | "hidden";
  duplicate: boolean;
};

export async function reportSocialPost(
  database: D1Database,
  input: { postId: string; reporterProfileId: string; reason: string; details: string },
): Promise<ReportReceipt> {
  const existing = await database.prepare(
    "SELECT id,status FROM social_post_reports WHERE reporter_profile_id=? AND post_id=? AND status='open' LIMIT 1",
  ).bind(input.reporterProfileId, input.postId).first<{ id: string; status: string }>();
  if (existing) {
    const moderationCase = await database.prepare(
      "SELECT status FROM social_post_moderation_cases WHERE post_id=?",
    ).bind(input.postId).first<{ status: string }>();
    return {
      reportId: existing.id,
      reportStatus: existing.status,
      postReviewStatus: moderationCase?.status === "hidden" ? "hidden" : moderationCase?.status === "auto_held" ? "under_review" : "published",
      duplicate: true,
    };
  }

  const reportId = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.prepare(`INSERT INTO social_post_reports
    (id,reporter_profile_id,post_id,reason,details,status,created_at)
    VALUES(?,?,?,?,?,'open',?)`).bind(
    reportId, input.reporterProfileId, input.postId, input.reason, input.details, now,
  ).run();

  const countRow = await database.prepare(
    "SELECT COUNT(DISTINCT reporter_profile_id) count FROM social_post_reports WHERE post_id=? AND status='open'",
  ).bind(input.postId).first<{ count: number }>();
  const reportCount = Number(countRow?.count ?? 0);
  if (reportCount >= SOCIAL_POST_AUTO_HOLD_THRESHOLD) {
    await database.batch([
      database.prepare(`INSERT INTO social_post_moderation_cases
        (post_id,status,reason,report_count,version,opened_at,updated_at)
        VALUES(?,'auto_held','複数の通報を受け、安全確認中です。',?,1,?,?)
        ON CONFLICT(post_id) DO UPDATE SET
          report_count=MAX(report_count,excluded.report_count),
          updated_at=excluded.updated_at,
          status=CASE WHEN status='restored' THEN 'auto_held' ELSE status END,
          reason=CASE WHEN status='restored' THEN excluded.reason ELSE reason END,
          resolved_at=CASE WHEN status='restored' THEN NULL ELSE resolved_at END,
          version=version+1`).bind(input.postId, reportCount, now, now),
      database.prepare(`UPDATE social_posts
        SET moderated_at=COALESCE(moderated_at,?), moderation_reason=COALESCE(moderation_reason,'report_threshold_review')
        WHERE id=?`).bind(now, input.postId),
    ]);
    return { reportId, reportStatus: "open", postReviewStatus: "under_review", duplicate: false };
  }
  return { reportId, reportStatus: "open", postReviewStatus: "published", duplicate: false };
}

export async function submitSocialPostAppeal(
  database: D1Database,
  input: { postId: string; authorProfileId: string; message: string },
) {
  const post = await database.prepare(`SELECT p.author_profile_id authorProfileId,c.status moderationStatus
    FROM social_posts p JOIN social_post_moderation_cases c ON c.post_id=p.id
    WHERE p.id=?`).bind(input.postId).first<{ authorProfileId: string | null; moderationStatus: string }>();
  if (!post) throw new Error("対象のポストは審査対象ではありません。");
  if (post.authorProfileId !== input.authorProfileId) throw new Error("このポストの投稿者だけが申請できます。");
  if (!["auto_held", "hidden"].includes(post.moderationStatus)) throw new Error("このポストは現在非表示ではありません。");
  const existing = await database.prepare(`SELECT id,status,created_at createdAt
    FROM social_post_moderation_appeals WHERE post_id=? AND author_profile_id=? AND status='open' LIMIT 1`)
    .bind(input.postId, input.authorProfileId).first<{ id: string; status: string; createdAt: string }>();
  if (existing) return { appealId: existing.id, status: existing.status, createdAt: existing.createdAt, duplicate: true };
  const appealId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await database.prepare(`INSERT INTO social_post_moderation_appeals
    (id,post_id,author_profile_id,message,status,created_at) VALUES(?,?,?,?,'open',?)`)
    .bind(appealId, input.postId, input.authorProfileId, input.message, createdAt).run();
  return { appealId, status: "open", createdAt, duplicate: false };
}
