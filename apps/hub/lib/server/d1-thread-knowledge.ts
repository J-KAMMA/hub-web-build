import type { D1Database } from "@cloudflare/workers-types";
import { THREAD_POST_ROLES, type ThreadPostRole, type ThreadSource, type ThreadWorkflowState, type ThreadVoteReason } from "@/lib/thread-knowledge";

export type ThreadPostKnowledgeInput = {
  role: ThreadPostRole; supersedesPostId?: string | null; sources: ThreadSource[];
};

export type ThreadPostKnowledge = {
  role: ThreadPostRole;
  supersedesPostId: string | null;
  correctedByPostId: string | null;
  correctedByPostNo: number | null;
  freshness: "current" | "possibly_outdated" | "outdated";
  sources: ThreadSource[];
};

export async function listThreadPostKnowledge(db: D1Database, threadId: string) {
  const result = await db.prepare(`SELECT k.post_id,k.role,k.supersedes_post_id,k.freshness,k.sources_json,
    correction.post_id corrected_by_post_id,correction_post.post_no corrected_by_post_no
    FROM thread_post_knowledge k JOIN thread_posts p ON p.id=k.post_id
    LEFT JOIN thread_post_knowledge correction ON correction.supersedes_post_id=k.post_id
      AND EXISTS(SELECT 1 FROM thread_posts same_thread WHERE same_thread.id=correction.post_id AND same_thread.thread_id=p.thread_id)
    LEFT JOIN thread_posts correction_post ON correction_post.id=correction.post_id
    WHERE p.thread_id=?`).bind(threadId).all<{
      post_id: string; role: ThreadPostRole; supersedes_post_id: string | null;
      corrected_by_post_id: string | null; corrected_by_post_no: number | null;
      freshness: ThreadPostKnowledge["freshness"]; sources_json: string;
    }>();
  return new Map((result.results ?? []).map((row) => [row.post_id, {
    role: row.role,
    supersedesPostId: row.supersedes_post_id,
    correctedByPostId: row.corrected_by_post_id,
    correctedByPostNo: row.corrected_by_post_no == null ? null : Number(row.corrected_by_post_no),
    freshness: row.freshness,
    sources: JSON.parse(row.sources_json || "[]") as ThreadSource[],
  }]));
}

function knowledgeSources(input: ThreadPostKnowledgeInput): ThreadSource[] {
  if (!THREAD_POST_ROLES.includes(input.role) || !Array.isArray(input.sources) || input.sources.length > 5) throw new Error("レス情報が正しくありません。");
  const seen = new Set<string>();
  return input.sources.map(source => {
    try {
      if (!source || typeof source.url !== "string" || source.url.length > 2048 || /[\u0000-\u001f\u007f-\u009f\p{Surrogate}]/u.test(source.url)) throw new Error();
      const parsed = new URL(source.url);
      const label = typeof source.label === "string" ? source.label.trim() || parsed.hostname.slice(0, 100) : null;
      if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.href.length > 2048 || seen.has(parsed.href) ||
        !label || label.length > 100 || /[\u0000-\u001f\u007f-\u009f\p{Surrogate}]/u.test(label) ||
        !["primary", "news", "personal", "other"].includes(source.kind)) throw new Error();
      seen.add(parsed.href);
      return { url: parsed.href, label, kind: source.kind };
    } catch { throw new Error("出典が正しくありません。"); }
  });
}

export function normalizeThreadPostKnowledge(input: ThreadPostKnowledgeInput) {
  const safeSources = knowledgeSources(input);
  const targetId = input.supersedesPostId ?? null;
  if (targetId !== null) {
    if (typeof targetId !== "string" || !targetId.length || targetId.length > 160 || /[^A-Za-z0-9._:-]/u.test(targetId)) throw new Error("訂正対象が同じスレッドにありません。");
    const numeric = !/[^0-9]/u.test(targetId);
    if (numeric && (!Number.isSafeInteger(Number(targetId)) || Number(targetId) < 1)) throw new Error("訂正対象が同じスレッドにありません。");
  }
  return { role: input.role, sources: safeSources, supersedesPostId: targetId };
}
async function resolveThreadPostKnowledge(db: D1Database, input: ThreadPostKnowledgeInput & { postId: string; threadId: string }) {
  const knowledge = normalizeThreadPostKnowledge(input);
  let targetId = knowledge.supersedesPostId;
  if (targetId !== null) {
    const numeric = !/[^0-9]/u.test(targetId);
    targetId = (await db.prepare(numeric ? "SELECT id FROM thread_posts WHERE thread_id=? AND post_no=?" : "SELECT id FROM thread_posts WHERE thread_id=? AND id=?")
      .bind(input.threadId, numeric ? Number(targetId) : targetId).first<{id: string}>())?.id ?? null;
    if (!targetId || targetId === input.postId) throw new Error("訂正対象が同じスレッドにありません。");
  }
  return { ...knowledge, supersedesPostId: targetId };
}

/** Metadata is editable: replay compares current stored intent conservatively,
 * not an immutable copy of the original creation request. Freshness is derived. */
export async function matchesThreadPostKnowledge(db: D1Database, input: {
  postId: string; threadId: string; profileId: string; knowledge?: ThreadPostKnowledgeInput;
}): Promise<boolean> {
  const requested: ThreadPostKnowledgeInput = input.knowledge ?? { role: "unspecified", sources: [] };
  const expected = await resolveThreadPostKnowledge(db, { ...requested, postId: input.postId, threadId: input.threadId });
  const stored = await db.prepare(`SELECT k.role,k.supersedes_post_id,k.sources_json FROM thread_posts p
    LEFT JOIN thread_post_knowledge k ON k.post_id=p.id
    WHERE p.id=? AND p.thread_id=? AND p.post_no=1 AND p.author_profile_id=?`)
    .bind(input.postId, input.threadId, input.profileId).first<{ role: ThreadPostRole | null; supersedes_post_id: string | null; sources_json: string | null }>();
  if (!stored) return false;
  try {
    const actual = await resolveThreadPostKnowledge(db, { postId: input.postId, threadId: input.threadId,
      role: stored.role ?? "unspecified", supersedesPostId: stored.supersedes_post_id, sources: JSON.parse(stored.sources_json ?? "[]") as ThreadSource[] });
    return actual.role === expected.role && actual.supersedesPostId === expected.supersedesPostId && JSON.stringify(actual.sources) === JSON.stringify(expected.sources);
  } catch { return false; }
}

/** Fixed domain statements shared by creation and author-only editing. */
export async function prepareThreadPostKnowledge(db: D1Database, input: ThreadPostKnowledgeInput & {
  postId: string; threadId: string; profileId: string;
}, now: string) {
  const knowledge = await resolveThreadPostKnowledge(db, input), targetId = knowledge.supersedesPostId;
  // A vanished/moved target or changed author produces NULL for the existing
  // NOT NULL role column, aborting the whole batch rather than leaving a reply.
  const statements = [db.prepare(`INSERT INTO thread_post_knowledge(post_id,role,supersedes_post_id,freshness,sources_json,updated_at)
    VALUES(?1,(SELECT ?2 FROM thread_posts p WHERE p.id=?1 AND p.thread_id=?3 AND p.author_profile_id=?4
      AND (?5 IS NULL OR EXISTS(SELECT 1 FROM thread_posts target WHERE target.id=?5 AND target.thread_id=p.thread_id))),?5,'current',?6,?7)
    ON CONFLICT(post_id) DO UPDATE SET role=excluded.role,
    supersedes_post_id=excluded.supersedes_post_id,sources_json=excluded.sources_json,updated_at=excluded.updated_at`)
    .bind(input.postId, knowledge.role, input.threadId, input.profileId, targetId, JSON.stringify(knowledge.sources), now)];
  if (targetId) {
    statements.push(db.prepare(`INSERT INTO thread_post_knowledge(post_id,role,freshness,sources_json,updated_at)
      VALUES(?1,(SELECT 'unspecified' FROM thread_posts WHERE id=?1 AND thread_id=?2),'outdated','[]',?3)
      ON CONFLICT(post_id) DO UPDATE SET freshness='outdated',updated_at=excluded.updated_at`).bind(targetId, input.threadId, now));
  }
  return statements;
}

export async function saveThreadPostKnowledge(db: D1Database, input: ThreadPostKnowledgeInput & { postId: string; profileId: string }) {
  const post = await db.prepare("SELECT thread_id,author_profile_id FROM thread_posts WHERE id=?")
    .bind(input.postId).first<{thread_id: string; author_profile_id: string | null}>();
  if (!post) throw new Error("レスが見つかりません。");
  if (post.author_profile_id !== input.profileId) throw new Error("投稿者だけがレス情報を変更できます。");
  await db.batch(await prepareThreadPostKnowledge(db, { ...input, threadId: post.thread_id }, new Date().toISOString()));
}

export async function setThreadWorkflow(db: D1Database, threadId: string, profileId: string, state: ThreadWorkflowState) {
  const thread = await db.prepare("SELECT created_by_profile_id FROM threads WHERE id=?")
    .bind(threadId).first<{created_by_profile_id: string | null}>();
  if (!thread || thread.created_by_profile_id !== profileId) throw new Error("作成者だけが状態を変更できます。");
  await db.prepare(`INSERT INTO thread_workflow_states(thread_id,state,updated_by_profile_id,updated_at)
    VALUES(?,?,?,?) ON CONFLICT(thread_id) DO UPDATE SET state=excluded.state,
    updated_by_profile_id=excluded.updated_by_profile_id,updated_at=excluded.updated_at`)
    .bind(threadId, state, profileId, new Date().toISOString()).run();
  if (state === "resolved") await db.prepare("INSERT INTO thread_operational_events(id,thread_id,event_type,occurred_at) VALUES(?,?,'resolved',?)")
    .bind(crypto.randomUUID(), threadId, new Date().toISOString()).run().catch(() => undefined);
  return { state };
}

export async function saveVoteReason(db: D1Database, postId: string, profileId: string, reason: ThreadVoteReason | null) {
  if (!reason) {
    await db.prepare("DELETE FROM thread_vote_reasons WHERE post_id=? AND profile_id=?").bind(postId, profileId).run();
    return;
  }
  await db.prepare(`INSERT INTO thread_vote_reasons(post_id,profile_id,reason,created_at) VALUES(?,?,?,?)
    ON CONFLICT(post_id,profile_id) DO UPDATE SET reason=excluded.reason,created_at=excluded.created_at`)
    .bind(postId, profileId, reason, new Date().toISOString()).run();
}
