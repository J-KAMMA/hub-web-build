import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import {
  buildEvolvingCategoryIndex,
  type DynamicCategoryNode,
  type EvolvingCategoryIndex,
} from "@/lib/encyclopedia/category-evolution";
import {
  ENCYCLOPEDIA_CATEGORIES,
  getArticleCategoryIds,
  isEncyclopediaCategoryOrDescendant,
} from "@/lib/encyclopedia/categories";
import type { ViewableSeedArticle } from "@/lib/encyclopedia/seed";
import { categoryRelationshipSemantics, detectCategoryGraphProblems } from "@/lib/encyclopedia/category-graph";

type StoredCategory = {
  id: string;
  parentId: string | null;
  state: DynamicCategoryNode["state"] | "retired" | "merged";
  articleCount: number;
  dynamicDepth: number;
  requiresAiReview: number;
  name: string;
  description: string;
  aliases: string | null;
};

const normalize = (value: string) =>
  value.normalize("NFKC").toLocaleLowerCase("ja").replace(/\s+/gu, " ").trim();

const englishNames: Record<string, string> = {
  technology: "IT & Digital",
  "technology/ai": "AI & Generative AI",
  "technology/computing": "Computers & Software",
  "technology/internet-security": "Internet & Security",
  "technology/robotics": "Robotics & Digital Infrastructure",
  knowledge: "Academic Knowledge",
  "knowledge/mathematics": "Mathematics & Computation",
  "knowledge/physical-sciences": "Physics, Chemistry & Space",
  "knowledge/life-sciences": "Life Sciences",
  "knowledge/philosophy-language": "Philosophy, Language & Religion",
  "knowledge/education": "Education & Research",
  society: "Society & Institutions",
  "society/politics-law": "Politics & Law",
  "society/economics-business": "Economics & Business",
  "society/social-issues": "Social Issues & Human Rights",
  history: "History",
  "history/world-history": "World History & Civilizations",
  "history/biography": "People & Biography",
  culture: "Culture & Entertainment",
  "culture/film-tv": "Film, Television & Streaming",
  "culture/music": "Music",
  "culture/literature-comics": "Literature, Comics & Anime",
  "culture/art-fashion": "Art, Design & Fashion",
  life: "Life & Health",
  "life/medicine-health": "Medicine & Health",
  "life/psychology": "Psychology & Mind",
  "life/food": "Food & Cooking",
  nature: "Nature & Environment",
  "nature/animals-plants": "Animals & Plants",
  "nature/earth-environment": "Earth & Environment",
  "nature/climate-energy": "Climate & Energy",
  sports: "Sports",
  "sports/team": "Ball & Team Sports",
  "sports/combat": "Combat Sports & Martial Arts",
  "sports/individual": "Individual Sports & Events",
  "sports/motorsport": "Motorsport",
  games: "Games",
  "games/video-games": "Video Games",
  "games/game-industry": "Game Industry & Esports",
  world: "Regions & World",
  "world/countries-regions": "Countries & Regions",
  "world/cities": "Cities",
  "world/geography-travel": "Geography & Places",
  "maintenance/uncategorized": "Uncategorized",
};

function stateRank(state: string) {
  return state === "established" ? 3 : state === "visible" ? 2 : state === "candidate" ? 1 : 0;
}

function categoryKind(name: string, id: string) {
  if (id.startsWith("maintenance/")) return "maintenance";
  if (/人物|登場人物|character|people|biograph/iu.test(name)) return "character";
  if (/道具|アイテム|武器|item|tool/iu.test(name)) return "item";
  if (/場所|地域|都市|世界|舞台|place|region|cit/iu.test(name)) return "place";
  if (/組織|企業|団体|organization|company/iu.test(name)) return "organization";
  if (/出来事|事件|大会|event/iu.test(name)) return "event";
  if (/作品|シリーズ|漫画|アニメ|映画|ゲーム|work|series/iu.test(name)) return "work";
  return "topic";
}

async function batches(db: D1Database, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 75) {
    await db.batch(statements.slice(index, index + 75));
  }
}

export async function synchronizeHubpediaCategoryRegistry(
  db: D1Database,
  articles: readonly ViewableSeedArticle[],
) {
  const now = new Date().toISOString();
  const index = buildEvolvingCategoryIndex(articles);
  const previousRows = await db.prepare(
    `SELECT id,state,parent_id parentId,article_count articleCount FROM hubpedia_categories`,
  ).all<{ id: string; state: string; parentId: string | null; articleCount: number }>();
  const previous = new Map((previousRows.results ?? []).map((row) => [row.id, row]));
  const [viewRows, searchRows] = await Promise.all([
    db.prepare(
      `SELECT article_slug slug,SUM(view_count) views FROM hubpedia_wiki_article_views
       WHERE view_date>=date('now','-90 day') GROUP BY article_slug`,
    ).all<{ slug: string; views: number }>().catch(() => ({ results: [] })),
    db.prepare(
      `SELECT normalized_query query,count(*) searches FROM hubpedia_search_events
       WHERE created_at>=datetime('now','-90 day') GROUP BY normalized_query`,
    ).all<{ query: string; searches: number }>().catch(() => ({ results: [] })),
  ]);
  const viewsBySlug = new Map((viewRows.results ?? []).map((row) => [row.slug, Number(row.views)]));
  const searchesByQuery = new Map((searchRows.results ?? []).map((row) => [normalize(row.query), Number(row.searches)]));
  const activeIds = new Set<string>();
  const statements: D1PreparedStatement[] = [];
  const audits: D1PreparedStatement[] = [];

  const canonicalDynamic = new Map<string, DynamicCategoryNode>();
  const mergedDynamic = new Map<string, DynamicCategoryNode>();
  const allParentsByName = new Map<string, Set<string>>();
  for (const node of [...index.dynamicNodes].sort((left, right) =>
    right.articleCount - left.articleCount || left.id.localeCompare(right.id))) {
    const key = normalize(node.name);
    const parentsForName = allParentsByName.get(key) ?? new Set<string>();
    if (node.parentId) parentsForName.add(node.parentId);
    allParentsByName.set(key, parentsForName);
    const canonical = canonicalDynamic.get(key);
    if (canonical) mergedDynamic.set(node.id, canonical);
    else canonicalDynamic.set(key, node);
  }
  const demandAdjustedDynamic = [...canonicalDynamic.values()].map((node) => {
    const articleSlugs = [...index.articleCategoryIds.entries()]
      .filter(([, categoryIds]) => categoryIds.includes(node.id))
      .map(([slug]) => slug);
    const views = articleSlugs.reduce((sum, slug) => sum + (viewsBySlug.get(slug) ?? 0), 0);
    const searches = [node.name, ...node.aliases]
      .reduce((sum, name) => sum + (searchesByQuery.get(normalize(name)) ?? 0), 0);
    const state = node.state === "candidate" && (views >= 100 || searches >= 20)
      ? "visible"
      : node.state;
    return { ...node, state, requiresAiReview: state !== "established" };
  });
  const nodes: DynamicCategoryNode[] = [
    ...ENCYCLOPEDIA_CATEGORIES.map((node): DynamicCategoryNode => ({
      ...node,
      parentId: "parentId" in node ? node.parentId : undefined,
      state: "established" as const,
      articleCount: articles.filter((article) =>
        getArticleCategoryIds(article).some((categoryId) =>
          isEncyclopediaCategoryOrDescendant(categoryId, node.id),
        ),
      ).length,
      dynamicDepth: 0,
      aliases: [] as string[],
      requiresAiReview: false,
    })),
    ...demandAdjustedDynamic,
  ];

  for (const node of nodes) {
    activeIds.add(node.id);
    const old = previous.get(node.id);
    const canonicalKey = node.id.includes("/topic-") ? node.id : node.id.startsWith("maintenance/") ? node.id : normalize(node.name);
    statements.push(
      db.prepare(
        `INSERT INTO hubpedia_categories
          (id,parent_id,canonical_key,state,article_count,dynamic_depth,hierarchy_depth,requires_ai_review,
           namespace,category_kind,concept_article_slug,integrity_status,created_at,updated_at,promoted_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET
          parent_id=excluded.parent_id,canonical_key=excluded.canonical_key,state=excluded.state,
          article_count=excluded.article_count,dynamic_depth=excluded.dynamic_depth,
          hierarchy_depth=excluded.hierarchy_depth,
          requires_ai_review=excluded.requires_ai_review,
          namespace=excluded.namespace,category_kind=excluded.category_kind,
          concept_article_slug=excluded.concept_article_slug,
          promoted_at=CASE WHEN hubpedia_categories.state<>excluded.state AND excluded.state IN ('visible','established')
            THEN excluded.updated_at ELSE hubpedia_categories.promoted_at END,
          demoted_at=CASE WHEN hubpedia_categories.state<>excluded.state AND excluded.state='candidate'
            THEN excluded.updated_at ELSE hubpedia_categories.demoted_at END,
          updated_at=excluded.updated_at`,
      ).bind(
        node.id,
        node.parentId ?? null,
        canonicalKey,
        node.state,
        node.articleCount,
        Math.min(node.dynamicDepth, 8),
        node.dynamicDepth,
        node.requiresAiReview ? 1 : 0,
        articles.find((article) => normalize(article.title) === normalize(node.name))
          ? `work:${articles.find((article) => normalize(article.title) === normalize(node.name))!.slug}`
          : "general",
        categoryKind(node.name, node.id),
        articles.find((article) => normalize(article.title) === normalize(node.name))?.slug ?? null,
        node.requiresAiReview ? "review-required" : "valid",
        now,
        now,
        node.state === "visible" || node.state === "established" ? now : null,
      ),
      db.prepare(
        `INSERT INTO hubpedia_category_translations(category_id,locale,name,description,updated_at)
         VALUES(?,'ja',?,?,?)
         ON CONFLICT(category_id,locale) DO UPDATE SET
          name=excluded.name,description=excluded.description,updated_at=excluded.updated_at`,
      ).bind(node.id, node.name, node.description, now),
      db.prepare(
        `INSERT INTO hubpedia_category_translations(category_id,locale,name,description,updated_at)
         VALUES(?,'en',?,?,?)
         ON CONFLICT(category_id,locale) DO UPDATE SET
          name=excluded.name,description=excluded.description,updated_at=excluded.updated_at`,
      ).bind(
        node.id,
        englishNames[node.id] ?? node.aliases.find((alias) => /^[\x20-\x7e]+$/u.test(alias)) ?? node.name,
        node.description,
        now,
      ),
    );
    for (const alias of node.aliases) {
      statements.push(
        db.prepare(
          `INSERT OR IGNORE INTO hubpedia_category_aliases
            (category_id,locale,alias,normalized_alias,created_at) VALUES(?,'und',?,?,?)`,
        ).bind(node.id, alias, normalize(alias), now),
      );
    }
    const action = !old
      ? "created"
      : old.parentId !== (node.parentId ?? null)
        ? "reparented"
        : stateRank(old.state) < stateRank(node.state)
          ? "promoted"
          : stateRank(old.state) > stateRank(node.state)
            ? "demoted"
            : null;
    if (action) {
      audits.push(
        db.prepare(
          `INSERT INTO hubpedia_category_audit_log
            (id,category_id,action,before_json,after_json,reason,actor_type,created_at)
           VALUES(?,?,?,?,?,'Article-catalog category synchronization','system',?)`,
        ).bind(crypto.randomUUID(), node.id, action, old ? JSON.stringify(old) : null, JSON.stringify(node), now),
      );
    }
  }

  for (const [mergedId, canonical] of mergedDynamic) {
    const merged = index.dynamicNodes.find((node) => node.id === mergedId)!;
    activeIds.add(mergedId);
    statements.push(
      db.prepare(
        `INSERT INTO hubpedia_categories
          (id,parent_id,canonical_key,state,article_count,dynamic_depth,hierarchy_depth,requires_ai_review,
           merged_into_id,namespace,category_kind,integrity_status,created_at,updated_at)
         VALUES(?,?,?,'merged',?,?,?,0,?,'general','topic','valid',?,?)
         ON CONFLICT(id) DO UPDATE SET state='merged',merged_into_id=excluded.merged_into_id,
          article_count=excluded.article_count,updated_at=excluded.updated_at`,
      ).bind(
        mergedId,
        merged.parentId ?? null,
        mergedId,
        merged.articleCount,
        Math.min(merged.dynamicDepth, 8),
        merged.dynamicDepth,
        canonical.id,
        now,
        now,
      ),
      db.prepare(
        `INSERT OR IGNORE INTO hubpedia_category_aliases
          (category_id,locale,alias,normalized_alias,created_at) VALUES(?,'und',?,?,?)`,
      ).bind(canonical.id, merged.name, normalize(merged.name), now),
    );
    const old = previous.get(mergedId);
    if (old?.state !== "merged") {
      audits.push(
        db.prepare(
          `INSERT INTO hubpedia_category_audit_log
            (id,category_id,action,before_json,after_json,reason,actor_type,created_at)
           VALUES(?,?,'merged',?,?,'Equivalent normalized category name','system',?)`,
        ).bind(
          crypto.randomUUID(),
          mergedId,
          old ? JSON.stringify(old) : null,
          JSON.stringify({ ...merged, state: "merged", mergedIntoId: canonical.id }),
          now,
        ),
      );
    }
  }

  for (const old of previous.values()) {
    if (activeIds.has(old.id) || ENCYCLOPEDIA_CATEGORIES.some((node) => node.id === old.id)) continue;
    statements.push(
      db.prepare(
        `UPDATE hubpedia_categories SET state='retired',demoted_at=?,updated_at=? WHERE id=? AND state<>'merged'`,
      ).bind(now, now, old.id),
    );
    if (old.state !== "retired" && old.state !== "merged") {
      audits.push(
        db.prepare(
          `INSERT INTO hubpedia_category_audit_log
            (id,category_id,action,before_json,after_json,reason,actor_type,created_at)
           VALUES(?,?,'retired',?,?,'No longer meets the category threshold','system',?)`,
        ).bind(crypto.randomUUID(), old.id, JSON.stringify(old), JSON.stringify({ ...old, state: "retired" }), now),
      );
    }
  }

  await batches(db, [...statements, ...audits]);

  const graphStatements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM hubpedia_category_edges`),
  ];
  const graphEdges: Array<{ parentId: string; childId: string; confidence: number }> = [];
  for (const node of nodes) {
    const parentIds = node.id.includes("/topic-")
      ? [...(allParentsByName.get(normalize(node.name)) ?? new Set(node.parentId ? [node.parentId] : []))]
      : node.parentId ? [node.parentId] : [];
    for (const [position, parentId] of parentIds.entries()) {
      if (parentId === node.id) continue;
      const parent = nodes.find((candidate) => candidate.id === parentId)
        ?? ENCYCLOPEDIA_CATEGORIES.find((candidate) => candidate.id === parentId);
      const semantics = categoryRelationshipSemantics(parent?.name ?? parentId, node.name);
      if (!semantics.valid) continue;
      graphEdges.push({ parentId, childId: node.id, confidence: semantics.confidence });
      graphStatements.push(
        db.prepare(
          `INSERT INTO hubpedia_category_edges
            (parent_id,child_id,relation_type,is_primary,confidence,reason,evidence_reference,created_at,updated_at)
           VALUES(?,?,'subclass',?,?,?,NULL,?,?)`,
        ).bind(parentId, node.id, position === 0 ? 1 : 0, semantics.confidence, semantics.reason, now, now),
      );
    }
  }
  await batches(db, graphStatements);

  const memberships: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM hubpedia_article_categories`),
  ];
  for (const article of articles) {
    const categoryIds = [...new Set(
      (index.articleCategoryIds.get(article.slug) ?? getArticleCategoryIds(article))
        .map((categoryId) => mergedDynamic.get(categoryId)?.id ?? categoryId),
    )];
    categoryIds.forEach((categoryId, position) => memberships.push(
      db.prepare(
        `INSERT INTO hubpedia_article_categories
          (article_slug,category_id,role,confidence,assignment_source,assigned_at,updated_at,
           assignment_reason,evidence_reference,scope_json)
         VALUES(?,?,?,?,?,?,?,?,?,?)`,
      ).bind(
        article.slug,
        categoryId,
        position === 0 ? "primary" : "secondary",
        position === 0 ? 1 : 0.8,
        categoryId.includes("/topic-") ? "tag-promotion" : "rule",
        now,
        now,
        categoryId.includes("/topic-")
          ? "記事本文の共有タグがカテゴリ昇格基準を満たしました。"
          : "記事の定義的特徴が分類規則に一致しました。",
        article.sources[0]?.url ?? null,
        JSON.stringify({ articleType: article.topicType, collection: article.collection }),
      ),
    ));
  }
  await batches(db, memberships);
  const findings = detectCategoryGraphProblems(
    nodes.map((node) => ({ id: node.id, articleCount: node.articleCount, state: node.state })),
    graphEdges,
  );
  const findingStatements: D1PreparedStatement[] = [
    db.prepare(`UPDATE hubpedia_category_integrity_findings SET status='resolved',resolved_at=? WHERE status='open'`).bind(now),
    ...findings.map((finding) => db.prepare(
      `INSERT INTO hubpedia_category_integrity_findings
        (id,category_id,finding_type,severity,detail,status,detected_at)
       VALUES(?,?,?,?,?,'open',?)`,
    ).bind(crypto.randomUUID(), finding.categoryId, finding.type, finding.severity, finding.detail, now)),
  ];
  await batches(db, findingStatements);
  await db.prepare(
    `UPDATE hubpedia_category_refresh_queue SET status='completed',completed_at=?
     WHERE status IN ('pending','running')`,
  ).bind(now).run();
  return {
    categories: nodes.length,
    visible: index.dynamicNodes.filter((node) => node.state !== "candidate").length,
    memberships: [...index.articleCategoryIds.values()].reduce((sum, ids) => sum + ids.length, 0),
    auditEvents: audits.length,
    parentEdges: graphEdges.length,
    integrityFindings: findings.length,
  };
}

export async function loadHubpediaCategoryIndex(
  db: D1Database,
  articles: readonly ViewableSeedArticle[],
): Promise<EvolvingCategoryIndex> {
  try {
    const rows = await db.prepare(
      `SELECT c.id,c.parent_id parentId,c.state,c.article_count articleCount,
        c.hierarchy_depth dynamicDepth,c.requires_ai_review requiresAiReview,
        COALESCE(t.name,c.canonical_key) name,COALESCE(t.description,'') description,
        group_concat(DISTINCT al.alias) aliases
       FROM hubpedia_categories c
       LEFT JOIN hubpedia_category_translations t ON t.category_id=c.id AND t.locale='ja'
       LEFT JOIN hubpedia_category_aliases al ON al.category_id=c.id
       WHERE c.dynamic_depth>0 AND c.state IN ('candidate','visible','established')
       GROUP BY c.id`,
    ).all<StoredCategory>();
    if (!(rows.results ?? []).length) return buildEvolvingCategoryIndex(articles);
    const memberships = await db.prepare(
      `SELECT article_slug slug,category_id categoryId FROM hubpedia_article_categories`,
    ).all<{ slug: string; categoryId: string }>();
    const edges = await db.prepare(
      `SELECT parent_id parentId,child_id childId FROM hubpedia_category_edges`,
    ).all<{ parentId: string; childId: string }>();
    const parentsByChild = new Map<string, string[]>();
    for (const edge of edges.results ?? []) {
      parentsByChild.set(edge.childId, [...(parentsByChild.get(edge.childId) ?? []), edge.parentId]);
    }
    const articleCategoryIds = new Map<string, string[]>();
    for (const row of memberships.results ?? []) {
      articleCategoryIds.set(row.slug, [...(articleCategoryIds.get(row.slug) ?? []), row.categoryId]);
    }
    return {
      dynamicNodes: (rows.results ?? []).map((row) => ({
        id: row.id,
        parentId: row.parentId ?? undefined,
        state: row.state as DynamicCategoryNode["state"],
        articleCount: Number(row.articleCount),
        dynamicDepth: Number(row.dynamicDepth),
        requiresAiReview: Boolean(row.requiresAiReview),
        name: row.name,
        description: row.description,
        aliases: row.aliases?.split(",").filter(Boolean) ?? [],
        parentIds: parentsByChild.get(row.id) ?? (row.parentId ? [row.parentId] : []),
      })),
      articleCategoryIds,
    };
  } catch {
    return buildEvolvingCategoryIndex(articles);
  }
}

export async function resolveHubpediaCategoryAlias(db: D1Database, value: string) {
  const normalized = normalize(value);
  const row = await db.prepare(
    `SELECT c.id,c.merged_into_id mergedIntoId
     FROM hubpedia_categories c
     LEFT JOIN hubpedia_category_aliases a ON a.category_id=c.id
     WHERE c.id=? OR a.normalized_alias=?
     ORDER BY CASE WHEN c.id=? THEN 0 ELSE 1 END LIMIT 1`,
  ).bind(value, normalized, value).first<{ id: string; mergedIntoId: string | null }>();
  return row?.mergedIntoId ?? row?.id ?? null;
}

export async function listHubpediaCategories(
  db: D1Database,
  locale = "ja",
  order: "name" | "popular" | "updated" | "articles" = "articles",
) {
  const safeLocale = /^[a-z]{2,3}(?:-[A-Z]{2})?$/u.test(locale) ? locale : "ja";
  const orderBy = order === "name"
    ? "name COLLATE NOCASE"
    : order === "popular"
      ? "views DESC, c.article_count DESC, name"
      : order === "updated"
        ? "c.updated_at DESC, name"
        : "c.article_count DESC, name";
  const rows = await db.prepare(
    `SELECT c.id,c.parent_id parentId,c.state,c.article_count articleCount,
      c.hierarchy_depth dynamicDepth,c.merged_into_id mergedIntoId,
      c.namespace,c.category_kind categoryKind,c.concept_article_slug conceptArticleSlug,
      c.integrity_status integrityStatus,c.updated_at updatedAt,
      COALESCE(requested.name,fallback.name,c.canonical_key) name,
      COALESCE(requested.description,fallback.description,'') description,
      CASE WHEN requested.name IS NULL THEN 1 ELSE 0 END untranslated,
      COALESCE((SELECT SUM(v.view_count) FROM hubpedia_article_categories ac
        JOIN hubpedia_wiki_article_views v ON v.article_slug=ac.article_slug
        WHERE ac.category_id=c.id AND v.view_date>=date('now','-90 day')),0) views,
      (SELECT count(*) FROM hubpedia_category_integrity_findings f
        WHERE f.category_id=c.id AND f.status='open') openFindings,
      (SELECT count(*) FROM hubpedia_article_categories ac
        JOIN hubpedia_article_knowledge_state ks ON ks.article_slug=ac.article_slug
        WHERE ac.category_id=c.id AND ks.knowledge_status IN ('unverified','provisional','disputed')) knowledgeReviewCount
     FROM hubpedia_categories c
     LEFT JOIN hubpedia_category_translations requested
       ON requested.category_id=c.id AND requested.locale=?
     LEFT JOIN hubpedia_category_translations fallback
       ON fallback.category_id=c.id AND fallback.locale='ja'
     WHERE c.state IN ('visible','established')
     ORDER BY ${orderBy}`,
  ).bind(safeLocale).all<{
    id: string;
    parentId: string | null;
    state: string;
    articleCount: number;
    dynamicDepth: number;
    mergedIntoId: string | null;
    name: string;
    description: string;
    namespace: string;
    categoryKind: string;
    conceptArticleSlug: string | null;
    integrityStatus: string;
    updatedAt: string;
    untranslated: number;
    views: number;
    openFindings: number;
    knowledgeReviewCount: number;
  }>();
  return rows.results ?? [];
}

export async function compareHubpediaCategories(db: D1Database, leftId: string, rightId: string, locale = "ja") {
  const [categories, memberships] = await Promise.all([
    listHubpediaCategories(db, locale, "articles"),
    db.prepare(
      `SELECT category_id categoryId,article_slug slug,role,assignment_reason reason
       FROM hubpedia_article_categories WHERE category_id IN (?,?)`,
    ).bind(leftId, rightId).all<{ categoryId: string; slug: string; role: string; reason: string }>(),
  ]);
  const left = categories.find((category) => category.id === leftId);
  const right = categories.find((category) => category.id === rightId);
  if (!left || !right) return null;
  const leftSlugs = new Set((memberships.results ?? []).filter((row) => row.categoryId === leftId).map((row) => row.slug));
  const rightSlugs = new Set((memberships.results ?? []).filter((row) => row.categoryId === rightId).map((row) => row.slug));
  return {
    left,
    right,
    sharedArticles: [...leftSlugs].filter((slug) => rightSlugs.has(slug)),
    onlyLeft: [...leftSlugs].filter((slug) => !rightSlugs.has(slug)),
    onlyRight: [...rightSlugs].filter((slug) => !leftSlugs.has(slug)),
    relationship: left.parentId === right.id ? "left-is-child" : right.parentId === left.id ? "right-is-child" : "related-categories",
  };
}

export async function enqueueHubpediaCategoryRefresh(db: D1Database, categoryId: string, reason: string, priority = 50) {
  const exists = await db.prepare(`SELECT id FROM hubpedia_categories WHERE id=?`).bind(categoryId).first();
  if (!exists) return null;
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO hubpedia_category_refresh_queue(id,category_id,reason,status,priority,requested_at)
     VALUES(?,?,?,'pending',?,?)`,
  ).bind(id, categoryId, reason.slice(0, 500), Math.max(0, Math.min(100, priority)), new Date().toISOString()).run();
  return { id, categoryId, status: "pending" as const };
}
