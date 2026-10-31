import type { D1Database } from "@cloudflare/workers-types";

import { renderCommercialSourceSection } from "../source-license-policy";
import type { LedgerObjectStore } from "./object-store";
import { loadRevisionClaims } from "./store";
import { LEDGER_STUB_NOTICE } from "./topics";
import { checkLedgerBody, evaluateClaim, type LedgerClaim, type LedgerSourceInfo } from "./sentence-check";

/*
 * Rendering a stored ledger body for readers. The stored text keeps its
 * {c:<ledger_ref>} markers; this turns them into [n] footnotes that point at
 * the numbered source list, and it never shows a sentence it cannot verify:
 * the S9 check runs again here against the claims as they are now, so a
 * claim disputed, merged or stripped of evidence after storage removes its
 * sentences from the page at the next read, without waiting for regeneration.
 */

export type LedgerRender = {
  /** Body with [n] footnotes and no source section (the page lists sources itself). */
  bodyMarkdown: string;
  /** Same body followed by a "## 出典" section generated from `sources` (numbers match the footnotes). */
  markdownWithSources: string;
  /** Sources in order of first appearance; the position is the footnote number. */
  sources: LedgerSourceInfo[];
  /** Units removed because they no longer verify. */
  droppedUnits: number;
  /** Set for a stub revision: the page says so at the top of the body. */
  notice?: string;
};

const LEFTOVER_MARKER = /\{c:[^}\n]*\}?/gu;

export function renderLedgerMarkdown(storedBody: string, claims: readonly LedgerClaim[]): LedgerRender {
  const byRef = new Map(claims.map((claim) => [claim.ledgerRef, claim]));
  const checked = checkLedgerBody(storedBody, { claims: byRef, allowedRefs: new Set(byRef.keys()) });

  const sources: LedgerSourceInfo[] = [];
  const numberByUrl = new Map<string, number>();
  const numbersFor = (refs: readonly string[]) => {
    const numbers = new Set<number>();
    for (const ref of refs) {
      const claim = byRef.get(ref);
      const verdict = claim ? evaluateClaim(claim) : null;
      if (!verdict?.ok) continue;
      for (const item of verdict.usable) {
        let number = numberByUrl.get(item.source.url);
        if (number === undefined) {
          number = sources.push(item.source);
          numberByUrl.set(item.source.url, number);
        }
        numbers.add(number);
      }
    }
    return [...numbers].sort((left, right) => left - right);
  };

  /* Brackets the writer typed themselves must not be taken for footnotes. */
  const escaped = checked.body.replace(/\[(\d+)\]/gu, "\\[$1\\]");
  const withFootnotes = escaped.replace(/\{c:([^}]*)\}([。！？]?)/gu, (_match, list: string, terminator: string) =>
    `${terminator}${numbersFor(list.split(",").map((ref) => ref.trim()).filter(Boolean)).map((n) => `[${n}]`).join("")}`);
  const bodyMarkdown = withFootnotes.replace(LEFTOVER_MARKER, "").trim();

  const urlByNumber = new Map(sources.map((source, index) => [index + 1, source.url]));
  const markdownWithSources = renderCommercialSourceSection(
    bodyMarkdown,
    sources.map((source) => ({ ...source, url: source.url, title: source.title })),
    urlByNumber,
  );
  return { bodyMarkdown, markdownWithSources, sources, droppedUnits: checked.dropped.length };
}

/** Marker-free text for places that cannot show footnotes (summaries, search snippets). Verified units only. */
export function renderLedgerPlainText(storedBody: string, claims: readonly LedgerClaim[]): string {
  return renderLedgerMarkdown(storedBody, claims).bodyMarkdown.replace(/\[\d+\]/gu, "");
}

/**
 * The single call the article page makes. Returns null when the body cannot be rendered safely
 * (claims unreadable, or nothing verifiable is left); the caller must then show no body.
 */
export async function renderLedgerRevision(db: D1Database, revisionId: string, storedBody: string, objects?: LedgerObjectStore): Promise<LedgerRender | null> {
  let claims: LedgerClaim[];
  try {
    claims = await loadRevisionClaims(db, revisionId, objects);
  } catch {
    return null;
  }
  const rendered = renderLedgerMarkdown(storedBody, claims);
  if (!rendered.bodyMarkdown.trim()) return null;
  /* A stub says what it is at the top of the page, in the reader's words. */
  let stub = false;
  try {
    const row = await db.prepare("SELECT generation_metadata AS metadata FROM encyclopedia_article_revisions WHERE id = ?").bind(revisionId).first<{ metadata: string | null }>();
    stub = (JSON.parse(row?.metadata ?? "{}") as { stub?: unknown }).stub === true;
  } catch { /* an unreadable flag shows no notice, never hides the body */ }
  if (!stub) return rendered;
  const notice = `> ${LEDGER_STUB_NOTICE}

`;
  return { ...rendered, bodyMarkdown: notice + rendered.bodyMarkdown, markdownWithSources: notice + rendered.markdownWithSources, notice: LEDGER_STUB_NOTICE };
}
