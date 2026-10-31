import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import type { EdgeRecord } from "./config";
import { computePriorities, type DemandInputs } from "./priority";
import { parseSnapshot, sha256Text, type SnapshotManifest } from "./snapshot";

/*
 * Loading a snapshot into D1 (docs/hubpedia-ledger.md section 11, "D1 へ入れる").
 * Without `apply` nothing is executed: the function reads what is already there, builds the statements, and returns
 * per-table row counts. With `apply`, 500 statements per batch, one ANALYZE at the end. The same sha256 is never
 * loaded twice, and a newer snapshot writes only the difference. Nothing here touches encyclopedia_sources.
 */

export const LOAD_BATCH = 500;

export type TableCounts = { insert: number; update: number; delete: number; unchanged: number };
export type LoadReport = {
  apply: boolean;
  sha256: string;
  snapshotId: string;
  alreadyLoaded: boolean;
  tables: { hubpedia_term_snapshots: TableCounts; hubpedia_terms: TableCounts; hubpedia_term_edges: TableCounts };
  statements: number;
  analyzed: boolean;
};

const zero = (): TableCounts => ({ insert: 0, update: 0, delete: 0, unchanged: 0 });
export const termRowId = (qid: string) => `term-${qid}`;
export const snapshotRowId = (sha: string) => `snap-${sha.slice(0, 16)}`;

const same = (a: number | null | undefined, b: number | null | undefined) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-12;

export async function loadSnapshot(
  db: D1Database,
  input: { text: string; manifest: Pick<SnapshotManifest, "sha256" | "retrievedAt" | "params">; demand?: DemandInputs; now?: number; /** Where the snapshot file was stored as an R2 object (hubpedia-ledger/term-net/<sha256>.jsonl). */ object?: { key: string; bytes: number } },
  options: { apply?: boolean } = {},
): Promise<LoadReport> {
  const apply = options.apply === true;
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const sha = sha256Text(input.text);
  if (sha !== input.manifest.sha256) throw new Error("The snapshot file does not match its manifest sha256; refusing to load.");
  const snapshotId = snapshotRowId(sha);
  const report: LoadReport = {
    apply, sha256: sha, snapshotId, alreadyLoaded: false, statements: 0, analyzed: false,
    tables: { hubpedia_term_snapshots: zero(), hubpedia_terms: zero(), hubpedia_term_edges: zero() },
  };

  const existingSnapshot = await db.prepare("SELECT id FROM hubpedia_term_snapshots WHERE sha256 = ?").bind(sha).first<{ id: string }>();
  if (existingSnapshot) {
    report.alreadyLoaded = true;
    report.tables.hubpedia_term_snapshots.unchanged = 1;
    return report;
  }

  const { terms, edges } = parseSnapshot(input.text);
  const priorities = computePriorities(terms, edges, input.demand);

  const existingTerms = new Map<string, { id: string; slug: string; labelJa: string | null; labelEn: string | null; hops: number; sitelinks: number; centrality: number; demand: number; rank: number | null; linkable: number }>();
  for (const row of (await db.prepare(
    "SELECT id, qid, slug, label_ja AS labelJa, label_en AS labelEn, hops, sitelinks, centrality, demand, priority_rank AS rank, linkable FROM hubpedia_terms",
  ).all<{ id: string; qid: string; slug: string; labelJa: string | null; labelEn: string | null; hops: number; sitelinks: number; centrality: number; demand: number; rank: number | null; linkable: number }>()).results ?? []) {
    existingTerms.set(row.qid, row);
  }
  const existingEdges = new Set<string>();
  for (const row of (await db.prepare("SELECT from_term_id AS f, to_term_id AS t, relation FROM hubpedia_term_edges WHERE origin = 'wikidata'").all<{ f: string; t: string; relation: string }>()).results ?? []) {
    existingEdges.add(`${row.f}|${row.t}|${row.relation}`);
  }

  const statements: D1PreparedStatement[] = [];
  statements.push(db.prepare("INSERT INTO hubpedia_term_snapshots (id, sha256, retrieved_at, term_count, edge_count, params_json, loaded_at, object_key, bytes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(snapshotId, sha, input.manifest.retrievedAt, terms.length, edges.length, JSON.stringify(input.manifest.params), now, input.object?.key ?? null, input.object?.bytes ?? null));
  report.tables.hubpedia_term_snapshots.insert = 1;

  /* A slug already held by a loaded term stays with it; a new term that wants it takes the -q<number> form. */
  const takenSlugs = new Set([...existingTerms.values()].map((t) => t.slug));
  for (const term of terms) {
    const priority = priorities.get(term.qid)!;
    const before = existingTerms.get(term.qid);
    if (!before) {
      let slug = term.slug;
      if (takenSlugs.has(slug)) slug = `${slug}-${term.qid.toLowerCase()}`;
      takenSlugs.add(slug);
      statements.push(db.prepare(
        `INSERT INTO hubpedia_terms (id, qid, slug, label_ja, label_en, topic_id, hops, sitelinks, centrality, demand, priority_rank, linkable, snapshot_id, updated_at)
         VALUES (?, ?, ?, ?, ?, ${term.seed ? "(SELECT id FROM encyclopedia_topics WHERE slug = ? AND topic_type <> 'ledger-pool')" : "NULL"}, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(termRowId(term.qid), term.qid, slug, term.labelJa, term.labelEn, ...(term.seed ? [slug] : []),
        term.hops, term.sitelinks, priority.centrality, priority.demand, priority.rank, term.linkable ? 1 : 0, snapshotId, now));
      report.tables.hubpedia_terms.insert += 1;
      continue;
    }
    const unchanged = before.labelJa === term.labelJa && before.labelEn === term.labelEn && before.hops === term.hops && before.sitelinks === term.sitelinks
      && same(before.centrality, priority.centrality) && same(before.demand, priority.demand) && before.rank === priority.rank && before.linkable === (term.linkable ? 1 : 0);
    if (unchanged) { report.tables.hubpedia_terms.unchanged += 1; continue; }
    statements.push(db.prepare(
      `UPDATE hubpedia_terms SET label_ja = ?, label_en = ?, hops = ?, sitelinks = ?, centrality = ?, demand = ?, priority_rank = ?, linkable = ?, snapshot_id = ?, updated_at = ? WHERE qid = ?`,
    ).bind(term.labelJa, term.labelEn, term.hops, term.sitelinks, priority.centrality, priority.demand, priority.rank, term.linkable ? 1 : 0, snapshotId, now, term.qid));
    report.tables.hubpedia_terms.update += 1;
  }

  const newEdgeKeys = new Set<string>();
  for (const edge of edges as EdgeRecord[]) {
    const key = `${termRowId(edge.from)}|${termRowId(edge.to)}|${edge.relation}`;
    newEdgeKeys.add(key);
    if (existingEdges.has(key)) { report.tables.hubpedia_term_edges.unchanged += 1; continue; }
    statements.push(db.prepare("INSERT INTO hubpedia_term_edges (from_term_id, to_term_id, relation, origin, snapshot_id) VALUES (?, ?, ?, ?, ?)")
      .bind(termRowId(edge.from), termRowId(edge.to), edge.relation, edge.origin, snapshotId));
    report.tables.hubpedia_term_edges.insert += 1;
  }
  for (const key of existingEdges) {
    if (newEdgeKeys.has(key)) continue;
    const [from, to, relation] = key.split("|");
    statements.push(db.prepare("DELETE FROM hubpedia_term_edges WHERE from_term_id = ? AND to_term_id = ? AND relation = ? AND origin = 'wikidata'").bind(from, to, relation));
    report.tables.hubpedia_term_edges.delete += 1;
  }

  report.statements = statements.length;
  if (!apply) return report;

  for (let start = 0; start < statements.length; start += LOAD_BATCH) await db.batch(statements.slice(start, start + LOAD_BATCH));
  await db.prepare("ANALYZE").run();
  report.analyzed = true;
  return report;
}

