"use client";

import React from "react";

import styles from "./hubpedia-citations.module.css";

/* Citations returned by the AI Worker's hubpedia-answer tool (or by Hub retrieval when paid execution is off). */
export type HubpediaCitationStatus = "verified" | "needs_review" | "unverified";
export type HubpediaCitation = {
  n: number;
  id: string;
  kind: "claim" | "wikipedia";
  title: string;
  url: string;
  status: HubpediaCitationStatus;
  source: { url: string; publisher: string; quote?: string; historyUrl?: string; licence?: string };
  attribution?: string;
};

const STATUS_LABEL: Record<HubpediaCitationStatus, string> = { verified: "確認済み", needs_review: "要確認", unverified: "未検証" };

function safeHttp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null; } catch { return null; }
}

/** Narrows an unknown JSON value to citations; invalid entries are dropped, never rendered. */
export function readHubpediaCitations(value: unknown): HubpediaCitation[] {
  if (!Array.isArray(value)) return [];
  const out: HubpediaCitation[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) continue;
    const item = raw as Record<string, unknown>;
    const source = typeof item.source === "object" && item.source !== null ? item.source as Record<string, unknown> : null;
    const status = item.status === "verified" || item.status === "needs_review" || item.status === "unverified" ? item.status : null;
    const kind = item.kind === "claim" || item.kind === "wikipedia" ? item.kind : null;
    const url = safeHttp(item.url), sourceUrl = safeHttp(source?.url);
    if (!source || !status || !kind || !url || !sourceUrl || typeof item.n !== "number" || typeof item.id !== "string" || typeof item.title !== "string" || typeof source.publisher !== "string") continue;
    const historyUrl = safeHttp(source.historyUrl);
    out.push({
      n: item.n, id: item.id, kind, title: item.title, url, status,
      source: { url: sourceUrl, publisher: source.publisher, ...(typeof source.quote === "string" ? { quote: source.quote } : {}), ...(historyUrl ? { historyUrl } : {}), ...(typeof source.licence === "string" ? { licence: source.licence } : {}) },
      ...(typeof item.attribution === "string" ? { attribution: item.attribution } : {}),
    });
  }
  return out;
}

export function HubpediaCitations({ citations }: { citations: readonly HubpediaCitation[] }) {
  if (citations.length === 0) return null;
  return (
    <ol className={styles.list} aria-label="ハブペディアの根拠">
      {citations.map((citation) => (
        <li key={citation.id} value={citation.n} className={styles.item}>
          <div className={styles.head}>
            <span className={styles.number}>[{citation.n}]</span>
            <a href={citation.url} className={styles.title}>{citation.title}</a>
            <span className={`${styles.badge} ${styles[citation.status]}`}>{STATUS_LABEL[citation.status]}</span>
          </div>
          {citation.kind === "wikipedia" ? (
            <p className={styles.note}>
              {citation.attribution ?? "日本語版ウィキペディアより（CC BY-SA 4.0）。"}{" "}
              <a href={citation.source.url} target="_blank" rel="noreferrer">元の頁</a>
              {citation.source.historyUrl ? <>{" · "}<a href={citation.source.historyUrl} target="_blank" rel="noreferrer">編集履歴</a></> : null}
            </p>
          ) : (
            <p className={styles.note}>
              出典: <a href={citation.source.url} target="_blank" rel="noreferrer">{citation.source.publisher}</a>
              {citation.source.quote ? <q className={styles.quote}>{citation.source.quote}</q> : null}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
