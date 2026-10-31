import { getHubD1 } from "@/lib/server/hub-d1";
import { isTargetGated, notGatedSql, omitGated } from "@/lib/server/gated-exits";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import {
  AgentScopeError, authenticateAgent, getAgentProfile, recordAgentAudit, requireAgentScope,
  type AgentGrant,
} from "@/lib/server/agent-access";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { listD1Notifications } from "@/lib/server/d1-notifications";
import { createD1SocialPost } from "@/lib/server/d1-social-posts";
import {
  getMcpRelated, listMcpCatalog, resolveMcpArticle, resolveMcpClaims, resolveMcpSection, searchMcpKnowledge,
} from "@/lib/server/hubpedia-mcp-data";
import { searchMcpClaims } from "@/lib/encyclopedia/mcp-knowledge";
import { recordMcpUsage } from "@/lib/server/hubpedia-quality-operations";
import {
  getHubpediaResearchAgenda,
  HubpediaMemoryProposalInputError,
  HubpediaMemoryProposalRateLimitError,
  listAgentHubpediaMemoryProposals,
  listHubpediaSharedMemory,
  submitHubpediaMemoryProposal,
} from "@/lib/server/hubpedia-memory-proposals";
import {
  listWikipediaSources, readWikipediaSummary, searchWikipedia, type WikipediaLocale,
} from "@/lib/server/wikipedia-lookup";

// Same visibility conditions as the timeline (d1-social-posts.ts): not moderated, author not suspended.
const PUBLIC_POST_VISIBLE_SQL = `social_posts.moderated_at IS NULL AND (social_posts.author_profile_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM profile_moderation_status moderation
  WHERE moderation.profile_id = social_posts.author_profile_id AND moderation.status = 'suspended'
))`;
const VERSION = "2025-06-18";
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };

const tools = [
  tool("hub_get_feed", "自分のHubフィードを取得します。", {
    type: "object", properties: { feed: { enum: ["recommended", "popular", "following", "latest"] }, limit: { type: "integer", minimum: 1, maximum: 50 } },
  }, true),
  tool("hub_search_posts", "Hub内の公開ポストを検索します。", {
    type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 50 } },
  }, true),
  tool("hub_get_post", "公開ポストをIDで取得します。", {
    type: "object", required: ["post_id"], properties: { post_id: { type: "string" } },
  }, true),
  tool("hub_get_thread", "返信を含む会話を取得します。", {
    type: "object", required: ["post_id"], properties: { post_id: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } },
  }, true),
  tool("hub_get_notifications", "自分の通知を取得します。", {
    type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 100 } },
  }, true),
  tool("hub_create_draft", "Hubポストの下書きを作成します。公開はしません。", {
    type: "object", required: ["body"], properties: { body: { type: "string", minLength: 1, maxLength: HUB_SOCIAL_POST_MAX_CHARACTERS }, reply_to_post_id: { type: "string" } },
  }),
  tool("hub_publish_post", "ユーザーがHub上で承認済みの下書きだけを公開します。", {
    type: "object", required: ["draft_id"], properties: { draft_id: { type: "string" } },
  }),
  /*
   * Hubpedia over MCP. The knowledge layer was reachable only over REST, so
   * an agent could read the Hub's posts but not the encyclopedia the Hub
   * writes — the one thing worth asking it for.
   */
  tool("hubpedia_search", "Hubpediaの記事を検索します。", {
    type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 20 } },
  }, true),
  tool("hubpedia_get_article", "Hubpediaの記事を全文で取得します。出典・品質・鮮度を伴います。", {
    type: "object", required: ["slug"], properties: { slug: { type: "string", minLength: 1, maxLength: 200 }, locale: { enum: ["ja", "en"] } },
  }, true),
  /* A section, so an agent need not spend a whole article to answer one question. */
  tool("hubpedia_get_section", "記事の節だけを取得します。全文を読まずに済みます。", {
    type: "object", required: ["slug", "section"], properties: { slug: { type: "string", minLength: 1, maxLength: 200 }, section: { type: "string", minLength: 1, maxLength: 200 }, locale: { enum: ["ja", "en"] } },
  }, true),
  tool("hubpedia_get_related", "関連する記事を返します。概念をたどるのに使います。", {
    type: "object", required: ["slug"], properties: { slug: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 20 } },
  }, true),
  tool("hubpedia_get_sources", "記事の主張ごとの出典を返します。裏取りに使います。", {
    type: "object", required: ["slug"], properties: { slug: { type: "string", minLength: 1, maxLength: 200 } },
  }, true),
  /* Claim-level search: which sourced statements say X — the unit an agent
   * cites when it grounds an answer, rather than a whole article. */
  tool("hubpedia_search_claims", "出典付きの主張を横断検索します。回答の裏付けに使うクレームを直接探します。", {
    type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 200 }, limit: { type: "integer", minimum: 1, maximum: 50 } },
  }, true),
  /* Enumeration, for agents that need the whole map rather than one answer. */
  tool("hubpedia_list_articles", "公開中の記事一覧を返します。スラッグ・題名・カテゴリのみ。", {
    type: "object", properties: { category: { type: "string", maxLength: 100 }, limit: { type: "integer", minimum: 1, maximum: 500 } },
  }, true),
  tool("hubpedia_propose_memory", "検証前の記憶候補をHubpediaの非公開審査キューへ提出します。記事は公開しません。", {
    type: "object",
    required: ["kind", "title", "content", "idempotency_key"],
    properties: {
      kind: { enum: ["claim", "source", "correction", "question", "firsthand"] },
      title: { type: "string", minLength: 2, maxLength: 160 },
      content: { type: "string", minLength: 1, maxLength: 8000 },
      /* The verbatim passage the claim rests on. With trusted source URLs it
       * lets the server machine-verify the evidence instead of waiting on a
       * reviewer — quote text only, never the claim itself. */
      quote: { type: "string", maxLength: 2000 },
      source_urls: { type: "array", maxItems: 5, items: { type: "string", format: "uri" } },
      target_article_slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
      /* For corrections: the shared entry this proposal retires if accepted. */
      corrects_proposal_id: { type: "string", maxLength: 200 },
      /* For answers: the accepted question this proposal resolves. */
      answers_proposal_id: { type: "string", maxLength: 200 },
      /* For replications: the accepted entry this proposal independently
       * verified — the institution's peer-review record. */
      corroborates_proposal_id: { type: "string", maxLength: 200 },
      idempotency_key: { type: "string", minLength: 8, maxLength: 100 },
    },
  }),
  /* Feedback for the writer: what it proposed and what became of it. */
  tool("hubpedia_my_proposals", "自分が提出したHubpedia記憶候補の状態を返します。", {
    type: "object",
    properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
  }, true),
  /* The commons itself: accepted knowledge, with provenance, that other
   * contributors produced — the read half of agent-to-agent sharing. */
  tool("hubpedia_shared_memory", "審査を通過した共有知識を返します。他の貢献者の受理済み主張・出典を読みます。", {
    type: "object",
    properties: {
      kind: { enum: ["claim", "source", "correction", "question", "firsthand"] },
      query: { type: "string", minLength: 1, maxLength: 200 },
      include_superseded: { type: "boolean" },
      /* The demand side: open questions the commons still needs answered. */
      needs_answer: { type: "boolean" },
      /* Accepted answers attached to one question id. */
      answers_for: { type: "string", maxLength: 200 },
      /* The institution's findings: entries two or more independent
       * contributors stand behind (same claim or explicit replication). */
      findings: { type: "boolean" },
      limit: { type: "integer", minimum: 1, maximum: 50 },
    },
  }, true),
  /* The directorate's work program: open questions, accepted knowledge still
   * awaiting independent replication, and institutional statistics. */
  tool("hubpedia_research_agenda", "研究機関の作業課題を返します。未回答の問い・追試待ちの知見・統計。", {
    type: "object", properties: {},
  }, true),
  /*
   * Wikipedia consulted, not copied. Hubpedia holds what the Hub knows;
   * for the rest of the world there is an encyclopedia already written,
   * and 42 million sections is not a thing to duplicate.
   */
  tool("wikipedia_search", "Wikipediaの記事を検索します。Hubpediaに無い一般知識に使います。", {
    type: "object", required: ["query"], properties: { query: { type: "string", minLength: 1, maxLength: 200 }, locale: { enum: ["ja", "en"] }, limit: { type: "integer", minimum: 1, maximum: 10 } },
  }, true),
  tool("wikipedia_summary", "Wikipedia記事の冒頭要約を返します。出典とライセンスを伴います。", {
    type: "object", required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 200 }, locale: { enum: ["ja", "en"] } },
  }, true),
  /* The citations, which lead to sources usable on their own terms. */
  tool("wikipedia_sources", "Wikipedia記事が挙げている出典を返します。一次資料に当たるために使います。", {
    type: "object", required: ["title"], properties: { title: { type: "string", minLength: 1, maxLength: 200 }, locale: { enum: ["ja", "en"] }, limit: { type: "integer", minimum: 1, maximum: 100 } },
  }, true),
] as const;

function tool(name: string, description: string, inputSchema: Record<string, unknown>, readOnly = false) {
  return {
    name, description, inputSchema,
    annotations: { readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
  };
}

function rpc(id: unknown, result?: unknown, error?: { code: number; message: string; data?: unknown }) {
  return new Response(JSON.stringify(error
    ? { jsonrpc: "2.0", id, error }
    : { jsonrpc: "2.0", id, result }), { headers: JSON_HEADERS });
}

function unauthorized(request: Request) {
  const origin = new URL(request.url).origin;
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: {
      ...JSON_HEADERS,
      "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
    },
  });
}

function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
    structuredContent: typeof value === "object" && value !== null ? value : { value },
    ...(isError ? { isError: true } : {}),
  };
}

export async function POST(request: Request) {
  const db = getHubD1();
  const grant = await authenticateAgent(request, db);
  if (!grant) return unauthorized(request);
  const payload = await request.json().catch(() => null) as {
    id?: unknown; method?: string; params?: { name?: string; arguments?: Record<string, unknown> };
  } | null;
  if (!payload?.method) return rpc(payload?.id ?? null, undefined, { code: -32600, message: "Invalid Request" });
  if (payload.method === "initialize") {
    return rpc(payload.id, {
      protocolVersion: VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "JKamma Hub Social", version: "0.1.0" },
      instructions: "Hubの公開情報とHubpediaの記事、およびWikipediaの要約と出典を読み、下書きや検証前のHubpedia記憶候補を作成できます。記憶候補は記事ではなく非公開審査資料ですが、審査または機械検証を通過したものは共有知識として全エージェントが読めます。公開は既存の人間審査と公開承認を通過した場合に限ります。決済・ウォレット署名は利用できません。",
    });
  }
  if (payload.method === "notifications/initialized") return new Response(null, { status: 202 });
  if (payload.method === "ping") return rpc(payload.id, {});
  if (payload.method === "tools/list") return rpc(payload.id, { tools });
  if (payload.method !== "tools/call" || !payload.params?.name) {
    return rpc(payload.id, undefined, { code: -32601, message: "Method not found" });
  }
  try {
    const result = await callTool(db, grant, payload.params.name, payload.params.arguments ?? {}, request);
    return rpc(payload.id, result);
  } catch (error) {
    if (error instanceof AgentScopeError) return rpc(payload.id, textResult({ error: "insufficient_scope", required: error.scope }, true));
    return rpc(payload.id, textResult({ error: "tool_failed", message: error instanceof Error ? error.message : "Unknown error" }, true));
  }
}

export async function GET(request: Request) {
  const db = getHubD1();
  return (await authenticateAgent(request, db)) ? new Response(null, { status: 405 }) : unauthorized(request);
}

export async function DELETE(request: Request) {
  const db = getHubD1();
  return (await authenticateAgent(request, db)) ? new Response(null, { status: 204 }) : unauthorized(request);
}

async function callTool(
  db: ReturnType<typeof getHubD1>, grant: AgentGrant, name: string,
  args: Record<string, unknown>, request: Request,
) {
  if (name === "hub_get_feed") {
    requireAgentScope(grant, "social.read");
    const limit = bounded(args.limit, 20, 50);
    const feed = ["popular", "following", "latest"].includes(String(args.feed)) ? String(args.feed) : "recommended";
    // Gated posts are never handed to an agent, even when the grant owner passes the gate.
    const feedPosts = await listD1TimelinePosts(db, grant.profileId, undefined, limit, 0, undefined, null, feed as "popular" | "following" | "latest" | "recommended");
    return textResult({ posts: await omitGated(db, "post", feedPosts, (post) => post.id) });
  }
  if (name === "hub_search_posts") {
    requireAgentScope(grant, "social.read");
    const query = String(args.query ?? "").trim().slice(0, 200);
    if (!query) throw new Error("query is required");
    const limit = bounded(args.limit, 20, 50);
    const rows = await db.prepare(`SELECT id, display_name AS displayName, handle, body, created_at AS createdAt
      FROM social_posts WHERE ${PUBLIC_POST_VISIBLE_SQL} AND audience = 'public'
        AND ${notGatedSql("post", "social_posts.id")}
        AND (body LIKE ? OR display_name LIKE ? OR handle LIKE ?)
      ORDER BY datetime(created_at) DESC LIMIT ?`)
      .bind(`%${query}%`, `%${query}%`, `%${query}%`, limit).all();
    return textResult({ posts: rows.results });
  }
  if (name === "hub_get_post" || name === "hub_get_thread") {
    requireAgentScope(grant, "social.read");
    const postId = String(args.post_id ?? "");
    const post = await db.prepare(`SELECT id, display_name AS displayName, handle, body, created_at AS createdAt,
      reply_to_post_id AS replyToPostId FROM social_posts
      WHERE id = ? AND ${PUBLIC_POST_VISIBLE_SQL} AND audience = 'public' LIMIT 1`).bind(postId).first();
    if (!post || await isTargetGated(db, "post", postId)) throw new Error("Post not found");
    if (name === "hub_get_post") return textResult({ post });
    const replies = await db.prepare(`SELECT id, display_name AS displayName, handle, body, created_at AS createdAt
      FROM social_posts WHERE reply_to_post_id = ? AND ${PUBLIC_POST_VISIBLE_SQL} AND audience = 'public'
        AND ${notGatedSql("post", "social_posts.id")}
      ORDER BY datetime(created_at) ASC LIMIT ?`).bind(postId, bounded(args.limit, 50, 100)).all();
    return textResult({ post, replies: replies.results });
  }
  if (name === "hub_get_notifications") {
    requireAgentScope(grant, "notifications.read");
    return textResult({ notifications: await listD1Notifications(db, grant.profileId, { limit: bounded(args.limit, 30, 100), excludeMessageReceived: true }) });
  }
  if (name === "hub_create_draft") {
    requireAgentScope(grant, "social.draft");
    const body = String(args.body ?? "").trim();
    if (!body || body.length > HUB_SOCIAL_POST_MAX_CHARACTERS) throw new Error(`body must contain 1 to ${HUB_SOCIAL_POST_MAX_CHARACTERS} characters`);
    const id = crypto.randomUUID();
    const replyId = typeof args.reply_to_post_id === "string" ? args.reply_to_post_id : null;
    await db.prepare(`INSERT INTO hub_agent_drafts
      (id, profile_id, grant_id, body, destination_type, destination_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'draft', ?)`)
      .bind(id, grant.profileId, grant.id, body, replyId ? "reply" : "feed", replyId, new Date().toISOString()).run();
    await recordAgentAudit(db, grant, "draft.create", "succeeded", replyId ? "social_post" : null, replyId);
    return textResult({ draftId: id, status: "draft", approvalUrl: `${new URL(request.url).origin}/settings?agent_draft=${id}#agent-access` });
  }
  if (name === "hub_publish_post") {
    requireAgentScope(grant, "social.publish");
    const draftId = String(args.draft_id ?? "");
    const draft = await db.prepare(`SELECT id, body, destination_type, destination_id, status
      FROM hub_agent_drafts WHERE id = ? AND profile_id = ? AND grant_id = ? LIMIT 1`)
      .bind(draftId, grant.profileId, grant.id)
      .first<{ id: string; body: string; destination_type: string; destination_id: string | null; status: string }>();
    if (!draft) throw new Error("Draft not found");
    if (draft.status !== "approved") {
      await recordAgentAudit(db, grant, "post.publish", "approval_required", "agent_draft", draftId);
      return textResult({
        status: "approval_required",
        approvalUrl: `${new URL(request.url).origin}/settings?agent_draft=${draftId}#agent-access`,
      });
    }
    const profile = await getAgentProfile(db, grant.profileId);
    const post = await createD1SocialPost(db, profile, {
      body: draft.body, identityMode: "account",
      replyToPostId: draft.destination_type === "reply" ? draft.destination_id : null,
      audience: "public", clientRequestId: draft.id,
    });
    await db.prepare(`UPDATE hub_agent_drafts SET status='published', published_at=?, published_post_id=?
      WHERE id=? AND status='approved'`).bind(new Date().toISOString(), post.id, draft.id).run();
    await recordAgentAudit(db, grant, "post.publish", "succeeded", "social_post", post.id);
    return textResult({ status: "published", post });
  }
  if (name === "hubpedia_propose_memory") {
    requireAgentScope(grant, "hubpedia.propose");
    try {
      const proposal = await submitHubpediaMemoryProposal(db, {
        profileId: grant.profileId,
        type: "agent",
        agentGrantId: grant.id,
      }, {
        kind: args.kind,
        title: args.title,
        content: args.content,
        quote: args.quote,
        sourceUrls: args.source_urls,
        targetArticleSlug: args.target_article_slug,
        correctsProposalId: args.corrects_proposal_id,
        answersProposalId: args.answers_proposal_id,
        corroboratesProposalId: args.corroborates_proposal_id,
        idempotencyKey: args.idempotency_key,
      });
      await recordAgentAudit(db, grant, "hubpedia.memory.propose", "succeeded", "hubpedia_memory_proposal", proposal.id);
      return textResult(proposal);
    } catch (error) {
      const status = error instanceof HubpediaMemoryProposalRateLimitError
        ? "rate_limited"
        : error instanceof HubpediaMemoryProposalInputError
          ? "invalid"
          : "failed";
      await recordAgentAudit(db, grant, "hubpedia.memory.propose", status);
      throw error;
    }
  }
  /* The writer's own queue only — scoped by the authenticated grant, so one
   * agent can never read another's private submissions. */
  if (name === "hubpedia_my_proposals") {
    requireAgentScope(grant, "hubpedia.propose");
    const result = await listAgentHubpediaMemoryProposals(db, grant.id, bounded(args.limit, 20, 50));
    await recordAgentAudit(db, grant, "hubpedia.memory.list", "succeeded");
    return textResult(result);
  }
  /*
   * The encyclopedia is not gated by a scope. The same articles are served
   * without any authentication at /api/hubpedia/v1, this endpoint already
   * authenticates the agent, and a new scope would fail closed for every
   * grant that exists today — locking out the agents it was meant to serve.
   */
  if (name === "hubpedia_search") {
    const limit = bounded(args.limit, 8, 20);
    const results = await searchMcpKnowledge(db, String(args.query ?? ""), limit);
    await recordMcpUsage(db, "search_articles", JSON.stringify(results).length, {});
    return textResult({ query: String(args.query ?? ""), results });
  }
  if (name === "hubpedia_get_article") {
    const article = await resolveMcpArticle(db, String(args.slug ?? ""), locale(args.locale));
    if (!article) return textResult({ error: "article_not_found", slug: String(args.slug ?? "") }, true);
    await recordMcpUsage(db, "get_article", JSON.stringify(article).length, {});
    return textResult(article);
  }
  if (name === "hubpedia_get_section") {
    const section = await resolveMcpSection(db, String(args.slug ?? ""), String(args.section ?? ""), locale(args.locale));
    if (!section) return textResult({ error: "section_not_found", slug: String(args.slug ?? ""), section: String(args.section ?? "") }, true);
    await recordMcpUsage(db, "get_section", JSON.stringify(section).length, {});
    return textResult(section);
  }
  if (name === "hubpedia_get_related") {
    const related = await getMcpRelated(String(args.slug ?? ""), bounded(args.limit, 8, 20));
    if (!related) return textResult({ error: "article_not_found", slug: String(args.slug ?? "") }, true);
    await recordMcpUsage(db, "get_related", JSON.stringify(related).length, {});
    return textResult(related);
  }
  if (name === "wikipedia_search") {
    const hits = await searchWikipedia(String(args.query ?? ""), wikiLocale(args.locale), bounded(args.limit, 5, 10));
    await recordMcpUsage(db, "wikipedia_search", JSON.stringify(hits).length, {});
    return textResult({ query: String(args.query ?? ""), results: hits });
  }
  if (name === "wikipedia_summary") {
    const summary = await readWikipediaSummary(String(args.title ?? ""), wikiLocale(args.locale));
    if (!summary) return textResult({ error: "article_not_found", title: String(args.title ?? "") }, true);
    await recordMcpUsage(db, "wikipedia_summary", JSON.stringify(summary).length, {});
    return textResult(summary);
  }
  if (name === "wikipedia_sources") {
    const sources = await listWikipediaSources(String(args.title ?? ""), wikiLocale(args.locale), bounded(args.limit, 20, 100));
    await recordMcpUsage(db, "wikipedia_sources", JSON.stringify(sources).length, {});
    return textResult({ title: String(args.title ?? ""), sources });
  }
  if (name === "hubpedia_get_sources") {
    const claims = await resolveMcpClaims(db, String(args.slug ?? ""));
    await recordMcpUsage(db, "get_sources", JSON.stringify(claims).length, {});
    return textResult({ slug: String(args.slug ?? ""), claims });
  }
  if (name === "hubpedia_search_claims") {
    const results = await searchMcpClaims(String(args.query ?? ""), bounded(args.limit, 10, 50));
    await recordMcpUsage(db, "search_claims", JSON.stringify(results).length, {});
    return textResult({ query: String(args.query ?? ""), results });
  }
  if (name === "hubpedia_list_articles") {
    const articles = await listMcpCatalog(db, args.category ? String(args.category) : undefined, bounded(args.limit, 500, 500));
    await recordMcpUsage(db, "list_articles", JSON.stringify(articles).length, {});
    return textResult({ count: articles.length, articles });
  }
  /* Accepted proposals are the commons every agent reads — the same fail-open
   * reasoning as the articles themselves applies once review has passed. */
  if (name === "hubpedia_shared_memory") {
    const result = await listHubpediaSharedMemory(db, {
      kind: args.kind,
      query: args.query,
      includeSuperseded: args.include_superseded === true,
      needsAnswer: args.needs_answer === true,
      answersFor: args.answers_for,
      findings: args.findings === true,
      limit: bounded(args.limit, 20, 50),
    });
    await recordMcpUsage(db, "shared_memory", JSON.stringify(result).length, {});
    return textResult(result);
  }
  if (name === "hubpedia_research_agenda") {
    const agenda = await getHubpediaResearchAgenda(db);
    await recordMcpUsage(db, "research_agenda", JSON.stringify(agenda).length, {});
    return textResult(agenda);
  }
  throw new Error(`Unknown tool: ${name}`);
}

function wikiLocale(value: unknown): WikipediaLocale {
  return value === "en" ? "en" : "ja";
}

/* Anything but "en" reads as Japanese, which is what the Hub defaults to. */
function locale(value: unknown): "ja" | "en" {
  return value === "en" ? "en" : "ja";
}

function bounded(value: unknown, fallback: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(1, Math.trunc(number))) : fallback;
}
