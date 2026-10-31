import { judgeEncyclopedic } from "./noise";
import { createHash } from "node:crypto";

import {
  PRIORITY_WEIGHTS, TERM_NET_CAPS, TERM_NET_RULES, qidNumber,
  type EdgeRecord, type Relation, type TermRecord,
} from "./config";
import type { CachedEntity, ReverseRow } from "./wikidata-client";

/*
 * Traversal and snapshot (docs/hubpedia-ledger.md section 11, "範囲" and "取得").
 * `traverse` walks the net through a source (the online client when fetching, the same client in offline mode when
 * building), so fetch and build see the same order and the second run asks for nothing.
 * `assembleSnapshot` trims to the caps and `serializeSnapshot` writes the byte-stable JSONL.
 */

export type NetSeed = { slug: string; qid: string; labelJa?: string | null; labelEn?: string | null; kind?: string };

export interface NetSource {
  entities(qids: readonly string[]): Promise<Map<string, CachedEntity>>;
  reverse(parents: readonly string[]): Promise<Map<string, ReverseRow[]>>;
}

export type RawNet = {
  seeds: NetSeed[];
  entities: Map<string, CachedEntity>;
  hops: Map<string, number>;
  reverseEdges: EdgeRecord[];
  /** True number of direct subclasses seen in the reverse query, for seeds only. */
  subclassCounts: Map<string, number>;
  stoppedAtCap: boolean;
};

const byQid = (a: string, b: string) => qidNumber(a) - qidNumber(b);

export async function traverse(source: NetSource, seeds: readonly NetSeed[], caps: { maxTerms: number } = TERM_NET_CAPS): Promise<RawNet> {
  const hops = new Map<string, number>();
  const entities = new Map<string, CachedEntity>();
  const reverseEdges: EdgeRecord[] = [];
  const subclassCounts = new Map<string, number>();
  let stoppedAtCap = false;

  const seedQids = [...new Set(seeds.map((seed) => seed.qid))].sort(byQid);
  for (const qid of seedQids) hops.set(qid, 0);
  const admit = (qid: string, hop: number): boolean => {
    if (hops.has(qid)) return false;
    if (hops.size >= caps.maxTerms) { stoppedAtCap = true; return false; }
    hops.set(qid, hop);
    return true;
  };
  const load = async (qids: readonly string[]) => {
    for (const [qid, entity] of await source.entities(qids)) entities.set(qid, entity);
  };

  await load(seedQids);

  /* Reverse step: from seeds only, one level, at most 50 per seed, most-linked first. Instance-of is never reversed. */
  const reverse = await source.reverse(seedQids);
  const children: string[] = [];
  for (const parent of seedQids) {
    const rows = reverse.get(parent) ?? [];
    subclassCounts.set(parent, rows.filter((row) => row.relation === "subclass_of").length);
    const kept = [...rows].sort((a, b) => b.sitelinks - a.sitelinks || byQid(a.child, b.child)).slice(0, TERM_NET_RULES.reverseLimitPerTerm);
    for (const row of kept) {
      if (hops.has(row.child) || admit(row.child, 1)) {
        reverseEdges.push({ from: row.child, to: parent, relation: row.relation, origin: "wikidata" });
        if (!children.includes(row.child) && !seedQids.includes(row.child)) children.push(row.child);
      }
    }
  }
  await load(children);

  /* Forward step: up to two levels from seeds along the other statements. */
  let level = seedQids;
  for (let depth = 1; depth <= TERM_NET_RULES.forwardHops; depth += 1) {
    const next: string[] = [];
    for (const qid of level) {
      const entity = entities.get(qid);
      if (!entity || entity.missing) continue;
      for (const edge of entity.out) {
        if (hops.has(edge.to)) continue;
        if (admit(edge.to, depth)) next.push(edge.to);
      }
    }
    level = [...new Set(next)].sort(byQid);
    await load(level);
  }

  return { seeds: [...seeds], entities, hops, reverseEdges, subclassCounts, stoppedAtCap };
}

/* ---- slugs ---- */

export function slugifyLabel(label: string): string {
  return label.normalize("NFKD").replace(/[̀-ͯ]/gu, "").toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 70).replace(/-+$/u, "");
}

export type Snapshot = {
  terms: TermRecord[];
  edges: EdgeRecord[];
  unmatchedSeeds: Array<{ slug: string; reason: string }>;
  duplicateSeeds: Array<{ slug: string; qid: string; keptSlug: string }>;
  trimmed: { terms: number; edges: number };
};

export function assembleSnapshot(
  raw: RawNet,
  options: { caps?: { maxTerms: number; maxEdges: number }; unmatchedSeeds?: Array<{ slug: string; reason: string }> } = {},
): Snapshot {
  const caps = options.caps ?? TERM_NET_CAPS;
  const seedByQid = new Map<string, NetSeed>();
  const duplicateSeeds: Snapshot["duplicateSeeds"] = [];
  for (const seed of [...raw.seeds].sort((a, b) => a.slug.localeCompare(b.slug))) {
    const first = seedByQid.get(seed.qid);
    if (first) duplicateSeeds.push({ slug: seed.slug, qid: seed.qid, keptSlug: first.slug });
    else seedByQid.set(seed.qid, seed);
  }

  type Candidate = { qid: string; entity: CachedEntity | undefined; hop: number; seed: NetSeed | undefined };
  const candidates: Candidate[] = [];
  for (const [qid, hop] of raw.hops) {
    const entity = raw.entities.get(qid);
    const seed = seedByQid.get(qid);
    if (entity?.missing && !seed) continue;
    if (!seed && !(entity && (entity.labelJa || entity.labelEn))) continue; // no headword in either language
    candidates.push({ qid, entity: entity?.missing ? undefined : entity, hop, seed });
  }
  const sitelinksOf = (c: Candidate) => c.entity?.sitelinks ?? 0;
  /* Seeds, then level 1, then level 2; within a level the most-linked first. */
  candidates.sort((a, b) => Number(!!b.seed) - Number(!!a.seed) || a.hop - b.hop || sitelinksOf(b) - sitelinksOf(a) || byQid(a.qid, b.qid));
  const seedCount = candidates.filter((c) => c.seed).length;
  const kept = candidates.slice(0, Math.max(caps.maxTerms, seedCount));
  const trimmedTerms = candidates.length - kept.length;
  const keptQids = new Set(kept.map((c) => c.qid));

  /* Slugs: a seed keeps its topic slug; others come from the English headword, -q<number> on a clash, q<number> without one. */
  const taken = new Set<string>();
  const slugOf = new Map<string, string>();
  for (const candidate of [...kept].filter((c) => c.seed).sort((a, b) => byQid(a.qid, b.qid))) {
    slugOf.set(candidate.qid, candidate.seed!.slug);
    taken.add(candidate.seed!.slug);
  }
  for (const candidate of [...kept].filter((c) => !c.seed).sort((a, b) => byQid(a.qid, b.qid))) {
    const base = candidate.entity?.labelEn ? slugifyLabel(candidate.entity.labelEn) : "";
    let slug = base || candidate.qid.toLowerCase();
    if (taken.has(slug)) slug = `${base ? `${base}-` : ""}${candidate.qid.toLowerCase()}`;
    taken.add(slug);
    slugOf.set(candidate.qid, slug);
  }

  const edgeMap = new Map<string, EdgeRecord>();
  const addEdge = (from: string, to: string, relation: Relation) => {
    if (from === to || !keptQids.has(from) || !keptQids.has(to)) return;
    edgeMap.set(`${from}|${to}|${relation}`, { from, to, relation, origin: "wikidata" });
  };
  for (const candidate of kept) {
    const entity = candidate.entity;
    if (!entity) continue;
    for (const edge of entity.out) addEdge(candidate.qid, edge.to, edge.relation);
    for (const edge of entity.inc) addEdge(edge.from, candidate.qid, edge.relation);
  }
  for (const edge of raw.reverseEdges) addEdge(edge.from, edge.to, edge.relation);

  let edges = [...edgeMap.values()];
  const hopOf = (qid: string) => raw.hops.get(qid) ?? 9;
  const sitelinksOfQid = (qid: string) => raw.entities.get(qid)?.sitelinks ?? 0;
  const trimmedEdges = Math.max(edges.length - caps.maxEdges, 0);
  if (trimmedEdges > 0) {
    edges.sort((a, b) =>
      Math.min(hopOf(a.from), hopOf(a.to)) - Math.min(hopOf(b.from), hopOf(b.to))
      || (sitelinksOfQid(b.from) + sitelinksOfQid(b.to)) - (sitelinksOfQid(a.from) + sitelinksOfQid(a.to))
      || byQid(a.from, b.from) || byQid(a.to, b.to) || a.relation.localeCompare(b.relation));
    edges = edges.slice(0, caps.maxEdges);
  }
  edges.sort((a, b) => byQid(a.from, b.from) || byQid(a.to, b.to) || a.relation.localeCompare(b.relation));

  /* A term with many direct subclasses is too general to link claims to. Seeds use the true count; others, the count inside the net. */
  const inNetSubclasses = new Map<string, number>();
  for (const edge of edges) if (edge.relation === "subclass_of") inNetSubclasses.set(edge.to, (inNetSubclasses.get(edge.to) ?? 0) + 1);

  const terms: TermRecord[] = kept.map((candidate) => {
    const entity = candidate.entity;
    const seed = candidate.seed;
    const fallbackJa = seed?.labelJa ?? null;
    const fallbackEn = seed?.labelEn ?? null;
    const subclasses = Math.max(raw.subclassCounts.get(candidate.qid) ?? 0, inNetSubclasses.get(candidate.qid) ?? 0);
    return {
      qid: candidate.qid,
      slug: slugOf.get(candidate.qid)!,
      labelJa: entity?.labelJa ?? fallbackJa,
      labelEn: entity?.labelEn ?? fallbackEn,
      aliasesJa: entity?.aliasesJa ?? [],
      aliasesEn: entity?.aliasesEn ?? [],
      descriptionJa: entity?.descriptionJa ?? null,
      descriptionEn: entity?.descriptionEn ?? null,
      sitelinks: entity?.sitelinks ?? 0,
      hops: candidate.hop,
      seed: !!seed,
      linkable: subclasses <= TERM_NET_RULES.nonLinkableSubclasses && judgeEncyclopedic(entity, !!seed).encyclopedic,
      rev: entity?.rev ?? null,
    };
  }).sort((a, b) => byQid(a.qid, b.qid));

  return {
    terms, edges,
    unmatchedSeeds: options.unmatchedSeeds ?? [],
    duplicateSeeds,
    trimmed: { terms: trimmedTerms, edges: trimmedEdges },
  };
}

/* ---- file format: one term or edge per line, in a fixed order, with a fixed key order ---- */

export function serializeSnapshot(terms: readonly TermRecord[], edges: readonly EdgeRecord[]): string {
  const lines: string[] = [];
  for (const t of [...terms].sort((a, b) => byQid(a.qid, b.qid))) {
    lines.push(JSON.stringify({
      t: "term", qid: t.qid, slug: t.slug, labelJa: t.labelJa, labelEn: t.labelEn, aliasesJa: t.aliasesJa, aliasesEn: t.aliasesEn,
      descriptionJa: t.descriptionJa, descriptionEn: t.descriptionEn, sitelinks: t.sitelinks, hops: t.hops, seed: t.seed, linkable: t.linkable, rev: t.rev,
    }));
  }
  const ordered = [...edges].sort((a, b) => byQid(a.from, b.from) || byQid(a.to, b.to) || a.relation.localeCompare(b.relation));
  for (const e of ordered) lines.push(JSON.stringify({ t: "edge", from: e.from, to: e.to, relation: e.relation, origin: e.origin }));
  return `${lines.join("\n")}\n`;
}

export const sha256Text = (text: string) => createHash("sha256").update(text).digest("hex");

export function parseSnapshot(text: string): { terms: TermRecord[]; edges: EdgeRecord[] } {
  const terms: TermRecord[] = [];
  const edges: EdgeRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as Record<string, unknown>;
    if (row.t === "term") {
      const { t: _t, ...rest } = row;
      terms.push(rest as unknown as TermRecord);
    } else if (row.t === "edge") {
      edges.push({ from: row.from as string, to: row.to as string, relation: row.relation as Relation, origin: row.origin as "wikidata" | "hub" });
    }
  }
  return { terms, edges };
}

export type SnapshotManifest = {
  file: string;
  retrievedAt: string;
  license: "CC0-1.0";
  source: "Wikidata";
  termCount: number;
  edgeCount: number;
  sha256: string;
  params: { caps: { maxTerms: number; maxEdges: number }; forwardHops: number; reverseHops: number; reverseLimitPerTerm: number; weights: typeof PRIORITY_WEIGHTS };
  unmatchedSeeds: Array<{ slug: string; reason: string }>;
  duplicateSeeds: Snapshot["duplicateSeeds"];
  trimmed: Snapshot["trimmed"];
  stoppedAtCap: boolean;
};

export function buildManifest(input: { file: string; retrievedAt: string; text: string; snapshot: Snapshot; stoppedAtCap: boolean; caps?: { maxTerms: number; maxEdges: number } }): SnapshotManifest {
  return {
    file: input.file,
    retrievedAt: input.retrievedAt,
    license: "CC0-1.0",
    source: "Wikidata",
    termCount: input.snapshot.terms.length,
    edgeCount: input.snapshot.edges.length,
    sha256: sha256Text(input.text),
    params: {
      caps: input.caps ?? TERM_NET_CAPS, forwardHops: TERM_NET_RULES.forwardHops, reverseHops: TERM_NET_RULES.reverseHops,
      reverseLimitPerTerm: TERM_NET_RULES.reverseLimitPerTerm, weights: PRIORITY_WEIGHTS,
    },
    unmatchedSeeds: input.snapshot.unmatchedSeeds,
    duplicateSeeds: input.snapshot.duplicateSeeds,
    trimmed: input.snapshot.trimmed,
    stoppedAtCap: input.stoppedAtCap,
  };
}
