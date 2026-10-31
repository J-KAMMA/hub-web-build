import type { D1Database } from "@cloudflare/workers-types";

import { ChainExhaustedError, type ChainCall } from "../provider-chain";
import type { FetchedPage } from "./ingest";

/*
 * TEST-ONLY. Deterministic fake model answers, fake pages and a fake term net for measuring and testing the
 * unattended runner without a network or a paid provider. Nothing here is reachable unless a script is started
 * with --stub. The answers are shaped like the real contracts, so every local stage (hygiene, verbatim check,
 * dedupe, sentence check, translation alignment, storage) runs for real.
 */

export const STUB_MODEL_NAME = "stub";

type StubOptions = {
  /** Simulated model latency per call (ms). Default 0. */
  latencyMs?: number;
  /** Throw ChainExhaustedError once this many calls have been served (for stop tests). */
  exhaustAfterCalls?: number;
};

export function createStubModel(options: StubOptions = {}) {
  let calls = 0;
  const complete = async (call: ChainCall): Promise<{ output: unknown; servedBy: string; tokens: number }> => {
    if (options.exhaustAfterCalls !== undefined && calls >= options.exhaustAfterCalls) throw new ChainExhaustedError(null);
    calls += 1;
    if (options.latencyMs) await new Promise((resolve) => setTimeout(resolve, options.latencyMs));
    const payload = JSON.parse(call.prompt) as Record<string, unknown>;
    return { output: answer(call.stage ?? "extract", payload), servedBy: "stub", tokens: 100 };
  };
  return { complete, get calls() { return calls; } };
}

function answer(stage: string, payload: Record<string, unknown>): unknown {
  if (stage === "judge") return { verdict: "distinct" };
  if (stage === "compose") {
    const claims = (payload.claims as Array<{ ref: string; statement: string }>) ?? [];
    const lines = claims.map((claim) => `${claim.statement.replace(/。+$/u, "")}{c:${claim.ref}}。`);
    const names = ["概要", "特徴", "記録", "背景"];
    const size = Math.max(1, Math.ceil(lines.length / names.length));
    return { bodyMarkdown: names.map((name, index) => `## ${name}\n\n${lines.slice(index * size, (index + 1) * size).join("")}`).join("\n\n") };
  }
  if (stage === "translate") return { title: String(payload.title ?? "Title"), bodyMarkdown: String(payload.bodyMarkdown ?? "") };
  const excerpt = String(payload.excerpt ?? "");
  const sentences = excerpt.split(/(?<=。)/u).map((sentence) => sentence.trim()).filter((sentence) => sentence.length >= 20);
  return {
    claims: sentences.map((sentence) => ({
      statement: sentence,
      confidence: 0.9,
      topics: [],
      evidence: [{ quote: sentence.replace(/。$/u, "") }],
    })),
  };
}

const FACETS = ["人口", "面積", "標高", "気温", "降水量", "産業", "交通", "歴史", "言語", "教育", "財政", "貿易"];

/** A page of ~2,000 characters in which every sentence names the topic, with sentence-distinct numbers and facets. */
export function stubPageText(name: string, variant: number): string {
  const sentences: string[] = [`${name}は、${variant + 1}番目の調査報告で扱われた対象である。`];
  for (let index = 0; index < 18; index += 1) {
    const facet = FACETS[(index + variant * 5) % FACETS.length];
    const value = 1000 + ((index + 1) * 37 + variant * 211) % 9000;
    sentences.push(`${name}の${facet}は${2000 + ((index * 7 + variant) % 25)}年の調査で${value}と記録され、${facet}の項目ごとに${index + 3}回の確認が行われた。`);
  }
  return sentences.join("");
}

export function stubFetchPage(delayMs = 0) {
  return async (url: string): Promise<FetchedPage> => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const match = /\/stub-([a-z0-9]+)-(\d+)$/u.exec(url);
    const name = match ? stubTopicName(match[1]) : "標本";
    return { url, mimeType: "text/html", text: stubPageText(name, Number(match?.[2] ?? 0)), title: `${name} 報告 ${match?.[2] ?? 0}`, language: "ja", publishedAt: null, authors: [], headings: [] };
  };
}

/** Topic names are Japanese so the headword matcher (2+ CJK characters) can see them in a claim sentence. */
export const stubTopicName = (key: string) => `標本${key.replace(/[^a-z0-9]/gu, "")}号`;
export const stubTopicUrls = (key: string) => [0, 1].map((variant) => `https://ourworldindata.org/stub-${key}-${variant}`);

/** Inserts a snapshot row and `count` term-net topics ranked 1..count (hops 0). Topics are keyed t1..tN. */
export async function seedStubTermNet(db: D1Database, count: number) {
  await db.prepare("INSERT OR IGNORE INTO hubpedia_term_snapshots (id, sha256, retrieved_at, term_count, edge_count, params_json, loaded_at) VALUES ('stub-snap', 'stub', '2026-10-30', ?, 0, '{}', 1)").bind(count).run();
  for (let index = 1; index <= count; index += 1) {
    const key = `t${index}`;
    const id = `stub-topic-${key}`;
    await db.prepare("INSERT OR IGNORE INTO encyclopedia_topics (id, canonical_name, slug, topic_type, status, created_at, updated_at) VALUES (?, ?, ?, 'concept', 'proposed', 1, 1)")
      .bind(id, stubTopicName(key), `stub-${key}`).run();
    await db.prepare("INSERT OR IGNORE INTO hubpedia_terms (id, qid, slug, label_ja, topic_id, hops, priority_rank, linkable, snapshot_id, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, 1, 'stub-snap', 1)")
      .bind(`stub-term-${key}`, `QSTUB${index}`, `stub-${key}`, stubTopicName(key), id, index).run();
  }
}
