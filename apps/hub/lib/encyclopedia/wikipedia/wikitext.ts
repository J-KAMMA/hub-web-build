/*
 * Japanese Wikipedia wikitext to clean text (docs/hubpedia-ledger.md, "Japanese Wikipedia base layer").
 *
 * The output is plain text with Markdown-style section headings ("## ", "### "), "- " list lines and blank-line
 * paragraphs. Templates, references, tables, files, categories, interlanguage links, HTML and magic words are
 * removed; the visible text of internal and external links is kept. It does not try to render wikitext, only to
 * keep the prose a reader would read.
 *
 * Bumping CONVERTER_VERSION makes the importer rewrite rows made by an older converter.
 */

export const CONVERTER_VERSION = 1;

/** Sections that hold references and navigation, not prose. Compared with all whitespace removed. */
const DROPPED_SECTIONS = new Set([
  "脚注", "注釈", "出典", "参考文献", "関連項目", "外部リンク", "参照", "注記", "脚注・出典", "注釈・出典", "出典・脚注", "脚注と出典",
  "脚注・参考文献", "参考資料", "関連文献", "関連書籍", "関連作品", "文献", "脚注・注釈", "注釈と出典", "脚注欄", "References", "Externallinks", "Seealso", "Notes",
]);

const DISAMBIGUATION = /\{\{\s*[^{}|]*(?:曖昧さ回避|aimai|disambig)[^{}|]*(?:\||\}\})/iu;
const DISAMBIGUATION_CATEGORY = /\[\[\s*(?:category|カテゴリ)\s*:\s*(?:曖昧さ回避|.*の曖昧さ回避)/iu;

export const isRedirectText = (wikitext: string) => /^\s*#(?:redirect|転送)(?=[\s:[]|$)/iu.test(wikitext);
export const isDisambiguationText = (wikitext: string) => DISAMBIGUATION.test(wikitext) || DISAMBIGUATION_CATEGORY.test(wikitext);

/* ---------- balanced scanning ---------- */

/** Splits at top-level "|" (not inside {{ }} or [[ ]]). */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let braces = 0;
  let brackets = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const two = text.slice(index, index + 2);
    if (two === "{{") { braces += 1; index += 1; }
    else if (two === "}}") { braces = Math.max(0, braces - 1); index += 1; }
    else if (two === "[[") { brackets += 1; index += 1; }
    else if (two === "]]") { brackets = Math.max(0, brackets - 1); index += 1; }
    else if (text[index] === "|" && braces === 0 && brackets === 0) { parts.push(text.slice(start, index)); start = index + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Finds the end index (after the closing token) of the construct opened at `from`, or -1 when unbalanced. */
function findClose(text: string, from: number, open: string, close: string): number {
  let depth = 0;
  for (let index = from; index < text.length; index += 1) {
    if (text.startsWith(open, index)) { depth += 1; index += open.length - 1; }
    else if (text.startsWith(close, index)) {
      depth -= 1;
      index += close.length - 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

/* ---------- templates ---------- */

const positional = (args: readonly string[]) =>
  args.map((arg) => arg.replace(/^\s*\d+\s*=/u, "")).filter((arg) => !/^\s*[^\s=\d{}[\]<>][^=]{0,30}=/u.test(arg) || /^\s*\d+\s*=/u.test(arg));

function keptTemplateText(name: string, args: readonly string[]): string | null {
  const key = name.toLowerCase().replace(/[\s_]+/gu, " ").trim();
  const plain = positional(args);
  if (key === "lang") return plain[1] ?? null;
  if (/^lang-[a-z-]+$/u.test(key)) return plain[0] ?? null;
  if (["ruby", "ルビ", "読み仮名", "ふりがな", "nowrap", "nobr", "small", "smaller", "小文字", "unicode", "仮リンク", "ill", "interlanguage link", "math", "nihongo", "lang-ja", "仮名", "r"].includes(key)) return plain[0] ?? null;
  if (key === "color" || key === "colour") return plain[1] ?? null;
  return null;
}

function stripTemplates(text: string, depth = 0): string {
  if (!text.includes("{{")) return text;
  let out = "";
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("{{", index);
    if (open < 0) { out += text.slice(index); break; }
    out += text.slice(index, open);
    if (text.startsWith("{{{", open)) {
      const closeParam = text.indexOf("}}}", open);
      index = closeParam < 0 ? open + 3 : closeParam + 3;
      continue;
    }
    const end = findClose(text, open, "{{", "}}");
    if (end < 0) { index = open + 2; continue; }
    const inner = text.slice(open + 2, end - 2);
    const parts = splitTopLevel(inner);
    const kept = depth < 8 ? keptTemplateText(parts[0].split(":")[0] ?? "", parts.slice(1)) : null;
    if (kept !== null) out += stripTemplates(kept.trim(), depth + 1);
    index = end;
  }
  return out;
}

/* ---------- links ---------- */

const FILE_PREFIX = /^\s*(?:file|image|media|ファイル|画像|メディア|category|カテゴリ)\s*:/iu;
const INTERWIKI = /^\s*[a-z]{2,3}(?:-[a-z]{2,10})?\s*:\s*\S/u;

function stripLinks(text: string): string {
  if (!text.includes("[[")) return text;
  let out = "";
  let index = 0;
  while (index < text.length) {
    const open = text.indexOf("[[", index);
    if (open < 0) { out += text.slice(index); break; }
    out += text.slice(index, open);
    const end = findClose(text, open, "[[", "]]");
    if (end < 0) { index = open + 2; continue; }
    const parts = splitTopLevel(text.slice(open + 2, end - 2));
    const target = parts[0];
    index = end;
    if (FILE_PREFIX.test(target) && !target.trimStart().startsWith(":")) continue;
    if (INTERWIKI.test(target) && !target.trimStart().startsWith(":")) continue;
    let display = parts.length > 1 ? parts[parts.length - 1] : target;
    if (parts.length > 1 && display.trim() === "") display = target.replace(/^\s*[:#]/u, "").replace(/\s*[(（][^)）]*[)）]\s*$/u, "");
    else if (parts.length === 1) display = display.replace(/^\s*:/u, "").replace(/^#/u, "");
    out += stripLinks(display);
  }
  return out;
}

/* ---------- inline cleanup ---------- */

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", ndash: "–", mdash: "—", times: "×", minus: "−" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isSafeInteger(code) && code > 8 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function stripBlockTags(text: string): string {
  let result = text.replace(/<!--[\s\S]*?(?:-->|$)/gu, "");
  result = result.replace(/<nowiki\s*>([\s\S]*?)<\/nowiki\s*>/giu, "$1");
  result = result.replace(/<ref\b[^>]*\/\s*>/giu, "");
  const lower = result.toLowerCase();
  for (const tag of ["ref", "gallery", "imagemap", "timeline", "graph", "mapframe", "maplink", "templatedata", "noinclude", "syntaxhighlight", "source", "pre", "score"]) {
    if (!lower.includes(`<${tag}`)) continue;
    result = result.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?(?:</${tag}\\s*>|$)`, "giu"), "");
  }
  /* Ruby keeps the base text only. */
  if (lower.includes("<rt") || lower.includes("<rp")) result = result.replace(/<rt\b[^>]*>[\s\S]*?<\/rt\s*>/giu, "").replace(/<rp\b[^>]*>[\s\S]*?<\/rp\s*>/giu, "");
  /* Math and chemistry keep their source text inline. */
  if (lower.includes("<math") || lower.includes("<chem")) result = result.replace(/<(math|chem)\b[^>]*>([\s\S]*?)<\/\1\s*>/giu, (_whole, _tag: string, body: string) => ` ${body.replace(/\\displaystyle\s*/gu, "").replace(/\s+/gu, " ").trim()} `);
  return result;
}

function stripTables(text: string): string {
  if (!text.includes("{|")) return text;
  const out: string[] = [];
  let depth = 0;
  for (const line of text.split("\n")) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith("{|")) { depth += 1; continue; }
    if (depth > 0) {
      if (trimmed.startsWith("|}")) depth -= 1;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

function cleanInline(line: string): string {
  let result = stripLinks(line);
  result = result.replace(/\[(?:https?:)?\/\/[^\s\]]+\s+([^\]]*)\]/gu, "$1").replace(/\[(?:https?:)?\/\/[^\s\]]+\]/gu, "");
  result = result.replace(/https?:\/\/\S+/gu, "");
  result = result.replace(/<br\s*\/?>/giu, " ").replace(/<\/?[a-z][^>\n]*>/giu, "");
  result = result.replace(/'{2,5}/gu, "");
  result = decodeEntities(result);
  result = result.replace(/__[A-Z]+__/gu, "");
  return result;
}

const sectionKey = (title: string) => title.replace(/[\s　]+/gu, "");

/** Converts wikitext to clean text with "## " section headings. */
export function wikitextToPlain(wikitext: string): string {
  let text = wikitext.replace(/\r\n?/gu, "\n");
  text = stripBlockTags(text);
  text = stripTemplates(text);
  text = stripTables(text);

  const lines: string[] = [];
  let skipLevel = 0;
  for (const raw of text.split("\n")) {
    const heading = /^(={2,6})\s*(.+?)\s*\1\s*$/u.exec(raw);
    if (heading) {
      const level = heading[1].length;
      const title = cleanInline(heading[2]).trim();
      if (skipLevel > 0 && level <= skipLevel) skipLevel = 0;
      if (skipLevel > 0) continue;
      if (DROPPED_SECTIONS.has(sectionKey(title))) { skipLevel = level; continue; }
      if (title) lines.push("", `${"#".repeat(level)} ${title}`, "");
      continue;
    }
    if (skipLevel > 0) continue;
    if (/^-{4,}\s*$/u.test(raw)) continue;
    const list = /^([*#:;]+)\s*(.*)$/u.exec(raw);
    if (list) {
      const body = cleanInline(list[2]).trim();
      if (!body) continue;
      const marker = list[1][0];
      lines.push(marker === "*" ? `- ${body}` : marker === "#" ? `1. ${body}` : body);
      continue;
    }
    const cleaned = cleanInline(raw).trim();
    /* Leftover table-row syntax from tables the line scanner did not see start. */
    if (/^(?:\|-|\|\}|\{\||!\s|\|\s)/u.test(cleaned) && !/[。．]/u.test(cleaned)) continue;
    lines.push(cleaned);
  }

  let result = lines.join("\n");
  /* Parentheses emptied by removed templates, references or ruby. */
  result = result.replace(/[（(][\s、,，;；・]*[）)]/gu, "");
  result = result.replace(/[ \t　]+\n/gu, "\n").replace(/[ \t]{2,}/gu, " ").replace(/\s+([。、，．])/gu, "$1");
  /* A heading with nothing under it is dropped. */
  result = result.replace(/^#{2,6} [^\n]*\n+(?=#{2,6} |(?![\s\S]))/gmu, "");
  result = result.replace(/\n{3,}/gu, "\n\n").trim();
  return result;
}

/** First prose paragraph, trimmed to `limit` characters. */
export function leadSummary(plain: string, limit = 200): string {
  for (const paragraph of plain.split(/\n\n+/u)) {
    const text = paragraph.trim();
    if (!text || text.startsWith("#") || text.startsWith("- ") || text.length < 20) continue;
    const chars = [...text];
    return chars.length <= limit ? text : `${chars.slice(0, limit - 1).join("")}…`;
  }
  return "";
}
