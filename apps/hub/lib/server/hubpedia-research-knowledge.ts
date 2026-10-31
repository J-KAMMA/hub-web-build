import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

export type HubpediaKnowledgeStatus =
  | "established"
  | "partially-unresolved"
  | "provisional"
  | "disputed"
  | "unverified"
  | "refuted";

export type HubpediaResearchWork = {
  id: string;
  workType: string;
  title: string;
  abstract: string | null;
  researchQuestion: string | null;
  methods: string | null;
  results: string | null;
  novelty: string | null;
  limitations: string | null;
  canonicalUrl: string;
  doi: string | null;
  arxivId: string | null;
  authors: string[];
  publisher: string | null;
  publishedAt: string | null;
  peerReviewState: string;
  evidenceType: string;
  licenseName: string | null;
  role: string;
  importance: number;
  note: string | null;
};

export type HubpediaKnowledgeClaim = {
  id: string;
  statement: string;
  status: string;
  knowledgeStatus: string;
  evidenceType: string | null;
  scope: string | null;
  reproducibility: string;
  confidence: number | null;
  lastCheckedAt: string | null;
  evidenceCount: number;
  supportingEvidence: number;
  opposingEvidence: number;
};

export type HubpediaArticleKnowledge = {
  articleType: string;
  knowledgeStatus: HubpediaKnowledgeStatus;
  reproducibility: string;
  lastSynthesizedAt: string | null;
  aiGeneratedRatio: number;
  humanReviewScope: string | null;
  sourceCount: number;
  primarySourceCount: number;
  peerReviewedCount: number;
  opposingSourceCount: number;
  encyclopediaBenchmark: {
    status: "not-compared" | "needs-work" | "meets-baseline" | "adds-value";
    comparedProviders: string[];
    coverageRatio: number;
    missingConceptCount: number;
    checkedAt: string | null;
  };
  claims: HubpediaKnowledgeClaim[];
  works: HubpediaResearchWork[];
};

export function emptyHubpediaArticleKnowledge(articleType = "general"): HubpediaArticleKnowledge {
  return {
    articleType,
    knowledgeStatus: "unverified",
    reproducibility: "unknown",
    lastSynthesizedAt: null,
    aiGeneratedRatio: 1,
    humanReviewScope: null,
    sourceCount: 0,
    primarySourceCount: 0,
    peerReviewedCount: 0,
    opposingSourceCount: 0,
    encyclopediaBenchmark: { status: "not-compared", comparedProviders: [], coverageRatio: 0, missingConceptCount: 0, checkedAt: null },
    claims: [],
    works: [],
  };
}

export function hubpediaArticleType(topicType: string | null | undefined) {
  const value = (topicType ?? "").toLocaleLowerCase("en");
  if (value.includes("paper") || value.includes("preprint")) return "paper";
  if (value.includes("person") || value.includes("biograph")) return "person";
  if (value.includes("technolog") || value.includes("software") || value.includes("protocol")) return "technology";
  if (value.includes("event") || value.includes("incident") || value.includes("revolution")) return "event";
  if (value.includes("animal") || value.includes("organism") || value.includes("species")) return "organism";
  if (value.includes("place") || value.includes("region") || value.includes("museum")) return "place";
  if (value.includes("culture") || value.includes("food") || value.includes("work")) return "culture";
  if (value.includes("concept") || value.includes("science") || value.includes("idea") || value.includes("ideology")) return "concept";
  return "general";
}

function parseStringArray(value: unknown) {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export async function getHubpediaArticleKnowledge(db: D1Database, slug: string): Promise<HubpediaArticleKnowledge> {
  const [state, sourceStats, claimRows, workRows] = await Promise.all([
    db.prepare(`SELECT article_type articleType,knowledge_status knowledgeStatus,reproducibility,
      last_synthesized_at lastSynthesizedAt,ai_generated_ratio aiGeneratedRatio,
      human_review_scope humanReviewScope
      FROM hubpedia_article_knowledge_state WHERE article_slug=?`).bind(slug).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) sourceCount,
      SUM(CASE WHEN s.source_type IN ('peer-reviewed-paper','paper','preprint','dataset','public-record') THEN 1 ELSE 0 END) primarySourceCount,
      SUM(CASE WHEN s.source_type='peer-reviewed-paper' OR json_extract(s.metadata,'$.peerReviewState')='peer-reviewed' THEN 1 ELSE 0 END) peerReviewedCount
      FROM encyclopedia_sources s JOIN encyclopedia_articles a ON a.topic_id=s.topic_id
      WHERE a.slug=? AND a.status='published' AND s.is_active=1`).bind(slug).first<Record<string, unknown>>(),
    db.prepare(`SELECT c.id,c.statement,c.status,
      COALESCE(ks.knowledge_status,CASE c.status WHEN 'verified' THEN 'strong-evidence' WHEN 'refuted' THEN 'refuted' ELSE 'unverified' END) knowledgeStatus,
      ks.evidence_type evidenceType,ks.scope,COALESCE(ks.reproducibility,'unknown') reproducibility,
      COALESCE(ks.confidence,c.confidence) confidence,ks.last_checked_at lastCheckedAt,
      COUNT(ce.chunk_id) evidenceCount,
      SUM(CASE WHEN ce.stance='supports' THEN 1 ELSE 0 END) supportingEvidence,
      SUM(CASE WHEN ce.stance IN ('opposes','contradicts','refutes') THEN 1 ELSE 0 END) opposingEvidence
      FROM encyclopedia_articles a
      JOIN encyclopedia_revision_claims rc ON rc.revision_id=a.current_revision_id
      JOIN encyclopedia_claims c ON c.id=rc.claim_id
      LEFT JOIN hubpedia_claim_knowledge_state ks ON ks.claim_id=c.id
      LEFT JOIN encyclopedia_claim_evidence ce ON ce.claim_id=c.id
      WHERE a.slug=? AND a.status='published'
      GROUP BY c.id ORDER BY rc.citation_index LIMIT 200`).bind(slug).all<Record<string, unknown>>(),
    db.prepare(`SELECT w.id,w.work_type workType,w.title,w.abstract,w.research_question researchQuestion,
      w.methods,w.results,w.novelty,w.limitations,w.canonical_url canonicalUrl,
      w.doi,w.arxiv_id arxivId,w.authors_json authorsJson,w.publisher,w.published_at publishedAt,
      w.peer_review_state peerReviewState,w.evidence_type evidenceType,w.license_name licenseName,
      ar.role,ar.importance,ar.note
      FROM hubpedia_article_research_works ar
      JOIN hubpedia_research_works w ON w.id=ar.work_id
      WHERE ar.article_slug=? ORDER BY ar.importance DESC,w.published_at DESC LIMIT 100`).bind(slug).all<Record<string, unknown>>(),
  ]);

  const works = (workRows.results ?? []).map((row) => ({
    id: String(row.id),
    workType: String(row.workType),
    title: String(row.title),
    abstract: typeof row.abstract === "string" ? row.abstract : null,
    researchQuestion: typeof row.researchQuestion === "string" ? row.researchQuestion : null,
    methods: typeof row.methods === "string" ? row.methods : null,
    results: typeof row.results === "string" ? row.results : null,
    novelty: typeof row.novelty === "string" ? row.novelty : null,
    limitations: typeof row.limitations === "string" ? row.limitations : null,
    canonicalUrl: String(row.canonicalUrl),
    doi: typeof row.doi === "string" ? row.doi : null,
    arxivId: typeof row.arxivId === "string" ? row.arxivId : null,
    authors: parseStringArray(row.authorsJson),
    publisher: typeof row.publisher === "string" ? row.publisher : null,
    publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
    peerReviewState: String(row.peerReviewState),
    evidenceType: String(row.evidenceType),
    licenseName: typeof row.licenseName === "string" ? row.licenseName : null,
    role: String(row.role),
    importance: Number(row.importance),
    note: typeof row.note === "string" ? row.note : null,
  }));
  const claims = (claimRows.results ?? []).map((row) => ({
    id: String(row.id),
    statement: String(row.statement),
    status: String(row.status),
    knowledgeStatus: String(row.knowledgeStatus),
    evidenceType: typeof row.evidenceType === "string" ? row.evidenceType : null,
    scope: typeof row.scope === "string" ? row.scope : null,
    reproducibility: String(row.reproducibility),
    confidence: row.confidence == null ? null : Number(row.confidence),
    lastCheckedAt: typeof row.lastCheckedAt === "string" ? row.lastCheckedAt : null,
    evidenceCount: Number(row.evidenceCount ?? 0),
    supportingEvidence: Number(row.supportingEvidence ?? 0),
    opposingEvidence: Number(row.opposingEvidence ?? 0),
  }));
  let encyclopediaBenchmark = emptyHubpediaArticleKnowledge().encyclopediaBenchmark;
  try {
    const rows = await db.prepare(`SELECT provider,status,coverage_ratio coverageRatio,
      missing_concepts_json missingConceptsJson,checked_at checkedAt
      FROM hubpedia_encyclopedia_benchmarks WHERE article_slug=? ORDER BY checked_at DESC`).bind(slug).all<Record<string, unknown>>();
    const benchmarks = rows.results ?? [];
    if (benchmarks.length) {
      const statuses = benchmarks.map((row) => String(row.status));
      const missingConcepts = new Set(benchmarks.flatMap((row) => parseStringArray(row.missingConceptsJson)));
      encyclopediaBenchmark = {
        status: statuses.includes("needs-work") ? "needs-work" : statuses.includes("adds-value") ? "adds-value" : "meets-baseline",
        comparedProviders: benchmarks.map((row) => String(row.provider)),
        coverageRatio: Math.min(...benchmarks.map((row) => Number(row.coverageRatio ?? 0))),
        missingConceptCount: missingConcepts.size,
        checkedAt: typeof benchmarks[0]?.checkedAt === "string" ? benchmarks[0].checkedAt : null,
      };
    }
  } catch {
    // Comparison data is optional while the benchmark migration rolls out.
  }

  return {
    articleType: typeof state?.articleType === "string" ? state.articleType : "general",
    knowledgeStatus: (typeof state?.knowledgeStatus === "string" ? state.knowledgeStatus : "unverified") as HubpediaKnowledgeStatus,
    reproducibility: typeof state?.reproducibility === "string" ? state.reproducibility : "unknown",
    lastSynthesizedAt: typeof state?.lastSynthesizedAt === "string" ? state.lastSynthesizedAt : null,
    aiGeneratedRatio: state?.aiGeneratedRatio == null ? 1 : Number(state.aiGeneratedRatio),
    humanReviewScope: typeof state?.humanReviewScope === "string" ? state.humanReviewScope : null,
    sourceCount: Number(sourceStats?.sourceCount ?? 0),
    primarySourceCount: Number(sourceStats?.primarySourceCount ?? 0),
    peerReviewedCount: Number(sourceStats?.peerReviewedCount ?? 0),
    opposingSourceCount: works.filter((work) => work.role === "opposes").length,
    encyclopediaBenchmark,
    claims,
    works,
  };
}

export async function getHubpediaResearchWork(db: D1Database, id: string) {
  const row = await db.prepare(`SELECT id,work_type workType,title,abstract,research_question researchQuestion,
    methods,results,novelty,limitations,canonical_url canonicalUrl,doi,arxiv_id arxivId,
    authors_json authorsJson,publisher,published_at publishedAt,peer_review_state peerReviewState,
    evidence_type evidenceType,license_name licenseName,license_url licenseUrl,updated_at updatedAt
    FROM hubpedia_research_works WHERE id=?`).bind(id).first<Record<string, unknown>>();
  if (!row) return null;
  const articles = await db.prepare(`SELECT ar.article_slug slug,ar.role,ar.importance,ar.note,
    COALESCE(r.title,a.title) title
    FROM hubpedia_article_research_works ar
    LEFT JOIN encyclopedia_articles a ON a.slug=ar.article_slug
    LEFT JOIN encyclopedia_article_revisions r ON r.id=a.current_revision_id
    WHERE ar.work_id=? ORDER BY ar.importance DESC`).bind(id).all<Record<string, unknown>>();
  return {
    id: String(row.id),
    workType: String(row.workType),
    title: String(row.title),
    abstract: typeof row.abstract === "string" ? row.abstract : null,
    researchQuestion: typeof row.researchQuestion === "string" ? row.researchQuestion : null,
    methods: typeof row.methods === "string" ? row.methods : null,
    results: typeof row.results === "string" ? row.results : null,
    novelty: typeof row.novelty === "string" ? row.novelty : null,
    limitations: typeof row.limitations === "string" ? row.limitations : null,
    canonicalUrl: String(row.canonicalUrl),
    doi: typeof row.doi === "string" ? row.doi : null,
    arxivId: typeof row.arxivId === "string" ? row.arxivId : null,
    authors: parseStringArray(row.authorsJson),
    publisher: typeof row.publisher === "string" ? row.publisher : null,
    publishedAt: typeof row.publishedAt === "string" ? row.publishedAt : null,
    peerReviewState: String(row.peerReviewState),
    evidenceType: String(row.evidenceType),
    licenseName: typeof row.licenseName === "string" ? row.licenseName : null,
    licenseUrl: typeof row.licenseUrl === "string" ? row.licenseUrl : null,
    updatedAt: String(row.updatedAt),
    articles: articles.results ?? [],
  };
}
