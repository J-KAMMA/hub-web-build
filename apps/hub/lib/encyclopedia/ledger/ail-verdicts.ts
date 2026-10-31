/*
 * The reviewer's verdicts of an AIL "hubpedia" job (agents/pipe/hubpedia/<job>.txt). The review prompt asks for one line per
 * article ("article Q123: OK | FIX (reason) | DROP (reason)") and a last line "VERDICT: ACCEPT|FIX|REJECT"; pipe.ps1 appends
 * "FINAL VERDICT: ...". The log holds every round, so the LAST line of an article is its final verdict.
 *
 * Import policy (owner, 2026-10-30): OK is stored as an AI draft; FIX is stored flagged needs_review (shown as 要確認, never
 * auto-approved); DROP and a REJECT job are not stored.
 */

export type ArticleVerdict = "OK" | "FIX" | "DROP";
export type JobVerdict = "ACCEPT" | "FIX" | "REJECT";

export type ReviewVerdicts = { job: JobVerdict | null; articles: Map<string, ArticleVerdict> };

export function parseReviewLog(log: string): ReviewVerdicts {
  const articles = new Map<string, ArticleVerdict>();
  for (const match of log.matchAll(/^\s*(?:[-*]\s*)?article\s+(Q\d+)\s*[:：]\s*(OK|FIX|DROP)\b/gimu)) {
    articles.set(match[1].toUpperCase(), match[2].toUpperCase() as ArticleVerdict);
  }
  const final = /FINAL VERDICT:\s*(ACCEPT|FIX|REJECT)/u.exec(log)?.[1] as JobVerdict | undefined;
  return { job: final ?? null, articles };
}

export type ImportDecision = { action: "store"; needsReview: boolean; verdict: string } | { action: "skip"; verdict: string };

/** What to do with one article. No log or no verdict for the article: the job verdict decides; an unreviewed article is flagged, never trusted. */
export function decideImport(verdicts: ReviewVerdicts | null, qid: string): ImportDecision {
  if (!verdicts) return { action: "store", needsReview: false, verdict: "none" };
  if (verdicts.job === "REJECT") return { action: "skip", verdict: "job REJECT" };
  const own = verdicts.articles.get(qid);
  if (own === "DROP") return { action: "skip", verdict: "DROP" };
  if (own === "FIX") return { action: "store", needsReview: true, verdict: "FIX" };
  if (own === "OK") return { action: "store", needsReview: false, verdict: "OK" };
  if (verdicts.job === "FIX") return { action: "store", needsReview: true, verdict: "job FIX" };
  return { action: "store", needsReview: false, verdict: verdicts.job ?? "none" };
}
