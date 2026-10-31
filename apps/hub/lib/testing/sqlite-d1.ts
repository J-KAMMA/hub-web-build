import { copyFileSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

import type { D1Database } from "@cloudflare/workers-types";

/*
 * 試験用の D1 代用品。node:sqlite に Hub の全 migration を順に流す。
 * prepare().bind().first()/all()/run() と batch() だけを備える（Hub のサーバーコードが使う範囲）。
 * 字面の照合ではなく本物の SQL とスキーマ（トリガー・CHECK・UNIQUE を含む）を通すために使う。
 */
/*
 * 全 migration の適用は約2.5秒かかる。試験ごとに流すと重いファイルが数十秒〜100秒近く CPU を塞ぎ、
 * vitest の worker が RPC 応答できず "Timeout calling onTaskUpdate" になる（2026-10-14 の staging gate）。
 * 雛形は vitest の globalSetup（lib/testing/sqlite-d1-global-setup.ts）が 1 回だけ作る。無ければ 1 プロセスにつき 1 回作り、以降はそのコピーを開く。
 */
let template: { dir: string; file: string; count: number } | undefined;
export const SHARED_TEMPLATE_ENV = "HUB_SQLITE_D1_TEMPLATE";

/* 全 migration を流した雛形ファイルを作る。vitest の globalSetup が 1 回だけ呼び、各 worker は env 経由でそれを使う。 */
export function buildTemplateDatabase(root: string, file: string) {
  const base = new DatabaseSync(file);
  // 文ごとの fsync を避ける。雛形は使い捨てなので耐久性は要らない。
  base.exec("PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF; PRAGMA foreign_keys = ON;");
  const migrations = path.join(root, "migrations");
  for (const name of readdirSync(migrations).filter((entry) => entry.endsWith(".sql")).sort()) {
    base.exec(readFileSync(path.join(migrations, name), "utf8"));
  }
  base.close();
}

function templateDatabase() {
  if (template) return template;
  const shared = process.env[SHARED_TEMPLATE_ENV];
  if (shared && existsSync(shared)) {
    // 雛形は globalSetup が 1 度だけ作った。コピー先は worker ごとの別ディレクトリにして、片付けも worker が持つ。
    const dir = mkdtempSync(path.join(os.tmpdir(), "hub-sqlite-d1-"));
    template = { dir, file: shared, count: 0 };
    process.once("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
    return template;
  }
  const dir = mkdtempSync(path.join(os.tmpdir(), "hub-sqlite-d1-"));
  const file = path.join(dir, "template.sqlite");
  buildTemplateDatabase(process.cwd(), file);
  template = { dir, file, count: 0 };
  process.once("exit", () => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } });
  return template;
}

export function sqliteHubD1() {
  const source = templateDatabase();
  const copy = path.join(source.dir, `copy-${source.count++}.sqlite`);
  copyFileSync(source.file, copy);
  return wrapSqliteAsD1(new DatabaseSync(copy));
}

/* 既存の node:sqlite データベースを D1 互換の面で包む。台帳の試運転で使い捨てファイルを開くときにも使う。 */
export function wrapSqliteAsD1(sql: DatabaseSync) {
  sql.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = MEMORY; PRAGMA synchronous = OFF;");

  type Statement = {
    bind: (...values: unknown[]) => Statement;
    first: <T>() => Promise<T | null>;
    all: <T>() => Promise<{ results: T[] }>;
    run: () => Promise<{ success: true; meta: { changes: number } }>;
    execute: () => { changes: number };
  };

  function prepare(query: string, values: SQLInputValue[] = []): Statement {
    return {
      bind: (...bound: unknown[]) => prepare(query, bound as SQLInputValue[]),
      first: async <T>() => (sql.prepare(query).get(...values) as T | undefined) ?? null,
      all: async <T>() => ({ results: sql.prepare(query).all(...values) as T[] }),
      run: async () => ({ success: true as const, meta: { changes: Number(sql.prepare(query).run(...values).changes) } }),
      execute: () => ({ changes: Number(sql.prepare(query).run(...values).changes) }),
    };
  }

  const db = {
    prepare,
    // D1 の batch は1つのトランザクション。途中で失敗したら全部巻き戻す。
    async batch(statements: Statement[]) {
      sql.exec("BEGIN");
      try {
        const results = statements.map((statement) => ({ success: true, meta: statement.execute() }));
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;

  return { sql, db };
}
