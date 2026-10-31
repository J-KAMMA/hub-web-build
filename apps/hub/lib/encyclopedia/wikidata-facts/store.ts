import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import type { Fact } from "./facts";
import type { DroppedSentence } from "./verify";

/*
 * Throwaway output of the Wikidata-fact trial: one local sqlite file plus a JSONL mirror. Never a Cloudflare D1 or R2 target.
 * Every article row carries the provenance the Hub needs later: facts are CC0-1.0 Wikidata statements (with their references),
 * the text is AI generated and unverified, and the article is noindex.
 */

export type ArticleRecord = {
  qid: string;
  slug: string;
  titleJa: string;
  titleEn: string | null;
  sitelinks: number;
  status: "accepted" | "rejected";
  rejectReason: string | null;
  bodyMarkdown: string;
  keptSentences: Array<{ text: string; factIds: string[] }>;
  droppedSentences: DroppedSentence[];
  facts: Fact[];
  provider: string | null;
  model: string | null;
  attempts: number;
  tokens: number;
  latencyMs: number;
};

export type CallRecord = { qid: string; provider: string | null; ok: boolean; error: string | null; tokens: number; latencyMs: number; at: string };

export function openTrialStore(sqlitePath: string, jsonlPath: string) {
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const db = new DatabaseSync(sqlitePath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      qid TEXT PRIMARY KEY, slug TEXT NOT NULL, title_ja TEXT NOT NULL, title_en TEXT, sitelinks INTEGER NOT NULL,
      status TEXT NOT NULL, reject_reason TEXT, body_markdown TEXT NOT NULL,
      kept_sentences_json TEXT NOT NULL, dropped_sentences_json TEXT NOT NULL, facts_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'wikidata', facts_licence TEXT NOT NULL DEFAULT 'CC0-1.0', ai_generated INTEGER NOT NULL DEFAULT 1,
      knowledge_status TEXT NOT NULL DEFAULT 'unverified', noindex INTEGER NOT NULL DEFAULT 1,
      provider TEXT, model TEXT, attempts INTEGER NOT NULL, tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT, qid TEXT NOT NULL, provider TEXT, ok INTEGER NOT NULL, error TEXT, tokens INTEGER NOT NULL, latency_ms INTEGER NOT NULL, at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prep_skips (qid TEXT PRIMARY KEY, reason TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS segments (id INTEGER PRIMARY KEY AUTOINCREMENT, started_at TEXT NOT NULL, ended_at TEXT, note TEXT);
  `);
  const insertArticle = db.prepare(`INSERT OR REPLACE INTO articles
    (qid, slug, title_ja, title_en, sitelinks, status, reject_reason, body_markdown, kept_sentences_json, dropped_sentences_json, facts_json, provider, model, attempts, tokens, latency_ms, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertCall = db.prepare("INSERT INTO calls (qid, provider, ok, error, tokens, latency_ms, at) VALUES (?, ?, ?, ?, ?, ?, ?)");
  return {
    db,
    done(): Set<string> {
      return new Set((db.prepare("SELECT qid FROM articles").all() as Array<{ qid: string }>).map((row) => row.qid));
    },
    usedSlugs(): Set<string> {
      return new Set((db.prepare("SELECT slug FROM articles").all() as Array<{ slug: string }>).map((row) => row.slug));
    },
    saveArticle(record: ArticleRecord) {
      const createdAt = new Date().toISOString();
      insertArticle.run(
        record.qid, record.slug, record.titleJa, record.titleEn, record.sitelinks, record.status, record.rejectReason, record.bodyMarkdown,
        JSON.stringify(record.keptSentences), JSON.stringify(record.droppedSentences), JSON.stringify(record.facts),
        record.provider, record.model, record.attempts, record.tokens, record.latencyMs, createdAt,
      );
      appendFileSync(jsonlPath, `${JSON.stringify({
        ...record, source: "wikidata", factsLicence: "CC0-1.0", aiGenerated: true, knowledgeStatus: "unverified", noindex: true,
        renderLabel: "Wikidataの事実からAIが作成・未検証", createdAt,
      })}\n`, "utf8");
    },
    saveCall(call: CallRecord) {
      insertCall.run(call.qid, call.provider, call.ok ? 1 : 0, call.error, call.tokens, call.latencyMs, call.at);
    },
    saveSkip(qid: string, reason: string) {
      db.prepare("INSERT OR REPLACE INTO prep_skips (qid, reason) VALUES (?, ?)").run(qid, reason);
    },
    startSegment(note: string): number {
      return Number(db.prepare("INSERT INTO segments (started_at, note) VALUES (?, ?)").run(new Date().toISOString(), note).lastInsertRowid);
    },
    endSegment(id: number) {
      db.prepare("UPDATE segments SET ended_at = ? WHERE id = ?").run(new Date().toISOString(), id);
    },
    close() { db.close(); },
  };
}

export type TrialStore = ReturnType<typeof openTrialStore>;
