import { canonicalHubpediaSlug } from "../article-aliases";
import type { EdgeRecord, TermRecord } from "../term-net/config";
import { isGenericSurface, isShortOneWord } from "../term-net/noise";
import { isProtectedSlug } from "./select";
import { isSensitiveTopicName, SENSITIVE_CLASS_QIDS } from "./topics";

/*
 * Topic selection for the AIL "hubpedia" worker project: which terms of the term-net snapshot are batched into task
 * files, and what the importer knows about a term (sensitive, distant) when it re-applies the gate. Pure functions.
 */

/** A URL-safe slug from an English label (the same rule the importer uses when the term net is not at hand). */
export function slugFromLabel(label: string): string {
  return canonicalHubpediaSlug(label.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 80));
}

export type AilTerm = TermRecord & { sensitive: boolean; distant: boolean };

const UP_RELATIONS = new Set(["subclass_of", "instance_of", "part_of", "facet_of"]);

export function buildTermIndex(terms: readonly TermRecord[], edges: readonly EdgeRecord[]): Map<string, AilTerm> {
  const up = new Map<string, string[]>();
  for (const edge of edges) {
    if (!UP_RELATIONS.has(edge.relation)) continue;
    const list = up.get(edge.from) ?? [];
    list.push(edge.to);
    up.set(edge.from, list);
  }
  const sensitiveClasses = new Set(SENSITIVE_CLASS_QIDS);
  const sensitiveByClass = (qid: string) => {
    const seen = new Set<string>([qid]);
    let level = [qid];
    for (let depth = 0; depth <= 4 && level.length; depth += 1) {
      if (level.some((q) => sensitiveClasses.has(q))) return true;
      const next: string[] = [];
      for (const q of level) for (const to of up.get(q) ?? []) if (!seen.has(to)) { seen.add(to); next.push(to); }
      level = next;
    }
    return false;
  };
  const index = new Map<string, AilTerm>();
  for (const term of terms) {
    index.set(term.qid, {
      ...term,
      sensitive: isSensitiveTopicName(term.labelJa, term.labelEn, term.slug.replace(/-/gu, " ")) || sensitiveByClass(term.qid),
      distant: term.hops >= 2,
    });
  }
  return index;
}

export type AilSelection = { batchSize: number; batches: number; usedQids: ReadonlySet<string>; existingSlugs: ReadonlySet<string> };

/** Terms worth a worker's time: both labels, not generic, not already used or already an article. Net order: near the seeds first, then well-linked. */
export function ailCandidates(index: ReadonlyMap<string, AilTerm>, options: Pick<AilSelection, "usedQids" | "existingSlugs">): AilTerm[] {
  return [...index.values()]
    .filter((term) => term.linkable && term.labelJa && term.labelEn)
    /* A seed whose slug and English label disagree was resolved to the wrong Wikidata item (air-pollution -> Eriocaulaceae): never give it to a worker. */
    .filter((term) => slugFromLabel(term.labelEn!) === canonicalHubpediaSlug(term.slug))
    .filter((term) => !isGenericSurface(term.labelJa!) && !isGenericSurface(term.labelEn!) && !isShortOneWord(term.labelJa, "ja") && !isShortOneWord(term.labelEn, "en"))
    .filter((term) => !options.usedQids.has(term.qid) && !options.existingSlugs.has(canonicalHubpediaSlug(term.slug)) && !isProtectedSlug(term.slug))
    .sort((a, b) => a.hops - b.hops || b.sitelinks - a.sitelinks || Number(a.qid.slice(1)) - Number(b.qid.slice(1)));
}

/** Candidates in batches of exactly batchSize (a short last batch is dropped). */
export function batchTerms(candidates: readonly AilTerm[], batchSize: number, count: number): AilTerm[][] {
  const batches: AilTerm[][] = [];
  for (let at = 0; at < candidates.length && batches.length < count; at += batchSize) {
    const batch = candidates.slice(at, at + batchSize);
    if (batch.length === batchSize) batches.push(batch);
  }
  return batches;
}

export function selectAilTerms(index: ReadonlyMap<string, AilTerm>, options: AilSelection): AilTerm[][] {
  return batchTerms(ailCandidates(index, options), options.batchSize, options.batches);
}

/** Most notable first: by Wikidata sitelink count (articles in other languages), at least `minSitelinks`; ties by QID. */
export function rankByNotability(candidates: readonly AilTerm[], minSitelinks = 5): AilTerm[] {
  return candidates.filter((term) => term.sitelinks >= minSitelinks)
    .sort((a, b) => b.sitelinks - a.sitelinks || Number(a.qid.slice(1)) - Number(b.qid.slice(1)));
}

/** Per topic: the source files (path from the repository root, and the page url) the worker may quote from. */
export type TaskSources = ReadonlyMap<string, ReadonlyArray<{ path: string; url: string }>>;

const clean = (value: string) => value.replace(/[|\r\n]+/gu, " ").trim();

export function topicLine(term: AilTerm): string {
  const flags = [term.sensitive ? "sensitive" : "", term.distant ? "distant" : ""].filter(Boolean).join(",") || "-";
  const aliases = [...term.aliasesJa.slice(0, 4), ...term.aliasesEn.slice(0, 4)].map(clean).filter(Boolean).join(" / ") || "-";
  return `${term.qid} | ${term.slug} | ${clean(term.labelJa!)} | ${clean(term.labelEn!)} | ${aliases} | ${flags}`;
}

export function taskFile(job: string, batch: readonly AilTerm[], sources?: TaskSources): string {
  const sensitive = batch.filter((term) => term.sensitive).length;
  return [
    `# Hubpedia article batch ${job}`,
    "",
    `Write one article per topic below (${batch.length} topics), following the rules after this task. One file per topic: out/<QID>.json.`,
    "Columns: QID | slug | Japanese label | English label | aliases (Japanese / English) | flags.",
    "Flags: `sensitive` = a medical, health, legal or drug topic (set \"sensitive\": true in its JSON; the full floor is required, no stub); `distant` = far from the core topics (the Hub asks 12 claims instead of 8); `-` = none.",
    "A topic that cannot reach the floor from the allowed publishers is skipped: write no file for it and say why in your report.",
    "",
    "```",
    ...batch.map(topicLine),
    "```",
    "",
    ...(sources ? [
      "**Source files (the only text you may quote).** You have no web access. For each topic the files below hold page text that the Hub already fetched from reviewed publishers. A claim's `source_url` is the url on the first line of the file you quoted from; its `quote` is copied from that file's text.",
      "",
      "```",
      ...batch.map((term) => `${term.qid}: ${(sources.get(term.qid) ?? []).map((source) => `${source.path} (${source.url})`).join("; ") || "(none)"}`),
      "```",
      "",
    ] : []),
    sensitive ? `${sensitive} of these topics are sensitive: state only what the sources state and give no advice.` : "",
    "",
  ].join("\n");
}

export function jobName(date: Date, serial: number): string {
  const stamp = new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, 10).replace(/-/gu, ""); // Japan time
  return `hp-${stamp}-${String(serial).padStart(3, "0")}`;
}

export function queueLine(job: string, budget = "6"): string {
  return `hubpedia|${job}|${job}.md|${budget}|oc|oc`;
}

export function titleLine(job: string, batch: readonly AilTerm[]): string {
  const first = batch.slice(0, 3).map((term) => term.labelJa).join("、");
  return `hubpedia/${job}|Hubpedia記事${batch.length}本：${first}ほか（${batch[0].qid}〜）`;
}
