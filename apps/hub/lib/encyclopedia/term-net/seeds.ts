import type { D1Database } from "@cloudflare/workers-types";

import type { NetSeed } from "./snapshot";
import { isQid, type WikidataClient } from "./wikidata-client";

/*
 * Seeds (docs/hubpedia-ledger.md section 11, "範囲"): topics, seed-article slugs, unresolved internal-link targets
 * and screened/queued submissions. Matching a seed to a QID never guesses: an `external_ids.wikidata` wins, an exact
 * headword/alias match with exactly one QID is used, and anything else goes to the unmatched list for a person.
 */

export type SeedKind = "topic" | "seed-article" | "unresolved-link" | "submission";
export type SeedInput = {
  slug: string;
  labelJa?: string | null;
  labelEn?: string | null;
  kind: SeedKind;
  /** From encyclopedia_topics.external_ids. */
  wikidata?: string | null;
};

const KIND_ORDER: SeedKind[] = ["topic", "seed-article", "submission", "unresolved-link"];

/** One entry per slug; a richer kind and any label already known are kept. */
export function mergeSeedInputs(inputs: readonly SeedInput[]): SeedInput[] {
  const bySlug = new Map<string, SeedInput>();
  for (const input of inputs) {
    const slug = input.slug.trim();
    if (!slug || slug.startsWith("_")) continue;
    const current = bySlug.get(slug);
    if (!current) { bySlug.set(slug, { ...input, slug }); continue; }
    bySlug.set(slug, {
      slug,
      kind: KIND_ORDER.indexOf(input.kind) < KIND_ORDER.indexOf(current.kind) ? input.kind : current.kind,
      labelJa: current.labelJa ?? input.labelJa ?? null,
      labelEn: current.labelEn ?? input.labelEn ?? null,
      wikidata: current.wikidata ?? input.wikidata ?? null,
    });
  }
  return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** English headword guessed from a slug, only to ask Wikidata; it is never stored as a label. */
export const labelFromSlug = (slug: string) => slug.replace(/-/gu, " ");

export type UnmatchedSeed = { slug: string; reason: "no-match" | "ambiguous"; candidates: string[] };
export type ResolvedSeeds = { matched: NetSeed[]; unmatched: UnmatchedSeed[] };

const normalizeLabel = (text: string) => text.normalize("NFKC").trim().toLocaleLowerCase("ja").replace(/\s+/gu, " ");

export async function resolveSeeds(inputs: readonly SeedInput[], client: Pick<WikidataClient, "search">): Promise<ResolvedSeeds> {
  const matched: NetSeed[] = [];
  const unmatched: UnmatchedSeed[] = [];
  for (const input of inputs) {
    if (input.wikidata && isQid(input.wikidata)) {
      matched.push({ slug: input.slug, qid: input.wikidata, labelJa: input.labelJa ?? null, labelEn: input.labelEn ?? null, kind: input.kind });
      continue;
    }
    const queries: Array<[string, "ja" | "en"]> = [];
    if (input.labelJa) queries.push([input.labelJa, "ja"]);
    const english = input.labelEn ?? (input.kind === "unresolved-link" || !input.labelJa ? labelFromSlug(input.slug) : null);
    if (english) queries.push([english, "en"]);
    const found = new Set<string>();
    for (const [label, language] of queries) {
      const wanted = normalizeLabel(label);
      for (const hit of await client.search(label, language)) {
        /* Exact headword or alias only: the match text Wikidata reports must equal the label we asked with. */
        if (normalizeLabel(hit.matchText || hit.label) === wanted) found.add(hit.qid);
      }
    }
    if (found.size === 1) {
      matched.push({ slug: input.slug, qid: [...found][0], labelJa: input.labelJa ?? null, labelEn: input.labelEn ?? english ?? null, kind: input.kind });
    } else {
      unmatched.push({ slug: input.slug, reason: found.size === 0 ? "no-match" : "ambiguous", candidates: [...found].sort() });
    }
  }
  return { matched, unmatched };
}

/** Topics and screened/queued submissions, by SELECT only. Writes nothing. */
export async function readSeedInputsFromDb(db: D1Database): Promise<SeedInput[]> {
  const out: SeedInput[] = [];
  const topics = await db.prepare(
    `SELECT slug, canonical_name AS name, external_ids AS externalIds FROM encyclopedia_topics
      WHERE topic_type <> 'ledger-pool' AND status <> 'archived' AND slug NOT LIKE '\\_%' ESCAPE '\\'`,
  ).all<{ slug: string; name: string; externalIds: string }>();
  for (const row of topics.results ?? []) {
    let wikidata: string | null = null;
    try { const parsed = JSON.parse(row.externalIds) as { wikidata?: unknown }; if (typeof parsed.wikidata === "string") wikidata = parsed.wikidata; } catch { /* ignore */ }
    const cjk = /[぀-ヿ㐀-鿿]/u.test(row.name);
    out.push({ slug: row.slug, kind: "topic", wikidata, labelJa: cjk ? row.name : null, labelEn: cjk ? null : row.name });
  }
  const submissions = await db.prepare(`SELECT slug, title FROM hubpedia_topic_submissions WHERE status IN ('screened','queued')`).all<{ slug: string; title: string }>();
  for (const row of submissions.results ?? []) {
    const cjk = /[぀-ヿ㐀-鿿]/u.test(row.title);
    out.push({ slug: row.slug, kind: "submission", labelJa: cjk ? row.title : null, labelEn: cjk ? null : row.title });
  }
  return out;
}
