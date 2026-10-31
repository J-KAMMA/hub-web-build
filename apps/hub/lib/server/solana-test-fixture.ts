/**
 * Test-only helpers for the Solana lane: an in-memory SQLite database that answers the D1 calls the wallet
 * link, gate and tip code uses. Imported by *.test.ts files only.
 */
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { readFileSync } from "node:fs";
import type { D1Database } from "@cloudflare/workers-types";

const migrationText = (file: string) => readFileSync(new URL("../../migrations/" + file, import.meta.url), "utf8");

export const SOLANA_TEST_DATE = "2026-01-01T00:00:00.000Z";

export type SolanaTestDb = { sql: DatabaseSync; db: D1Database };

export function createSolanaTestDb(migrations: readonly string[]): SolanaTestDb {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON;");
  for (const file of migrations) sql.exec(migrationText(file));
  const numbers = (row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]));
  const prepare = (query: string) => {
    let values: SQLInputValue[] = [];
    const statement = {
      bind(...next: SQLInputValue[]) { values = next; return statement; },
      async first() { const s = sql.prepare(query); s.setReadBigInts(true); const row = s.get(...values); return row ? numbers(row) : null; },
      async all() { const s = sql.prepare(query); s.setReadBigInts(true); return { results: s.all(...values).map(numbers) }; },
      async run() { const r = sql.prepare(query).run(...values); return { meta: { changes: Number(r.changes) } }; },
    };
    return statement;
  };
  const db = {
    prepare,
    async batch(statements: { run(): Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try { const out = []; for (const s of statements) out.push(await s.run()); sql.exec("COMMIT"); return out; }
      catch (error) { sql.exec("ROLLBACK"); throw error; }
    },
  } as unknown as D1Database;
  return { sql, db };
}

export function insertTestProfile(sql: DatabaseSync, id: string, handle = id) {
  sql.prepare("INSERT INTO profiles(id,handle,display_name,joined_at,created_at,updated_at) VALUES(?,?,?,?,?,?)")
    .run(id, handle, handle, SOLANA_TEST_DATE, SOLANA_TEST_DATE, SOLANA_TEST_DATE);
}

/** Migrations the wallet account tables need (profiles, wallet tables, rebuild 0306 and the new 0307/0308). */
export const WALLET_TEST_MIGRATIONS = [
  "0001_hub_core.sql",
  "0051_profile_wallet_links.sql",
  "0053_wallet_tips.sql",
  "0088_multichain_wallet_accounts.sql",
  "0306_wallet_accounts_verified_uniqueness.sql",
  "0307_wallet_link_challenges_v2_and_tip_transfers.sql",
] as const;

export function applyTestMigration(sql: DatabaseSync, file: string) {
  sql.exec(migrationText(file));
}
