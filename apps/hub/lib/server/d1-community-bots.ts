import type { D1Database } from "@cloudflare/workers-types";

export const COMMUNITY_BOT_KINDS = [
  "welcome",
  "moderation",
  "guide_watch",
  "governance",
  "recruitment",
  "digest",
] as const;
export type CommunityBotKind = (typeof COMMUNITY_BOT_KINDS)[number];

type BotRow = {
  id: string;
  community_id: string;
  name: string;
  kind: CommunityBotKind;
  channel_id: string | null;
  enabled: number;
};

const summaries: Record<CommunityBotKind, (count: number) => string> = {
  welcome: (count) => `参加申請を${count}件確認しました。`,
  moderation: (count) => `未処理の通報を${count}件確認しました。自動削除は行っていません。`,
  guide_watch: (count) => `再確認が必要な共同ページを${count}件検出しました。`,
  governance: (count) => `進行中のガバナンス提案を${count}件確認しました。`,
  recruitment: (count) => `募集中の投稿を${count}件確認しました。`,
  digest: (count) => `過去7日間の投稿を${count}件集計しました。`,
};

export async function runCommunityBot(
  database: D1Database,
  input: { communityId: string; botId: string; actorProfileId: string; triggerType?: "manual" | "event" | "schedule" },
) {
  const bot = await database.prepare(`SELECT id, community_id, name, kind, channel_id, enabled
    FROM community_bots WHERE id = ? AND community_id = ? LIMIT 1`)
    .bind(input.botId, input.communityId).first<BotRow>();
  if (!bot) throw new Error("Botが見つかりません。");
  const startedAt = new Date().toISOString();
  let count = 0;
  if (bot.enabled) {
    const query = bot.kind === "welcome"
      ? "SELECT count(*) AS total FROM community_membership_requests WHERE community_id = ? AND status = 'pending'"
      : bot.kind === "moderation"
        ? "SELECT count(*) AS total FROM community_message_reports WHERE community_id = ? AND status = 'open'"
        : bot.kind === "guide_watch"
          ? "SELECT count(*) AS total FROM community_guide_pages WHERE community_id = ? AND verification_status != 'verified'"
          : bot.kind === "governance"
            ? "SELECT count(*) AS total FROM community_governance_proposals WHERE community_id = ? AND status IN ('discussion','voting')"
            : bot.kind === "recruitment"
              ? `SELECT count(*) AS total FROM community_channel_messages m JOIN community_channels c ON c.id = m.channel_id
                 WHERE c.community_id = ? AND m.kind = 'party' AND m.workflow_status = 'open'`
              : `SELECT count(*) AS total FROM community_channel_messages m JOIN community_channels c ON c.id = m.channel_id
                 WHERE c.community_id = ? AND m.created_at >= datetime('now','-7 days')`;
    const result = await database.prepare(query).bind(input.communityId).first<{ total: number }>();
    count = Number(result?.total ?? 0);
  }
  const completedAt = new Date().toISOString();
  const summary = bot.enabled ? summaries[bot.kind](count) : "無効なBotのため実行をスキップしました。";
  await database.batch([
    database.prepare(`INSERT INTO community_bot_runs
      (id, bot_id, community_id, trigger_type, status, matched_count, summary, started_at, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), bot.id, input.communityId, input.triggerType ?? "manual", bot.enabled ? "completed" : "skipped", count, summary, startedAt, completedAt),
    database.prepare(`INSERT INTO community_audit_log
      (id, community_id, actor_profile_id, action, detail, created_at)
      VALUES (?, ?, ?, 'bot_run', ?, ?)`)
      .bind(crypto.randomUUID(), input.communityId, input.actorProfileId, `${bot.name}: ${summary}`, completedAt),
    ...(bot.enabled && bot.channel_id ? [
      database.prepare(`INSERT INTO community_channel_messages
        (id, channel_id, author_profile_id, body, created_at, kind, workflow_status, bot_id)
        SELECT ?, c.id, ?, ?, ?, 'chat', 'open', ?
        FROM community_channels c
        WHERE c.id = ? AND c.community_id = ? AND c.archived_at IS NULL`)
        .bind(crypto.randomUUID(), input.actorProfileId, summary, completedAt, bot.id, bot.channel_id, input.communityId),
    ] : []),
  ]);
  return { botId: bot.id, status: bot.enabled ? "completed" as const : "skipped" as const, matchedCount: count, summary };
}
