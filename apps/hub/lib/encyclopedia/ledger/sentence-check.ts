import { FACTORY_EVIDENCE_FLOOR } from "../factory-research";
import { assessEvidenceUse } from "../source-license-policy";

/*
 * S9: the mechanical sentence check (hubpedia-ledger.md section 4).
 *
 * Every sentence of a composed body must carry a {c:<ledger_ref>} marker, and
 * a sentence survives only when each claim it cites passes all six rules
 * below, evaluated against the data as it is now, not as it was when the
 * claim was stored. A failing sentence is deleted, never repaired, and the
 * deletion is recorded with the rule that caused it. After the deletions the
 * article must still rest on the evidence floor (8 claims, 2 sources) or it is
 * not stored at all.
 *
 *   1. no marker
 *   2. a marker names a ref that was not in the claim set given to the writer
 *   3. the claim is not `supported`, was merged away, or is disputed/refuted
 *   4. the claim has no live `supports` evidence whose quote is still found
 *      verbatim in the chunk text (re-verified here, not trusted from storage)
 *   5. the source of every such quote no longer passes assessEvidenceUse
 *   6. a number in the sentence appears in neither the cited claims' statements
 *      nor their quotes
 *
 * This guarantees provenance. It does not guarantee that a sentence is a
 * faithful paraphrase of its claim; that is what human review is for.
 */

export const LEDGER_REF_PATTERN = /^[0-9a-hjkmnp-tv-z]{12}$/u;
const MARKER_PATTERN = /\{c:([^}]*)\}/gu;

export type LedgerSourceInfo = {
  url: string;
  title: string;
  publisher?: string | null;
  license?: string | null;
  sourceType?: string | null;
  reliabilityTier?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type LedgerEvidence = {
  chunkId: string;
  stance: string;
  quote: string | null;
  supersededAt: number | null;
  chunkText: string | null;
  source: LedgerSourceInfo;
};

export type LedgerClaim = {
  id: string;
  ledgerRef: string;
  statement: string;
  status: string;
  mergedIntoClaimId: string | null;
  knowledgeStatus: string | null;
  evidence: LedgerEvidence[];
};

export type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type DroppedUnit = { rule: RuleNumber; text: string; ref?: string };

export type ClaimVerdict =
  | { ok: true; usable: LedgerEvidence[] }
  | { ok: false; rule: 3 | 4 | 5 };

/** Rules 3, 4 and 5 for one claim. */
export function evaluateClaim(claim: LedgerClaim): ClaimVerdict {
  if (claim.status !== "supported" || claim.mergedIntoClaimId || claim.knowledgeStatus === "disputed" || claim.knowledgeStatus === "refuted") {
    return { ok: false, rule: 3 };
  }
  const verbatim = claim.evidence.filter((item) =>
    item.stance === "supports"
    && item.supersededAt === null
    && typeof item.quote === "string" && item.quote.length > 0
    && typeof item.chunkText === "string" && item.chunkText.includes(item.quote));
  if (verbatim.length === 0) return { ok: false, rule: 4 };
  const usable = verbatim.filter((item) => assessEvidenceUse({
    license: item.source.license, url: item.source.url, sourceType: item.source.sourceType,
    reliabilityTier: item.source.reliabilityTier, metadata: item.source.metadata,
  }).allowed);
  if (usable.length === 0) return { ok: false, rule: 5 };
  return { ok: true, usable };
}

/* ---- numbers (rule 6) ---- */

const KANJI_DIGITS = "〇一二三四五六七八九";

/** Arabic numbers in a text, comma-free. A run of two or more kanji digits (二〇二〇) is read positionally. */
export function extractNumbers(text: string): string[] {
  const normalized = text
    .normalize("NFKC")
    .replace(/\]\([^)]*\)/gu, "]")
    .replace(/https?:\/\/\S+/gu, " ")
    .replace(new RegExp(`[${KANJI_DIGITS}]{2,}`, "gu"), (run) => [...run].map((char) => KANJI_DIGITS.indexOf(char)).join(""))
    .replace(/(\d),(?=\d{3}\b)/gu, "$1");
  return [...normalized.matchAll(/\d+(?:\.\d+)?/gu)].map((match) => match[0]);
}

/* ---- markers ---- */

export function markersOf(text: string): string[] {
  const refs: string[] = [];
  for (const match of text.matchAll(MARKER_PATTERN)) {
    for (const ref of match[1].split(",")) {
      const trimmed = ref.trim();
      if (trimmed) refs.push(trimmed);
    }
  }
  return refs;
}

export function stripMarkers(text: string): string {
  return text.replace(MARKER_PATTERN, "");
}

/* ---- the check for one unit (a sentence, a bullet, an infobox value) ---- */

export type CheckContext = {
  claims: ReadonlyMap<string, LedgerClaim>;
  /** The refs the writer was given. A marker outside this set is rule 2. */
  allowedRefs: ReadonlySet<string>;
};

type UnitResult = { ok: true; refs: string[] } | { ok: false; rule: RuleNumber; ref?: string };

function checkUnit(text: string, context: CheckContext): UnitResult {
  const plain = stripMarkers(text).replace(/\s+/gu, "");
  const refs = [...new Set(markersOf(text))];
  if (!plain || refs.length === 0) return { ok: false, rule: 1 };
  for (const ref of refs) {
    if (!LEDGER_REF_PATTERN.test(ref) || !context.allowedRefs.has(ref) || !context.claims.has(ref)) return { ok: false, rule: 2, ref };
  }
  const known = new Set<string>();
  for (const ref of refs) {
    const claim = context.claims.get(ref)!;
    const verdict = evaluateClaim(claim);
    if (!verdict.ok) return { ok: false, rule: verdict.rule, ref };
    known.add(claim.statement);
    for (const item of verdict.usable) if (item.quote) known.add(item.quote);
  }
  const allowedNumbers = new Set(extractNumbers([...known].join("\n")));
  for (const number of extractNumbers(stripMarkers(text))) {
    if (!allowedNumbers.has(number)) return { ok: false, rule: 6 };
  }
  return { ok: true, refs };
}

/* ---- splitting a body into checkable units ---- */

const HEADING = /^(#{1,6})\s+\S/u;
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/u;
const LINK_ONLY_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[^\]]*\]\([^)]*\)[\s、,・]*)+$/u;
const TABLE_ROW = /^\s*\|/u;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/u;
const RULER = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u;

/** Sentences of one paragraph, each keeping its trailing terminator. */
export function splitSentences(paragraph: string): string[] {
  return [...paragraph.matchAll(/[^。！？]+[。！？]+[」』）)]*|[^。！？]+$/gu)]
    .map((match) => match[0])
    .filter((sentence) => sentence.trim().length > 0);
}

export type BodyCheck = {
  /** The body with failing units deleted; markers are still in place. */
  body: string;
  keptUnits: number;
  dropped: DroppedUnit[];
  /** Cited refs of the kept units, in order of first appearance. */
  citedRefs: string[];
};

export function checkLedgerBody(markdown: string, context: CheckContext): BodyCheck {
  const input = markdown.replace(/\r\n?/gu, "\n").split("\n");
  const out: string[] = [];
  const dropped: DroppedUnit[] = [];
  const cited: string[] = [];
  let kept = 0;
  let paragraph: string[] = [];

  const note = (text: string, result: Extract<UnitResult, { ok: false }>) =>
    dropped.push({ rule: result.rule, text: text.trim().slice(0, 160), ...(result.ref ? { ref: result.ref } : {}) });
  const take = (refs: string[]) => { kept += 1; for (const ref of refs) if (!cited.includes(ref)) cited.push(ref); };

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join("");
    paragraph = [];
    const survivors: string[] = [];
    for (const sentence of splitSentences(text)) {
      const result = checkUnit(sentence, context);
      if (result.ok) { survivors.push(sentence.trim()); take(result.refs); } else note(sentence, result);
    }
    if (survivors.length) out.push(survivors.join(""));
  };

  for (const line of input) {
    if (!line.trim()) { flushParagraph(); out.push(""); continue; }
    if (HEADING.test(line) || RULER.test(line) || LINK_ONLY_ITEM.test(line) || TABLE_RULE.test(line)) {
      flushParagraph(); out.push(line); continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item || TABLE_ROW.test(line)) {
      flushParagraph();
      const result = checkUnit(item ? item[3] : line, context);
      if (result.ok) { out.push(line); take(result.refs); } else note(line, result);
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();

  return { body: pruneEmptySections(out), keptUnits: kept, dropped, citedRefs: cited };
}

/** Headings left with no content, directly or in a subsection, are removed; blank runs are collapsed. */
function pruneEmptySections(lines: string[]): string {
  const levels = lines.map((line) => (HEADING.exec(line)?.[1].length ?? 0));
  const keep = lines.map(() => true);
  for (let index = 0; index < lines.length; index += 1) {
    if (levels[index] === 0) continue;
    let hasContent = false;
    for (let next = index + 1; next < lines.length; next += 1) {
      if (levels[next] > 0 && levels[next] <= levels[index]) break;
      if (levels[next] === 0 && lines[next].trim()) { hasContent = true; break; }
    }
    if (!hasContent) keep[index] = false;
  }
  const result: string[] = [];
  lines.forEach((line, index) => {
    if (!keep[index]) return;
    if (!line.trim() && (result.length === 0 || !result[result.length - 1].trim())) return;
    result.push(line);
  });
  while (result.length && !result[result.length - 1].trim()) result.pop();
  return result.join("\n");
}

/* ---- infobox rows ---- */

export type LedgerInfoboxRow = { label: string; value: string; cite: string[] };

export function checkLedgerInfobox(rows: readonly LedgerInfoboxRow[], context: CheckContext) {
  const kept: LedgerInfoboxRow[] = [];
  const dropped: DroppedUnit[] = [];
  const citedRefs: string[] = [];
  for (const row of rows) {
    const marked = `${row.value}${row.cite.length ? `{c:${row.cite.join(",")}}` : ""}`;
    const result = checkUnit(marked, context);
    if (result.ok) {
      kept.push({ ...row, value: stripMarkers(row.value) });
      for (const ref of result.refs) if (!citedRefs.includes(ref)) citedRefs.push(ref);
    } else {
      dropped.push({ rule: result.rule, text: `${row.label}: ${row.value}`.slice(0, 160), ...(result.ref ? { ref: result.ref } : {}) });
    }
  }
  return { rows: kept, dropped, citedRefs };
}

/* ---- the whole article, with the floor re-applied after deletion ---- */

export type ArticleCheck = {
  body: string;
  infobox: LedgerInfoboxRow[];
  dropped: DroppedUnit[];
  citedRefs: string[];
  sourceUrls: string[];
  /** For each source URL, how many distinct cited claims rest on it (input to evaluateLedgerGate). */
  claimsPerSource: number[];
  /** False when the surviving text no longer meets FACTORY_EVIDENCE_FLOOR; the article must not be stored. */
  storable: boolean;
  reasons: string[];
};

export function checkLedgerArticle(
  input: { bodyMarkdown: string; infobox?: readonly LedgerInfoboxRow[] },
  context: CheckContext,
  floor: { minimumClaims: number; minimumSourcesWithClaims: number } = FACTORY_EVIDENCE_FLOOR,
): ArticleCheck {
  const body = checkLedgerBody(input.bodyMarkdown, context);
  const infobox = checkLedgerInfobox(input.infobox ?? [], context);
  const citedRefs = [...body.citedRefs];
  for (const ref of infobox.citedRefs) if (!citedRefs.includes(ref)) citedRefs.push(ref);
  const sourceUrls: string[] = [];
  const perSource = new Map<string, number>();
  for (const ref of citedRefs) {
    const verdict = evaluateClaim(context.claims.get(ref)!);
    if (!verdict.ok) continue; // cannot happen for a kept unit; defensive
    const urls = new Set(verdict.usable.map((item) => item.source.url));
    for (const url of urls) {
      if (!sourceUrls.includes(url)) sourceUrls.push(url);
      perSource.set(url, (perSource.get(url) ?? 0) + 1);
    }
  }
  const reasons: string[] = [];
  if (citedRefs.length < floor.minimumClaims) reasons.push(`after deletion ${citedRefs.length} claims remain, need ${floor.minimumClaims}.`);
  if (sourceUrls.length < floor.minimumSourcesWithClaims) reasons.push(`after deletion ${sourceUrls.length} sources remain, need ${floor.minimumSourcesWithClaims}.`);
  return { body: body.body, infobox: infobox.rows, dropped: [...body.dropped, ...infobox.dropped], citedRefs, sourceUrls, claimsPerSource: [...perSource.values()], storable: reasons.length === 0, reasons };
}

/* ---- translation (S10): markers must survive paragraph by paragraph ---- */

const multisetKey = (text: string) => markersOf(text).sort().join(",");

/**
 * Pair paragraphs by position. A translated paragraph whose marker multiset differs from the Japanese one
 * (or that is missing) is dropped. Returns null when fewer than `minimumRatio` of the Japanese paragraphs survive.
 */
export function alignTranslation(japanese: string, english: string, minimumRatio = 0.8): { body: string; dropped: number; total: number } | null {
  const ja = japanese.replace(/\r\n?/gu, "\n").split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  const en = english.replace(/\r\n?/gu, "\n").split(/\n{2,}/u).map((part) => part.trim()).filter(Boolean);
  const kept: string[] = [];
  let dropped = 0;
  ja.forEach((paragraph, index) => {
    const translated = en[index];
    const isHeading = HEADING.test(paragraph);
    const matches = translated !== undefined && multisetKey(translated) === multisetKey(paragraph) && HEADING.test(translated) === isHeading;
    if (matches) kept.push(translated!); else dropped += 1;
  });
  if (ja.length === 0 || kept.length / ja.length < minimumRatio) return null;
  return { body: kept.join("\n\n"), dropped, total: ja.length };
}
