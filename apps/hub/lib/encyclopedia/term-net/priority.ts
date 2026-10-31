import { PRIORITY_WEIGHTS, TERM_NET_RULES, qidNumber, type EdgeRecord, type TermRecord } from "./config";

/*
 * Priority (docs/hubpedia-ledger.md section 11, "優先度"). Computed on the snapshot file, never in D1.
 * centrality: PageRank on the undirected net (damping 0.85, 30 rounds, related edges weigh 0.5, the rest 1).
 * demand: unresolved-link referrers + screened/queued submissions + neighbours that already have an article.
 * rank: percentile blend, descending; ties go to the lower QID number.
 */

export function pagerank(
  qids: readonly string[],
  edges: readonly Pick<EdgeRecord, "from" | "to" | "relation">[],
  options: { damping?: number; iterations?: number; relatedWeight?: number } = {},
): Map<string, number> {
  const damping = options.damping ?? TERM_NET_RULES.pagerankDamping;
  const iterations = options.iterations ?? TERM_NET_RULES.pagerankIterations;
  const relatedWeight = options.relatedWeight ?? TERM_NET_RULES.relatedWeight;
  const nodes = [...qids].sort((a, b) => qidNumber(a) - qidNumber(b));
  const index = new Map(nodes.map((qid, i) => [qid, i]));
  const n = nodes.length;
  if (n === 0) return new Map();
  const neighbours: Array<Array<[number, number]>> = nodes.map(() => []);
  const strength = new Array<number>(n).fill(0);
  for (const edge of edges) {
    const a = index.get(edge.from);
    const b = index.get(edge.to);
    if (a === undefined || b === undefined || a === b) continue;
    const weight = edge.relation === "related" ? relatedWeight : 1;
    neighbours[a].push([b, weight]);
    neighbours[b].push([a, weight]);
    strength[a] += weight;
    strength[b] += weight;
  }
  let rank = new Array<number>(n).fill(1 / n);
  for (let round = 0; round < iterations; round += 1) {
    const next = new Array<number>(n).fill(0);
    let dangling = 0;
    for (let i = 0; i < n; i += 1) {
      if (strength[i] === 0) { dangling += rank[i]; continue; }
      for (const [j, weight] of neighbours[i]) next[j] += (rank[i] * weight) / strength[i];
    }
    for (let i = 0; i < n; i += 1) next[i] = (1 - damping) / n + damping * (next[i] + dangling / n);
    rank = next;
  }
  return new Map(nodes.map((qid, i) => [qid, rank[i]]));
}

/** Share of values below this one plus half the ties, in [0, 1). */
export function percentiles(values: ReadonlyMap<string, number>): Map<string, number> {
  const sorted = [...values.values()].sort((a, b) => a - b);
  const n = sorted.length;
  const lower = (x: number) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] < x) lo = mid + 1; else hi = mid; } return lo; };
  const upper = (x: number) => { let lo = 0, hi = n; while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= x) lo = mid + 1; else hi = mid; } return lo; };
  const out = new Map<string, number>();
  for (const [key, value] of values) out.set(key, (lower(value) + (upper(value) - lower(value)) / 2) / n);
  return out;
}

export type DemandInputs = {
  /** Count of articles referring to the term as an unresolved link, by slug. */
  unresolvedReferrers?: ReadonlyMap<string, number>;
  /** Screened and queued topic submissions, by slug. */
  submissions?: ReadonlyMap<string, number>;
  /** Slugs that already have an article. */
  articleSlugs?: ReadonlySet<string>;
};

export type TermPriority = { qid: string; centrality: number; demand: number; score: number; rank: number };

export function computePriorities(
  terms: readonly Pick<TermRecord, "qid" | "slug" | "sitelinks">[],
  edges: readonly Pick<EdgeRecord, "from" | "to" | "relation">[],
  demand: DemandInputs = {},
  weights: { centrality: number; demand: number; sitelinks: number } = PRIORITY_WEIGHTS,
): Map<string, TermPriority> {
  const slugOf = new Map(terms.map((t) => [t.qid, t.slug]));
  const centrality = pagerank(terms.map((t) => t.qid), edges);
  const neighbourArticles = new Map<string, number>(terms.map((t) => [t.qid, 0]));
  if (demand.articleSlugs?.size) {
    const seen = new Set<string>();
    for (const edge of edges) {
      for (const [a, b] of [[edge.from, edge.to], [edge.to, edge.from]] as const) {
        const key = `${a}|${b}`;
        if (seen.has(key) || !neighbourArticles.has(a)) continue;
        seen.add(key);
        const otherSlug = slugOf.get(b);
        if (otherSlug && demand.articleSlugs.has(otherSlug)) neighbourArticles.set(a, neighbourArticles.get(a)! + 1);
      }
    }
  }
  const demandOf = new Map<string, number>();
  for (const term of terms) {
    demandOf.set(term.qid,
      (demand.unresolvedReferrers?.get(term.slug) ?? 0) + (demand.submissions?.get(term.slug) ?? 0) + (neighbourArticles.get(term.qid) ?? 0));
  }
  const pc = percentiles(centrality);
  const pd = percentiles(demandOf);
  const ps = percentiles(new Map(terms.map((t) => [t.qid, t.sitelinks])));
  const scored = terms.map((t) => ({
    qid: t.qid,
    centrality: centrality.get(t.qid) ?? 0,
    demand: demandOf.get(t.qid) ?? 0,
    score: weights.centrality * (pc.get(t.qid) ?? 0) + weights.demand * (pd.get(t.qid) ?? 0) + weights.sitelinks * (ps.get(t.qid) ?? 0),
  }));
  scored.sort((a, b) => b.score - a.score || qidNumber(a.qid) - qidNumber(b.qid));
  return new Map(scored.map((s, i) => [s.qid, { ...s, rank: i + 1 }]));
}
