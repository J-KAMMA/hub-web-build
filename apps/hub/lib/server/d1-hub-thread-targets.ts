import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import type { HubThreadTargetType } from "@/lib/hub-thread-system";
import { createD1Thread, createD1ThreadReply, getD1Thread, listD1ThreadPosts } from "@/lib/server/d1-threads";
import { getD1ThreadPostVoteSummaries } from "@/lib/server/d1-thread-post-votes";
import { listThreadPostKnowledge } from "@/lib/server/d1-thread-knowledge";
import type { ThreadPostRole, ThreadSource } from "@/lib/thread-knowledge";
import { redactGated } from "@/lib/server/gated-content";

const TARGET_LABELS: Record<HubThreadTargetType, string> = {
  standalone: "スレッド", hubpedia_article: "Hubpedia", video: "動画", music_work: "音楽",
  community: "コミュニティ", shopping_review: "レビュー", game: "ゲーム", region: "地域",
};

export async function findD1HubThreadTarget(db: D1Database, type: HubThreadTargetType, targetId: string) {
  return db.prepare("SELECT thread_id FROM hub_thread_targets WHERE target_type=? AND target_id=?")
    .bind(type, targetId).first<{ thread_id: string }>();
}

export async function listD1HubThreadTargetPosts(db: D1Database, type: HubThreadTargetType, targetId: string, viewerId: string | null) {
  const binding = await findD1HubThreadTarget(db, type, targetId);
  if (!binding) return { thread: null, posts: [] };
  const [thread, posts, votes,knowledge] = await Promise.all([
    getD1Thread(db, binding.thread_id),
    listD1ThreadPosts(db, binding.thread_id).then((rows) => redactGated(db, viewerId, rows, "thread", { context: "detail", keyOf: (row: { threadId: string }) => row.threadId })),
    getD1ThreadPostVoteSummaries(db, binding.thread_id, viewerId),
    listThreadPostKnowledge(db,binding.thread_id),
  ]);
  return { thread, posts: posts.map((post) => ({ ...post, knowledge:knowledge.get(post.id),voteSummary: votes.get(post.id) ?? { up: 0, down: 0, score: 0, viewerVote: null } })) };
}

export async function postD1HubThreadTarget(db: D1Database, viewer: Profile, input: {
  type: HubThreadTargetType; targetId: string; body: string; parentPostId?: string | null; anonymous?: boolean;role?:ThreadPostRole;sources?:ThreadSource[];supersedesPostId?:string|null;
}) {
  const knowledge = input.role !== undefined || input.sources !== undefined || input.supersedesPostId !== undefined
    ? { role: input.role ?? "unspecified", sources: input.sources ?? [], supersedesPostId: input.supersedesPostId } : undefined;
  let binding = await findD1HubThreadTarget(db, input.type, input.targetId);
  if (!binding) {
    const created = await createD1Thread(db, viewer, {
      id: `board-embedded-${input.type}`, key: `embedded-${input.type}`, slug: `embedded-${input.type}`,
      title: TARGET_LABELS[input.type], description: `${TARGET_LABELS[input.type]}に紐づくHubスレッド`, threadCount: 0,
    }, {
      title: `${TARGET_LABELS[input.type]}のトーク`, body: input.body,
      identityMode: input.anonymous ? "anonymous" : "account", language: "ja", allowedLanguages: ["ja"],
      allowedLanguageTags: ["ja-JP"], allowedCountryCodes: [], writeIpPolicy: { mode: "none", cidrs: [] },
      region: "global", threadType: "chat", tags: [],
      knowledge,
    });
    await db.prepare("INSERT INTO hub_thread_targets(thread_id,target_type,target_id,created_at) VALUES(?,?,?,?)")
      .bind(created.thread.id, input.type, input.targetId, new Date().toISOString()).run();
    binding = { thread_id: created.thread.id };
  } else {
    await createD1ThreadReply(db, viewer, { threadId: binding.thread_id, body: input.body,
      identityMode: input.anonymous ? "anonymous" : "account", replyToPostId: input.parentPostId,
      declaredLanguage: "ja", declaredRegion: "global", knowledge });
  }
  return listD1HubThreadTargetPosts(db, input.type, input.targetId, viewer.id);
}
