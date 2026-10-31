import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import {
  ensureWikiArticle,
  getBaseContent,
  postDiscussion,
  WikiInputError,
  WikiRateLimitError,
} from "@/lib/server/hubpedia-wiki";
import { assertEditorNotSuspended } from "@/lib/server/hubpedia-wiki-policy";

/*
 * The alphaXiv layer (design section 1 and 8): discussion and "explain this" attached to a
 * claim or a paragraph. Backend only. Nothing here calls a paid model.
 */

export type AnchorType = "claim" | "paragraph";
export type Anchor = { type: AnchorType; id: string };

const slugOf = (value: string) => {
  const slug = value.normalize("NFKC").trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,118}[a-z0-9])?$/u.test(slug)) throw new WikiInputError("Invalid article slug.");
  return slug;
};

export function parseAnchor(type: unknown, id: unknown): Anchor {
  if (type !== "claim" && type !== "paragraph") throw new WikiInputError("anchorType must be claim or paragraph.");
  if (typeof id !== "string" || !/^[A-Za-z0-9:_-]{1,80}$/u.test(id)) throw new WikiInputError("anchorId is invalid.");
  return { type, id };
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Stable paragraph anchors for a Markdown body: a block separated by blank lines, headings
 * excluded. The id is a hash of the normalized text, so it survives edits elsewhere in the article.
 */
export async function paragraphAnchors(bodyMarkdown: string) {
  const seen = new Map<string, number>();
  const result: Array<{ id: string; index: number; text: string }> = [];
  const blocks = bodyMarkdown.normalize("NFC").split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean);
  for (const raw of blocks) {
    // A heading line is structure, not content: drop leading headings from the block.
    const block = raw.replace(/^(?:#{1,6}\s[^\n]*\n?)+/u, "").trim();
    if (!block) continue;
    const hash = `p-${(await sha256Hex(block.normalize("NFKC").replace(/\s+/gu, " "))).slice(0, 12)}`;
    const count = (seen.get(hash) ?? 0) + 1;
    seen.set(hash, count);
    result.push({ id: count === 1 ? hash : `${hash}-${count}`, index: result.length, text: block });
  }
  return result;
}

async function articleTopicId(db: D1Database, slug: string) {
  const row = await db.prepare("SELECT topic_id AS topicId FROM encyclopedia_articles WHERE slug = ? LIMIT 1").bind(slug).first<{ topicId: string }>();
  return row?.topicId ?? null;
}

/** Throws unless the anchor exists in the article as it is published now. */
async function assertAnchorExists(db: D1Database, slug: string, anchor: Anchor) {
  if (anchor.type === "claim") {
    const topicId = await articleTopicId(db, slug);
    const claim = topicId
      ? await db.prepare("SELECT id FROM encyclopedia_claims WHERE id = ? AND topic_id = ?").bind(anchor.id, topicId).first()
      : null;
    if (!claim) throw new WikiInputError("The claim was not found in this article.");
    return;
  }
  const base = await getBaseContent(db, slug);
  if (!base) throw new WikiInputError("Article was not found.");
  if (!(await paragraphAnchors(base.bodyMarkdown)).some((paragraph) => paragraph.id === anchor.id)) {
    throw new WikiInputError("The paragraph was not found in this article.");
  }
}

/* ---- reading structure (for the paragraph column) ---- */

export async function listArticleStructure(db: D1Database, slugValue: string) {
  const slug = slugOf(slugValue);
  const base = await getBaseContent(db, slug);
  if (!base) throw new WikiInputError("Article was not found.");
  const paragraphs = await paragraphAnchors(base.bodyMarkdown);
  const counts = await discussionCounts(db, slug);
  const topicId = await articleTopicId(db, slug);
  const claims = topicId
    ? (
        await db
          .prepare(
            `SELECT c.id, c.statement, c.status, k.knowledge_status AS knowledgeStatus
             FROM encyclopedia_claims c LEFT JOIN hubpedia_claim_knowledge_state k ON k.claim_id = c.id
             WHERE c.topic_id = ? ORDER BY c.created_at, c.id LIMIT 300`,
          )
          .bind(topicId)
          .all<{ id: string; statement: string; status: string; knowledgeStatus: string | null }>()
      ).results ?? []
    : [];
  const evidence = claims.length
    ? (
        await db
          .prepare(
            `SELECT e.claim_id AS claimId, e.kind, e.item_id AS itemId, e.stance, e.quote, e.status
             FROM hubpedia_hub_item_evidence e JOIN encyclopedia_claims c ON c.id = e.claim_id
             WHERE c.topic_id = ? AND e.status = 'active' ORDER BY e.created_at LIMIT 600`,
          )
          .bind(topicId)
          .all<{ claimId: string; kind: string; itemId: string; stance: string; quote: string; status: string }>()
      ).results ?? []
    : [];
  return {
    slug,
    paragraphs: paragraphs.map((paragraph) => ({ ...paragraph, discussionCount: counts.paragraph[paragraph.id] ?? 0 })),
    claims: claims.map((claim) => ({
      ...claim,
      discussionCount: counts.claim[claim.id] ?? 0,
      hubEvidence: evidence.filter((item) => item.claimId === claim.id).map(({ claimId: _claimId, ...rest }) => rest),
    })),
  };
}

/* ---- anchored discussion ---- */

export async function discussionCounts(db: D1Database, slugValue: string) {
  const rows = await db
    .prepare(
      `SELECT d.anchor_type AS type, d.anchor_id AS id, count(*) AS count
       FROM hubpedia_wiki_discussions d JOIN hubpedia_wiki_articles a ON a.article_key = d.article_key
       WHERE a.slug = ? AND d.anchor_type IS NOT NULL AND d.deleted_at IS NULL GROUP BY d.anchor_type, d.anchor_id`,
    )
    .bind(slugOf(slugValue))
    .all<{ type: AnchorType; id: string; count: number }>();
  const counts = { claim: {} as Record<string, number>, paragraph: {} as Record<string, number> };
  for (const row of rows.results ?? []) counts[row.type][row.id] = Number(row.count);
  return counts;
}

export async function listAnchoredDiscussion(db: D1Database, slugValue: string, anchor: Anchor) {
  const rows = await db
    .prepare(
      `SELECT d.id, d.parent_id AS parentId, d.body, d.created_at AS createdAt, p.handle AS authorHandle
       FROM hubpedia_wiki_discussions d JOIN hubpedia_wiki_articles a ON a.article_key = d.article_key
       JOIN profiles p ON p.id = d.author_profile_id
       WHERE a.slug = ? AND d.anchor_type = ? AND d.anchor_id = ? AND d.deleted_at IS NULL
       ORDER BY d.created_at LIMIT 200`,
    )
    .bind(slugOf(slugValue), anchor.type, anchor.id)
    .all();
  return rows.results ?? [];
}

export async function postAnchoredDiscussion(db: D1Database, actor: Profile, slugValue: string, anchor: Anchor, body: unknown, parentId?: unknown) {
  const slug = slugOf(slugValue);
  await assertAnchorExists(db, slug, anchor);
  if (typeof parentId === "string") {
    const parent = await db
      .prepare("SELECT 1 AS found FROM hubpedia_wiki_discussions WHERE id = ? AND anchor_type = ? AND anchor_id = ?")
      .bind(parentId, anchor.type, anchor.id)
      .first();
    if (!parent) throw new WikiInputError("The parent comment is not in this thread.");
  }
  return postDiscussion(db, actor, slug, body, parentId, anchor);
}

/* ---- explain this ---- */

export type LocalExplainer = (prompt: string) => Promise<string>;

/**
 * A local-only model, if the operator runs one: HUBPEDIA_LOCAL_MODEL_URL must point at a loopback
 * Ollama-compatible endpoint. Anything else is ignored, so no request can leave the machine
 * and no paid API is ever called from here.
 */
export function localExplainerFromEnv(env: Record<string, string | undefined> = process.env): LocalExplainer | null {
  const raw = env.HUBPEDIA_LOCAL_MODEL_URL;
  const model = env.HUBPEDIA_LOCAL_MODEL_NAME;
  if (!raw || !model) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/^https?:$/u.test(url.protocol)) return null;
  return async (prompt) => {
    const response = await fetch(new URL("/api/generate", url), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model, prompt, stream: false }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error("local_model_failed");
    const data = (await response.json()) as { response?: unknown };
    if (typeof data.response !== "string" || !data.response.trim()) throw new Error("local_model_empty");
    return data.response.trim().slice(0, 4000);
  };
}

/** Only the anchored claim/paragraph and the claim's stored evidence are given to the model. */
async function explanationPrompt(db: D1Database, slug: string, anchor: Anchor) {
  if (anchor.type === "paragraph") {
    const base = await getBaseContent(db, slug);
    const paragraph = base ? (await paragraphAnchors(base.bodyMarkdown)).find((item) => item.id === anchor.id) : null;
    if (!paragraph) throw new WikiInputError("The paragraph was not found in this article.");
    return `次の百科事典の段落を、書かれている内容だけを使って平易に説明してください。書かれていないことは足さないでください。\n\n${paragraph.text}`;
  }
  const claim = await db.prepare("SELECT statement FROM encyclopedia_claims WHERE id = ?").bind(anchor.id).first<{ statement: string }>();
  if (!claim) throw new WikiInputError("The claim was not found in this article.");
  const evidence =
    (
      await db
        .prepare("SELECT quote, stance FROM hubpedia_hub_item_evidence WHERE claim_id = ? AND status = 'active' ORDER BY created_at LIMIT 10")
        .bind(anchor.id)
        .all<{ quote: string; stance: string }>()
    ).results ?? [];
  const lines = evidence.map((item) => `- (${item.stance}) ${item.quote}`).join("\n");
  return `次の主張と、その証拠として記録されている引用だけを使って、平易に説明してください。証拠にないことは足さないでください。\n\n主張: ${claim.statement}\n\n証拠:\n${lines || "(なし)"}`;
}

const EXPLAIN_LIMIT_PER_HOUR = 10;

export async function requestExplanation(
  db: D1Database,
  actor: Profile,
  slugValue: string,
  anchor: Anchor,
  options: { localModel?: LocalExplainer | null } = {},
) {
  const slug = slugOf(slugValue);
  await assertEditorNotSuspended(db, actor.id);
  await assertAnchorExists(db, slug, anchor);
  const now = new Date().toISOString();
  const recent = await db
    .prepare("SELECT count(*) AS count FROM hubpedia_explain_requests WHERE requested_by = ? AND created_at >= ?")
    .bind(actor.id, new Date(Date.now() - 3600000).toISOString())
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= EXPLAIN_LIMIT_PER_HOUR) throw new WikiRateLimitError("Too many explanation requests.");
  const articleKey = await ensureWikiArticle(db, slug, now);

  const queued = await db
    .prepare("SELECT id FROM hubpedia_explain_requests WHERE article_key = ? AND anchor_type = ? AND anchor_id = ? AND status = 'queued' LIMIT 1")
    .bind(articleKey, anchor.type, anchor.id)
    .first<{ id: string }>();
  const requestId = queued?.id ?? crypto.randomUUID();
  if (!queued) {
    await db
      .prepare("INSERT INTO hubpedia_explain_requests(id, article_key, anchor_type, anchor_id, requested_by, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)")
      .bind(requestId, articleKey, anchor.type, anchor.id, actor.id, now)
      .run();
  }

  const localModel = options.localModel ?? null;
  if (!localModel) return { status: "queued" as const, requestId, note: "No local model is configured; the request is queued." };
  try {
    const explanation = await localModel(await explanationPrompt(db, slug, anchor));
    await db
      .prepare("UPDATE hubpedia_explain_requests SET status = 'ready', explanation = ?, completed_at = ? WHERE id = ?")
      .bind(explanation, new Date().toISOString(), requestId)
      .run();
    return { status: "ready" as const, requestId, explanation };
  } catch (error) {
    if (error instanceof WikiInputError) throw error;
    // The request stays queued so a later local run can pick it up.
    return { status: "queued" as const, requestId, note: "The local model was unavailable; the request stays queued." };
  }
}
