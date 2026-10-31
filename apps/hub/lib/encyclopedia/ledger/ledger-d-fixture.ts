import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { D1Database } from "@cloudflare/workers-types";

/*
 * Test-only schema for Lane D. Every real migration is applied once to a
 * template; each test copies it. Lanes A and B add columns (0291, 0292) that
 * Lane D reads; until their migrations are in the tree the missing ones are
 * added here, and skipped when the migration already created them.
 */

const LANE_A_COLUMNS: Array<[table: string, column: string, ddl: string]> = [
  ["encyclopedia_source_chunks", "content_hash", "ALTER TABLE encyclopedia_source_chunks ADD COLUMN content_hash TEXT"],
  ["encyclopedia_claim_evidence", "superseded_at", "ALTER TABLE encyclopedia_claim_evidence ADD COLUMN superseded_at INTEGER"],
];

export function createLedgerTemplate() {
  const workDir = mkdtempSync(join(tmpdir(), "hubpedia-ledger-d-"));
  const template = join(workDir, "template.sqlite");
  const sql = new DatabaseSync(template);
  const dir = new URL("../../../migrations/", import.meta.url);
  for (const name of readdirSync(dir).filter((file) => file.endsWith(".sql")).sort()) sql.exec(readFileSync(new URL(name, dir), "utf8"));
  for (const [table, column, ddl] of LANE_A_COLUMNS) {
    const columns = sql.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === column)) sql.exec(ddl);
  }
  sql.close();
  let copies = 0;
  const open: DatabaseSync[] = [];
  return {
    dispose() { open.splice(0).forEach((s) => s.close()); rmSync(workDir, { recursive: true, force: true }); },
    closeAll() { open.splice(0).forEach((s) => s.close()); },
    fixture() {
      copies += 1;
      const target = join(workDir, `db-${copies}.sqlite`);
      copyFileSync(template, target);
      const raw = new DatabaseSync(target);
      open.push(raw);
      const statement = (query: string, values: SQLInputValue[] = []) => ({
        bind: (...bound: SQLInputValue[]) => statement(query, bound),
        first: async () => raw.prepare(query).get(...values) ?? null,
        all: async () => ({ results: raw.prepare(query).all(...values), success: true, meta: {} }),
        run: async () => { const r = raw.prepare(query).run(...values); return { success: true, meta: { changes: Number(r.changes) } }; },
        __sql: query,
        __values: values,
      });
      type Stmt = ReturnType<typeof statement>;
      const db = {
        prepare: (query: string) => statement(query),
        /* D1 batches are atomic: a failing statement rolls the whole batch back. */
        batch: async (statements: Stmt[]) => {
          raw.exec("BEGIN");
          try {
            const out = statements.map((s) => { const r = raw.prepare(s.__sql).run(...s.__values); return { success: true, meta: { changes: Number(r.changes) } }; });
            raw.exec("COMMIT");
            return out;
          } catch (error) { raw.exec("ROLLBACK"); throw error; }
        },
      } as unknown as D1Database;
      const run = (query: string, ...values: SQLInputValue[]) => raw.prepare(query).run(...values);
      const get = <T>(query: string, ...values: SQLInputValue[]) => raw.prepare(query).get(...values) as T | undefined;
      const all = <T>(query: string, ...values: SQLInputValue[]) => raw.prepare(query).all(...values) as T[];
      return { raw, db, run, get, all };
    },
  };
}

export type LedgerFixture = ReturnType<ReturnType<typeof createLedgerTemplate>["fixture"]>;

/** A source, snapshot and chunks under one topic. Returns chunk ids in order. */
export function seedSource(f: LedgerFixture, rawInput: { topicId: string; sourceId: string; snapshotId: string; url: string; chunks: Array<{ id: string; text: string; hash?: string }>; retrievedAt?: number }) {
  /* 0291 seeds the _ledger pool topic under its own id; resolve by slug. */
  const input = { ...rawInput, topicId: f.get<{ id: string }>("SELECT id FROM encyclopedia_topics WHERE slug = ?", rawInput.topicId)?.id ?? rawInput.topicId };
  f.run("INSERT OR IGNORE INTO encyclopedia_topics(id,canonical_name,slug,topic_type,created_at,updated_at) VALUES(?,?,?,?,1,1)", input.topicId, input.topicId, input.topicId, "concept");
  f.run("INSERT OR IGNORE INTO encyclopedia_sources(id,topic_id,url,normalized_url,title,source_type,created_at,updated_at) VALUES(?,?,?,?,?,?,1,1)", input.sourceId, input.topicId, input.url, input.url, `Title ${input.sourceId}`, "web");
  f.run("INSERT INTO encyclopedia_source_snapshots(id,source_id,retrieved_at,content_hash,created_at) VALUES(?,?,?,?,1)", input.snapshotId, input.sourceId, input.retrievedAt ?? 1, `snap-${input.snapshotId}`);
  input.chunks.forEach((chunk, index) => {
    f.run("INSERT INTO encyclopedia_source_chunks(id,snapshot_id,chunk_index,text_content,start_offset,end_offset,content_hash,created_at) VALUES(?,?,?,?,0,?,?,1)", chunk.id, input.snapshotId, index, chunk.text, chunk.text.length, chunk.hash ?? null);
  });
}

export function addClaim(f: LedgerFixture, input: { id: string; topicId: string; status?: string; statement?: string }) {
  f.run("INSERT OR IGNORE INTO encyclopedia_topics(id,canonical_name,slug,topic_type,created_at,updated_at) VALUES(?,?,?,?,1,1)", input.topicId, input.topicId, input.topicId, "concept");
  f.run("INSERT INTO encyclopedia_claims(id,topic_id,statement,normalized_statement,status,created_at,updated_at) VALUES(?,?,?,?,?,1,1)", input.id, input.topicId, input.statement ?? `claim ${input.id}`, (input.statement ?? `claim ${input.id}`).toLowerCase(), input.status ?? "supported");
}

export function addEvidence(f: LedgerFixture, claimId: string, chunkId: string, quote: string | null) {
  f.run("INSERT INTO encyclopedia_claim_evidence(claim_id,chunk_id,stance,quote,created_at) VALUES(?,?,'supports',?,1)", claimId, chunkId, quote);
}

/** An article with one current revision citing the given claims. */
export function addArticle(f: LedgerFixture, input: { slug: string; claimIds?: string[]; authorKind?: "ai" | "human" | "hybrid"; status?: string; openFinding?: boolean; ledger?: boolean }) {
  const { slug } = input;
  f.run("INSERT INTO encyclopedia_topics(id,canonical_name,slug,topic_type,created_at,updated_at) VALUES(?,?,?,?,1,1)", `topic-${slug}`, slug, slug, "concept");
  f.run("INSERT INTO encyclopedia_articles(id,topic_id,title,slug,status,created_at,updated_at) VALUES(?,?,?,?,?,1,1)", `art-${slug}`, `topic-${slug}`, `Entry ${slug}`, slug, input.status ?? "draft");
  const metadata = input.ledger === false ? "{}" : JSON.stringify({ pipelineRunId: `run-${slug}` });
  f.run("INSERT INTO encyclopedia_article_revisions(id,article_id,revision_number,title,body_markdown,generation_metadata,created_by,author_kind,created_at) VALUES(?,?,1,?,?,?,?,?,1)", `rev-${slug}`, `art-${slug}`, "t", "body", metadata, input.ledger === false ? "human-editor" : "hubpedia-ledger", input.authorKind ?? "ai");
  f.run("UPDATE encyclopedia_articles SET current_revision_id=? WHERE id=?", `rev-${slug}`, `art-${slug}`);
  for (const claimId of input.claimIds ?? []) f.run("INSERT INTO encyclopedia_revision_claims(revision_id,claim_id,created_at) VALUES(?,?,1)", `rev-${slug}`, claimId);
  if (input.ledger !== false) f.run("INSERT INTO hubpedia_article_knowledge_state(article_slug,article_type,knowledge_status,ai_generated_ratio,updated_at) VALUES(?,?,?,1,?)", slug, "general", "provisional", "2026-10-29T00:00:00.000Z");
  if (input.openFinding !== false && input.ledger !== false) {
    f.run("INSERT INTO encyclopedia_review_findings(id,revision_id,finding_type,severity,status,message,created_at,updated_at) VALUES(?,?,'ai_generated_requires_review','high','open','review',1,1)", `finding-${slug}`, `rev-${slug}`);
  }
}

export function addProfile(f: LedgerFixture, id: string) {
  const columns = f.all<{ name: string; notnull: number; dflt_value: string | null; pk: number }>("PRAGMA table_info(profiles)");
  const values: Record<string, SQLInputValue> = {};
  for (const c of columns) {
    if (c.name === "id") values[c.name] = id;
    else if (c.notnull && c.dflt_value === null) values[c.name] = /(_at|At)$/.test(c.name) ? "2026-10-29T00:00:00.000Z" : `${c.name}-${id}`;
  }
  const names = Object.keys(values);
  f.run(`INSERT INTO profiles(${names.join(",")}) VALUES(${names.map(() => "?").join(",")})`, ...names.map((n) => values[n]));
}

export function appointPatrol(f: LedgerFixture, profileId: string) {
  f.run("INSERT INTO hubpedia_wiki_patrol(profile_id,appointed_by,appointed_at) VALUES(?,?,?)", profileId, "owner", "2026-10-29T00:00:00.000Z");
}
