import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { validateIdentity, validateThreadContent } from "@/lib/bbs-content-quality";
import { createBbsThreadForViewer } from "@/lib/server/bbs-route-data";

type Thread = { id: string; ownerId: string | null; status: string; moderationStatus: string; mergedInto: string | null; boardKey: string; language: string; region: string; tags: string; postCount: number };
type Summary = { id: string; revision_no: number; body: string; source: string; status: string; created_at: string };
export class ThreadKnowledgeAccessError extends Error {
  constructor(message: string, readonly status: 403 | 404) { super(message); }
}
const identifier = (value: unknown) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) throw new Error("スレッド・提案の指定が正しくありません。");
  return value;
};
async function readThread(db: D1Database, threadId: string) {
  identifier(threadId);
  const thread = await db.prepare(`SELECT t.id,t.created_by_profile_id ownerId,t.status,t.moderation_status moderationStatus,
    t.merged_into_thread_id mergedInto,b.board_key boardKey,t.language,t.region,t.tags_json tags,
    (SELECT COUNT(*) FROM thread_posts p WHERE p.thread_id=t.id) postCount
    FROM threads t JOIN boards b ON b.id=t.board_id WHERE t.id=? LIMIT 1`).bind(threadId).first<Thread>();
  if (!thread) throw new ThreadKnowledgeAccessError("スレッドが見つかりません。", 404);
  return thread;
}
function topicChoices(thread: Thread) {
  const tags: unknown = JSON.parse(thread.tags || "[]");
  if (!Array.isArray(tags)) throw new Error("スレッドのタグを確認できませんでした。");
  return [
    ...tags.filter((tag): tag is string => typeof tag === "string").map(value => ({ kind: "tag", value })),
    { kind: "board", value: thread.boardKey }, { kind: "language", value: thread.language }, { kind: "region", value: thread.region },
  ].filter(topic => topic.value && topic.value.length <= 100);
}

export function readThreadSummaryBefore(params: URLSearchParams) {
  const values = params.getAll("before");
  if (!values.length) return null;
  const value = Number(values[0]);
  if (values.length !== 1 || !/^[1-9]\d*$/.test(values[0]) || !Number.isSafeInteger(value)) throw new Error("提案のページ指定が正しくありません。");
  return value;
}
export async function getThreadKnowledgePlatform(db: D1Database, threadId: string, viewer: Profile | null, before: number | null = null) {
  if (before !== null && (!Number.isSafeInteger(before) || before < 1)) throw new Error("提案のページ指定が正しくありません。");
  const thread = await readThread(db, threadId);
  const canManage = Boolean(viewer && thread.ownerId === viewer.id);
  const writable = thread.status === "open" && thread.moderationStatus !== "frozen" && !thread.mergedInto;
  const [published, revisions, continuation, metrics, subscriptions, archived] = await Promise.all([
    db.prepare(`SELECT id,revision_no,body,source,status,created_at FROM thread_summary_revisions
      WHERE thread_id=? AND status='published' ORDER BY revision_no DESC LIMIT 1`).bind(threadId).all<Summary>(),
    db.prepare(`SELECT id,revision_no,body,source,status,created_at FROM thread_summary_revisions
      WHERE thread_id=? AND status!='published' AND (created_by_profile_id=? OR (?=1 AND status='proposed'))
      AND (? IS NULL OR revision_no<?) ORDER BY revision_no DESC LIMIT 21`)
      .bind(threadId, viewer?.id ?? "", canManage ? 1 : 0, before, before).all<Summary>(),
    db.prepare(`SELECT t.id,t.title,r.relation FROM thread_relations r JOIN threads t ON t.id=r.target_thread_id
      WHERE r.source_thread_id=? AND r.relation IN ('continuation','duplicate','merged') ORDER BY r.created_at LIMIT 20`).bind(threadId).all(),
    db.prepare(`SELECT event_type,COUNT(*) total,MIN(occurred_at) first_at,MAX(occurred_at) last_at
      FROM thread_operational_events WHERE thread_id=? GROUP BY event_type`).bind(threadId).all(),
    viewer ? db.prepare("SELECT kind,value FROM thread_topic_subscriptions WHERE profile_id=?").bind(viewer.id).all<{ kind: string; value: string }>() : Promise.resolve({ results: [] }),
    viewer ? db.prepare("SELECT thread_id FROM thread_reading_archive WHERE thread_id=? AND profile_id=?").bind(threadId, viewer.id).first() : Promise.resolve(null),
  ]);
  return {
    summaries: [...published.results, ...revisions.results.slice(0, 20)], continuation: continuation.results, metrics: metrics.results,
    summaryPage: { before, hasMore: revisions.results.length > 20, nextBefore: revisions.results.length > 20 ? revisions.results[19].revision_no : null },
    topics: topicChoices(thread).map(topic => ({ ...topic, following: subscriptions.results.some(item => item.kind === topic.kind && item.value === topic.value) })),
    archived: Boolean(archived), canManage: canManage && writable, canPropose: Boolean(viewer && writable), authenticated: Boolean(viewer),
    canContinue: Number(thread.postCount) >= 900 && thread.moderationStatus !== "frozen" && !thread.mergedInto,
  };
}

export async function updateThreadKnowledgePlatform(db: D1Database, actor: Profile, threadId: string, payload: unknown) {
  if (!payload || typeof payload !== "object" || !("action" in payload)) throw new Error("操作が正しくありません。");
  const body = payload as Record<string, unknown>;
  const thread = await readThread(db, threadId);
  const now = new Date().toISOString();
  if (body.action === "continue_thread") {
    const error = validateThreadContent({ title: typeof body.title === "string" ? body.title : "", body: typeof body.text === "string" ? body.text : "" })
      ?? validateIdentity(body.identityMode, undefined, ["account", "anonymous"]);
    if (error) throw new Error(error);
    if (typeof body.requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.requestId)) throw new Error("操作IDが正しくありません。");
    return createBbsThreadForViewer(db, actor, { boardKey: thread.boardKey, title: (body.title as string).trim(), body: (body.text as string).trim(), identityMode: body.identityMode as "account" | "anonymous", continuationFrom: threadId, requestId: body.requestId });
  }
  if (body.action === "propose_summary" || body.action === "publish_summary") {
    if (thread.status !== "open" || thread.moderationStatus === "frozen" || thread.mergedInto) throw new ThreadKnowledgeAccessError("このスレッドのまとめは変更できません。", 403);
    if (body.action === "propose_summary") {
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if ([...text].length < 20 || text.length > 12000) throw new Error("まとめは20〜12000文字で入力してください。");
      const id = body.requestId === undefined ? crypto.randomUUID() : identifier(body.requestId);
      const previous = await db.prepare("SELECT thread_id,created_by_profile_id,body FROM thread_summary_revisions WHERE id=?").bind(id).first<{ thread_id: string; created_by_profile_id: string; body: string }>();
      if (previous && (previous.thread_id !== threadId || previous.created_by_profile_id !== actor.id || previous.body !== text)) throw new Error("操作IDが別の提案で使用されています。");
      await db.prepare(`INSERT INTO thread_summary_revisions(id,thread_id,revision_no,body,source,status,created_by_profile_id,created_at)
        SELECT ?,?,COALESCE(MAX(revision_no),0)+1,?,'community','proposed',?,? FROM thread_summary_revisions WHERE thread_id=?
        HAVING EXISTS(SELECT 1 FROM threads WHERE id=? AND status='open' AND moderation_status!='frozen' AND merged_into_thread_id IS NULL)
        ON CONFLICT(id) DO NOTHING`).bind(id,threadId,text,actor.id,now,threadId,threadId).run();
      const confirmed = await db.prepare("SELECT thread_id,created_by_profile_id,body FROM thread_summary_revisions WHERE id=?").bind(id).first<{ thread_id: string; created_by_profile_id: string; body: string }>();
      if (!confirmed || confirmed.thread_id !== threadId || confirmed.created_by_profile_id !== actor.id || confirmed.body !== text) throw new Error("提案の保存結果を確認できませんでした。");
      return { saved: true, summaryId: id };
    }
    if (thread.ownerId !== actor.id) throw new ThreadKnowledgeAccessError("作成者だけがまとめを承認できます。", 403);
    const summaryId = identifier(body.summaryId);
    const proposal = await db.prepare("SELECT status FROM thread_summary_revisions WHERE id=? AND thread_id=?").bind(summaryId,threadId).first<{ status: string }>();
    if (!proposal || !["proposed", "published"].includes(proposal.status)) throw new Error("公開する提案が見つかりません。");
    await db.batch([
      db.prepare(`UPDATE thread_summary_revisions SET status='superseded' WHERE thread_id=? AND status='published'
        AND EXISTS(SELECT 1 FROM thread_summary_revisions WHERE id=? AND thread_id=? AND status='proposed')
        AND EXISTS(SELECT 1 FROM threads WHERE id=? AND status='open' AND moderation_status!='frozen' AND merged_into_thread_id IS NULL)`).bind(threadId,summaryId,threadId,threadId),
      db.prepare(`UPDATE thread_summary_revisions SET status='published',reviewed_by_profile_id=?,reviewed_at=?
        WHERE id=? AND thread_id=? AND status='proposed'
        AND EXISTS(SELECT 1 FROM threads WHERE id=? AND status='open' AND moderation_status!='frozen' AND merged_into_thread_id IS NULL)`).bind(actor.id,now,summaryId,threadId,threadId),
      db.prepare(`INSERT OR IGNORE INTO thread_operational_events(id,thread_id,event_type,occurred_at)
        SELECT ?,?,'summary_published',? WHERE EXISTS(SELECT 1 FROM thread_summary_revisions WHERE id=? AND thread_id=? AND status='published')`)
        .bind(`summary-published:${summaryId}`,threadId,now,summaryId,threadId),
    ]);
    const confirmed = await db.prepare("SELECT status FROM thread_summary_revisions WHERE id=? AND thread_id=?").bind(summaryId,threadId).first<{ status: string }>();
    if (confirmed?.status !== "published") throw new Error("公開結果を確認できませんでした。再読み込みしてください。");
    return { published: true, summaryId };
  }
  if (body.action === "subscribe" || body.action === "unsubscribe") {
    const topic = topicChoices(thread).find(topic => topic.kind === body.kind && topic.value === body.value);
    if (!topic) throw new Error("購読対象が正しくありません。");
    if (body.action === "subscribe") await db.prepare("INSERT OR IGNORE INTO thread_topic_subscriptions(profile_id,kind,value,created_at) VALUES(?,?,?,?)").bind(actor.id,topic.kind,topic.value,now).run();
    else await db.prepare("DELETE FROM thread_topic_subscriptions WHERE profile_id=? AND kind=? AND value=?").bind(actor.id,topic.kind,topic.value).run();
    return { subscribed: body.action === "subscribe", kind: topic.kind, value: topic.value };
  }
  if (body.action === "archive" || body.action === "unarchive") {
    if (body.action === "archive") await db.prepare(`INSERT INTO thread_reading_archive(thread_id,profile_id,archived_at) VALUES(?,?,?)
      ON CONFLICT(thread_id,profile_id) DO UPDATE SET archived_at=excluded.archived_at`).bind(threadId,actor.id,now).run();
    else await db.prepare("DELETE FROM thread_reading_archive WHERE thread_id=? AND profile_id=?").bind(threadId,actor.id).run();
    return { archived: body.action === "archive" };
  }
  if (body.action === "quality_vote") {
    const postId = identifier(body.postId);
    if (!["helpful", "primary_source", "outdated"].includes(String(body.dimension)) || ![-1,1].includes(body.value as number)) throw new Error("評価が正しくありません。");
    const post = await db.prepare("SELECT author_profile_id FROM thread_posts WHERE id=? AND thread_id=? AND deleted_at IS NULL AND moderated_at IS NULL").bind(postId,threadId).first<{ author_profile_id: string | null }>();
    if (!post || post.author_profile_id === actor.id || thread.moderationStatus === "frozen") throw new Error("このレスは評価できません。");
    await db.prepare(`INSERT INTO thread_post_quality_votes(post_id,profile_id,dimension,value,created_at,updated_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(post_id,profile_id,dimension) DO UPDATE SET value=CASE WHEN value=excluded.value THEN -excluded.value ELSE excluded.value END,updated_at=excluded.updated_at`)
      .bind(postId,actor.id,body.dimension,body.value,now,now).run();
    const scores = await db.prepare("SELECT dimension,SUM(value) score FROM thread_post_quality_votes WHERE post_id=? GROUP BY dimension").bind(postId).all();
    return { scores: scores.results };
  }
  throw new Error("操作が正しくありません。");
}
