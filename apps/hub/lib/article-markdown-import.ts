import { normalizeArticleTags, safeArticleLink } from "@/lib/article-body";

/**
 * Markdown を Hub の記事本文（lib/article-body.ts の文法）へ変換する。純関数。
 *
 * 方針:
 * - 通すのは Hub の本文が持つ記法だけ。見出し(##/###)・段落・箇条書き・引用・コード・区切り線・
 *   強調・斜体・リンクのみ。表は等幅のコードブロックにして崩さない。
 * - 生のHTMLは取り除き、文字だけを残す（script/style/コメントは中身ごと捨てる）。コードの中は触らない。
 * - 外部の画像は取り込まない（Hubは自分でアップロードした画像だけを使う）。リンク1行に置き換え、
 *   数を返す。リンク先は http(s) か Hub内の絶対パスだけ。javascript: や data: は文字だけ残す。
 * - 結果は articleBlocks で再解析しても、画像・埋め込みになるのは著者が書いたYouTubeのURL行だけ。
 */

export const MARKDOWN_IMPORT_MAX_BYTES = 1024 * 1024;
export const MARKDOWN_IMPORT_TITLE_MAX = 120;
export const MARKDOWN_IMPORT_SUMMARY_MAX = 400;
export const MARKDOWN_IMPORT_BODY_MAX = 100_000;
const LINE_MAX = 10_000;
const LINK_TEXT_MAX = 200;

export type MarkdownImportOptions = {
  /** 題が空のとき true。最初の `# 見出し`（と front matter の title）を題として取り出す。 */
  useTitle?: boolean;
};

export type MarkdownImportResult = {
  title: string;
  summary: string;
  tags: string[];
  body: string;
  /** リンク1行に置き換えた外部画像の数（Hubへ上げ直しが要る）。 */
  images: number;
  /** コードブロックにした表の数。 */
  tables: number;
  /** HTMLのタグ・コメント・script/style を取り除いたか。 */
  htmlRemoved: boolean;
  /** 安全でないため文字だけにしたリンクの数。 */
  droppedLinks: number;
  /** 長すぎる行を切った数。 */
  longLines: number;
  /** 本文が上限を超えたため後ろを切ったか。 */
  truncated: boolean;
};

type Heading = { kind: "heading"; level: number; text: string };
type Piece = string | Heading;

type Stats = { images: number; tables: number; htmlRemoved: boolean; droppedLinks: number; longLines: number };

const ESC = "\uE000";
const LOOKALIKE: Record<string, string> = { "*": "＊", "`": "｀", "[": "［", "]": "］", "#": "＃", ">": "＞", "-": "－", "+": "＋" };

/* ---------- front matter ---------- */

type FrontMatter = { title: string; description: string; tags: string[] };

function unquote(value: string): string {
  const text = value.trim();
  const quote = text[0];
  if ((quote === '"' || quote === "'") && text.length >= 2 && text.endsWith(quote)) {
    return text.slice(1, -1).replace(/\\(["'\\])/gu, "$1");
  }
  return text.replace(/\s+#.*$/u, "").trim();
}

function parseFrontMatter(lines: string[]): { data: FrontMatter; rest: string[] } {
  const none = { data: { title: "", description: "", tags: [] }, rest: lines };
  if (lines[0]?.trim() !== "---") return none;
  let end = -1;
  for (let i = 1; i < Math.min(lines.length, 200); i += 1) {
    if (/^(?:---|\.\.\.)\s*$/u.test(lines[i])) { end = i; break; }
  }
  if (end < 0) return none;
  const data: FrontMatter = { title: "", description: "", tags: [] };
  let collecting: "tags" | null = null;
  for (const raw of lines.slice(1, end)) {
    const item = collecting && /^\s+-\s+(.*)$/u.exec(raw);
    if (item) { data.tags.push(unquote(item[1])); continue; }
    const pair = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/u.exec(raw);
    if (!pair) { if (raw.trim()) collecting = null; continue; }
    collecting = null;
    const key = pair[1].toLowerCase();
    const value = pair[2].trim();
    if (key === "title") data.title = unquote(value);
    else if (key === "description") data.description = unquote(value);
    else if (key === "tags") {
      if (!value) collecting = "tags";
      else if (value.startsWith("[") && value.endsWith("]")) data.tags.push(...value.slice(1, -1).split(",").map(unquote));
      else data.tags.push(...value.split(",").map(unquote));
    }
  }
  data.tags = data.tags.map((tag) => tag.replace(/^#+/u, "").trim()).filter(Boolean);
  return { data, rest: lines.slice(end + 1) };
}

/* ---------- inline ---------- */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d{1,6}|#x[0-9a-f]{1,5});/giu, (whole, name: string) => {
    const lower = name.toLowerCase();
    if (lower in ENTITIES) return ENTITIES[lower];
    const code = lower.startsWith("#x") ? Number.parseInt(lower.slice(2), 16) : Number.parseInt(lower.slice(1), 10);
    return code > 31 && code < 0x110000 && !(code >= 0xd800 && code < 0xe000) ? String.fromCodePoint(code) : whole;
  });
}

function oneLine(text: string): string {
  return text.replace(/\s+/gu, " ").trim();
}

function linkText(text: string): string {
  const cleaned = oneLine(text.replace(/[[\]]/gu, ""));
  return Array.from(cleaned).slice(0, LINK_TEXT_MAX).join("");
}

function normalizeUrl(raw: string): string | null {
  const url = raw.trim().replace(/^<|>$/gu, "");
  if (!url) return null;
  const safe = safeArticleLink(url);
  if (!safe) return null;
  return safe.href.replaceAll("(", "%28").replaceAll(")", "%29").replace(/\s/gu, "%20");
}

type Refs = Map<string, string>;

/** `![alt](url "title")` / `![alt][ref]` の取り出し用。 */
const IMAGE_RE = /!\[([^\]\n]*)\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\)){0,2100})(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/gu;
const LINK_RE = /\[([^\]\n]{1,400})\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\)){0,2100})(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/gu;

function inlineSegment(source: string, refs: Refs, stats: Stats): string {
  let text = source;

  // バックスラッシュのエスケープ。Hubにはエスケープが無いので、記号が働かないよう字形の近い全角へ寄せる。
  text = text.replace(/\\([\\`*_{}[\]()#+\-.!>~|<])/gu, (_whole, ch: string) => `${ESC}${ch}${ESC}`);

  // script / style は中身ごと、コメントも捨てる。
  const before = text;
  text = text
    .replace(/<!--[\s\S]*?-->/gu, "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/giu, "");
  if (text !== before) stats.htmlRemoved = true;

  // 自動リンク <https://…>
  text = text.replace(/(?<!\]\()<(https?:\/\/[^\s<>]+)>/giu, (_whole, url: string) => {
    const safe = normalizeUrl(url);
    return safe ? `[${linkText(safe)}](${safe})` : "";
  });

  // HTMLの <img>。画像は取り込まないので、リンクへ置き換える。
  text = text.replace(/<img\b[^>]*>/giu, (tag) => {
    const src = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(tag);
    const alt = /\salt\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(tag);
    stats.images += 1;
    stats.htmlRemoved = true;
    const url = normalizeUrl(decodeEntities(src?.[1] ?? src?.[2] ?? src?.[3] ?? ""));
    const label = linkText(decodeEntities(alt?.[1] ?? alt?.[2] ?? alt?.[3] ?? ""));
    return url ? `[画像${label ? `: ${label}` : ""}](${url})` : `（画像${label ? `: ${label}` : ""}）`;
  });

  // 残りのタグは外して文字を残す。
  text = text.replace(/<br\s*\/?>/giu, " ").replace(/(?<!\]\()<\/?[A-Za-z][^<>\n]*>/gu, () => { stats.htmlRemoved = true; return ""; });

  // 画像をリンクの中に置いた形 [![alt](img)](href) は、外側のリンクだけを残す。
  text = text.replace(/\[\s*!\[([^\]\n]*)\]\((?:<[^>\n]*>|(?:[^()\s]|\([^()\s]*\)){0,2100})(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)\s*\]\((<[^>\n]*>|(?:[^()\s]|\([^()\s]*\)){0,2100})(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\)/gu, (_whole, alt: string, href: string) => {
    stats.images += 1;
    const url = normalizeUrl(href);
    const label = linkText(alt);
    return url ? `[画像${label ? `: ${label}` : ""}](${url})` : `（画像${label ? `: ${label}` : ""}）`;
  });

  // 画像 → リンク
  text = text.replace(IMAGE_RE, (_whole, alt: string, src: string) => {
    stats.images += 1;
    const url = normalizeUrl(src);
    const label = linkText(alt);
    return url ? `[画像${label ? `: ${label}` : ""}](${url})` : `（画像${label ? `: ${label}` : ""}）`;
  });
  text = text.replace(/!\[([^\]\n]*)\]\[([^\]\n]*)\]/gu, (_whole, alt: string, id: string) => {
    stats.images += 1;
    const url = refs.get((id || alt).toLowerCase());
    const safe = url ? normalizeUrl(url) : null;
    const label = linkText(alt);
    return safe ? `[画像${label ? `: ${label}` : ""}](${safe})` : `（画像${label ? `: ${label}` : ""}）`;
  });

  // 参照形式のリンク
  text = text.replace(/\[([^\]\n]{1,400})\]\[([^\]\n]*)\]/gu, (whole, label: string, id: string) => {
    const url = refs.get((id || label).toLowerCase());
    if (!url) return whole;
    return `[${label}](${url})`;
  });

  // リンク。安全な宛先だけ残し、それ以外は文字だけにする。
  text = text.replace(LINK_RE, (_whole, label: string, href: string) => {
    const url = normalizeUrl(href);
    const shown = linkText(label.replace(/\*\*|__|~~/gu, ""));
    if (!url || !shown) { stats.droppedLinks += url ? 0 : 1; return shown || label; }
    return `[${shown}](${url})`;
  });

  // 取り消し線は記号だけ外す。
  text = text.replace(/~~(?=\S)([^~\n]+?)(?<=\S)~~/gu, "$1");

  // 強調: __x__ → **x**、_x_ → *x*（語の途中のアンダースコアは触らない）。
  text = text
    .replace(/(?<![\p{L}\p{N}_])__(?=\S)([^_\n]+?)(?<=\S)__(?![\p{L}\p{N}_])/gu, "**$1**")
    .replace(/(?<![\p{L}\p{N}_])_(?=\S)([^_\n]+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, "*$1*");

  return decodeEntities(text);
}

/** 1行（または段落）の文字列を、コードスパンを守りながら変換する。 */
function convertInline(source: string, refs: Refs, stats: Stats): string {
  const parts: string[] = [];
  let i = 0;
  let plain = "";
  while (i < source.length) {
    if (source[i] === "`" && !(i > 0 && source[i - 1] === "\\")) {
      let run = 1;
      while (source[i + run] === "`") run += 1;
      const fence = "`".repeat(run);
      const end = source.indexOf(fence, i + run);
      if (end > i + run) {
        const inner = source.slice(i + run, end).replaceAll("`", "").replace(/^\s+|\s+$/gu, " ").trim();
        if (plain) { parts.push(inlineSegment(plain, refs, stats)); plain = ""; }
        parts.push(inner ? `\`${inner}\`` : "");
        i = end + run;
        continue;
      }
      plain += source.slice(i, i + run);
      i += run;
      continue;
    }
    plain += source[i];
    i += 1;
  }
  if (plain) parts.push(inlineSegment(plain, refs, stats));
  return parts.join("");
}

/** エスケープの印を実際の文字へ戻す。行頭でブロック記号になる文字だけ全角へ寄せる。 */
function finishEscapes(text: string): string {
  return text.split("\n").map((line) => {
    if (!line.includes(ESC)) return line;
    let out = "";
    const pieces = line.split(ESC);
    // pieces: text, char, text, char, ...
    for (let index = 0; index < pieces.length; index += 1) {
      if (index % 2 === 0) { out += pieces[index]; continue; }
      const ch = pieces[index];
      const atStart = out.trim() === "";
      const structural = ch === "*" || ch === "`" || ch === "[" || ch === "]";
      const lead = atStart && (ch === "#" || ch === ">" || ch === "-" || ch === "+");
      out += (structural || lead) && LOOKALIKE[ch] ? LOOKALIKE[ch] : ch;
    }
    return out;
  }).join("\n");
}

function plainText(markdown: string): string {
  return oneLine(markdown
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, "$1")
    .replace(/(\*\*|__|~~|`)/gu, "")
    .replace(/(?<![\p{L}\p{N}])[*_]|[*_](?![\p{L}\p{N}])/gu, ""));
}

/* ---------- block ---------- */

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/u;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/u;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/u;
const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/u;
const TABLE_ROW = /^\s*\|.*\|\s*$/u;
const REF_DEF = /^ {0,3}\[([^\]\n^][^\]\n]*)\]:\s*(<[^>\n]+>|\S+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*$/u;

function joinSoft(lines: string[]): string {
  let out = "";
  for (const line of lines) {
    if (!out) { out = line; continue; }
    if (/(?: {2,}|\\)$/u.test(out)) { out = `${out.replace(/(?: {2,}|\\)$/u, "")}\n${line}`; continue; }
    const soft = out.replace(/ +$/u, "");
    const cjk = /[　-鿿＀-￯]$/u.test(soft) && /^[　-鿿＀-￯]/u.test(line);
    out = `${soft}${cjk ? "" : " "}${line}`;
  }
  return out.replace(/(?: {2,}|\\)$/u, "");
}

const ZERO_WIDTH = String.fromCharCode(0x200b);

/** 「```」だけの行はHubの本文でコードブロックを閉じてしまうので、見えない文字を挟む。 */
function guardFence(line: string): string {
  return line.trim() === "```" ? line.replace("```", "`" + ZERO_WIDTH + "``") : line;
}

function capLine(line: string, stats: Stats): string {
  if (line.length <= LINE_MAX) return line;
  stats.longLines += 1;
  return Array.from(line).slice(0, LINE_MAX).join("");
}

export function importMarkdown(source: string, options: MarkdownImportOptions = {}): MarkdownImportResult {
  const stats: Stats = { images: 0, tables: 0, htmlRemoved: false, droppedLinks: 0, longLines: 0 };
  const text = source.replace(/^\uFEFF/u, "").replaceAll("\r\n", "\n").replaceAll("\r", "\n").replace(/\u0000/gu, "");
  const front = parseFrontMatter(text.split("\n"));
  const lines = front.rest;

  // 参照定義を先に集める（コードの外だけ）。
  const refs: Refs = new Map();
  const isDefinition = new Array<boolean>(lines.length).fill(false);
  {
    let fence: string | null = null;
    lines.forEach((line, index) => {
      const open = FENCE_OPEN.exec(line);
      if (fence) { if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !open[2]) fence = null; return; }
      if (open) { fence = open[1]; return; }
      const def = REF_DEF.exec(line);
      if (def) { refs.set(def[1].toLowerCase(), def[2].replace(/^<|>$/gu, "")); isDefinition[index] = true; }
    });
  }

  const pieces: Piece[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let table: string[] = [];
  let code: { fence: string; lang: string; lines: string[] } | null = null;
  let skip: "comment" | "script" | "style" | null = null;
  let afterBlank = true;

  const inline = (value: string) => convertInline(value, refs, stats);
  const flushPara = () => {
    if (!para.length) return;
    pieces.push(joinSoft(para.map(inline)));
    para = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    pieces.push(quote.map((line) => (line ? `> ${inline(line)}` : ">")).join("\n"));
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    let n = 0;
    pieces.push(list.items.map((item) => (list!.ordered ? `${(n += 1)}. ${item}` : `- ${item}`)).join("\n"));
    list = null;
  };
  const flushTable = () => {
    if (!table.length) return;
    stats.tables += 1;
    pieces.push(`\`\`\`\n${table.map((row) => capLine(guardFence(row.trim()), stats)).join("\n")}\n\`\`\``);
    table = [];
  };
  const flushAll = () => { flushList(); flushQuote(); flushTable(); flushPara(); };
  const pushHeading = (level: number, raw: string) => {
    const converted = oneLine(inline(raw));
    if (converted) pieces.push({ kind: "heading", level, text: converted });
  };
  const closeCode = () => {
    if (!code) return;
    const lang = /^[A-Za-z0-9_+#.-]{1,20}$/u.test(code.lang) ? code.lang : "";
    pieces.push(`\`\`\`${lang}\n${code.lines.join("\n")}${code.lines.length ? "\n" : ""}\`\`\``);
    code = null;
  };

  /** HTMLコメント・script・style を行の中から外す。複数行にまたがる分は skip に持ち越す。 */
  const stripBlocks = (line: string): string => {
    let rest = line;
    let out = "";
    for (let guard = 0; guard < 200; guard += 1) {
      if (skip) {
        const closer = skip === "comment" ? /-->/u : new RegExp(`</${skip}\\s*>`, "iu");
        const match = closer.exec(rest);
        if (!match) return out;
        rest = rest.slice(match.index + match[0].length);
        skip = null;
        continue;
      }
      const start = /<!--|<(script|style)\b/iu.exec(rest);
      if (!start) return out + rest;
      out += rest.slice(0, start.index);
      rest = rest.slice(start.index + (start[0] === "<!--" ? 4 : start[0].length));
      skip = start[0] === "<!--" ? "comment" : (start[1].toLowerCase() as "script" | "style");
      stats.htmlRemoved = true;
    }
    return out;
  };

  lines.forEach((rawLine, index) => {
    if (code) {
      const close = FENCE_OPEN.exec(rawLine);
      if (close && close[1][0] === code.fence[0] && close[1].length >= code.fence.length && !close[2] && rawLine.trim() === close[1]) { closeCode(); afterBlank = false; return; }
      code.lines.push(capLine(guardFence(rawLine.trimEnd()), stats));
      return;
    }
    if (isDefinition[index] && !skip) return;

    const open = skip ? null : FENCE_OPEN.exec(rawLine);
    if (open) {
      flushAll();
      code = { fence: open[1], lang: open[2], lines: [] };
      return;
    }

    const stripped = capLine(stripBlocks(rawLine), stats);
    const line = stripped.replace(/\t/gu, "    ");
    const trimmed = line.trim();

    if (!trimmed) {
      if (rawLine.trim() !== "") return; // コメントやscriptだけの行は無かったことにする
      // 箇条書きは空行1つでは閉じない（次が項目か字下げなら続ける）。
      if (!list) flushAll(); else { flushQuote(); flushTable(); flushPara(); }
      afterBlank = true;
      return;
    }

    // 表
    if (TABLE_ROW.test(line)) {
      if (!table.length) flushAll();
      table.push(line);
      afterBlank = false;
      return;
    }
    if (table.length) flushTable();
    // setext 見出し
    if (para.length && /^ {0,3}=+\s*$/u.test(line)) { const text = joinSoft(para); para = []; flushAll(); pushHeading(1, text); afterBlank = false; return; }
    if (para.length && /^ {0,3}-{2,}\s*$/u.test(line)) { const text = joinSoft(para); para = []; flushAll(); pushHeading(2, text); afterBlank = false; return; }

    const heading = ATX.exec(line);
    if (heading) {
      flushAll();
      pushHeading(heading[1].length, heading[2] ?? "");
      afterBlank = false;
      return;
    }
    if (HR.test(line)) { flushAll(); pieces.push("---"); afterBlank = false; return; }

    // 引用（入れ子は1段にまとめる）
    if (/^ {0,3}>/u.test(line)) {
      flushList(); flushPara();
      quote.push(line.replace(/^(?: {0,3}>[ \t]?)+/u, "").trim());
      afterBlank = false;
      return;
    }
    if (quote.length && !afterBlank && !LIST_ITEM.test(line)) { quote.push(trimmed); return; }
    flushQuote();

    const item = LIST_ITEM.exec(line);
    if (item) {
      flushPara();
      const ordered = /\d/u.test(item[2]);
      if (list && list.ordered !== ordered && item[1].length < 2) flushList();
      if (!list) list = { ordered, items: [] };
      const content = item[3].replace(/^\[([ xX])\][ \t]+/u, (_whole, mark: string) => (mark === " " ? "☐ " : "☑ "));
      list.items.push(oneLine(inline(content)));
      afterBlank = false;
      return;
    }
    if (list) {
      if (/^\s{2,}\S/u.test(line)) {
        // 項目の続き
        const last = list.items.length - 1;
        list.items[last] = oneLine(`${list.items[last]} ${inline(trimmed)}`);
        afterBlank = false;
        return;
      }
      if (afterBlank) flushList();
      else { list.items[list.items.length - 1] = oneLine(`${list.items[list.items.length - 1]} ${inline(trimmed)}`); return; }
    }

    para.push(line.trimStart());
    afterBlank = false;
  });
  closeCode();
  flushAll();

  // 見出しの段を決める。題として使う H1 を取り出した後、H1 が残らなければ ## → ##、残れば # → ##。
  let title = "";
  const headings = pieces.filter((piece): piece is Heading => typeof piece !== "string");
  const firstH1 = headings.find((piece) => piece.level === 1);
  const frontTitle = front.data.title.trim();
  let consumed: Heading | null = null;
  if (options.useTitle) {
    if (frontTitle) {
      title = frontTitle;
      if (firstH1 && plainText(firstH1.text) === plainText(frontTitle)) consumed = firstH1;
    } else if (firstH1) {
      title = plainText(firstH1.text);
      consumed = firstH1;
    }
  }
  const remainingH1 = headings.filter((piece) => piece.level === 1 && piece !== consumed).length;
  const flat = remainingH1 === 0;
  const rendered: string[] = [];
  for (const piece of pieces) {
    if (typeof piece === "string") { rendered.push(piece); continue; }
    if (piece === consumed) continue;
    const level: 2 | 3 = flat ? (piece.level <= 2 ? 2 : 3) : (piece.level <= 1 ? 2 : 3);
    rendered.push(`${level === 2 ? "##" : "###"} ${piece.text}`);
  }

  let body = finishEscapes(rendered.join("\n\n")).replace(/\n{3,}/gu, "\n\n").trim();
  let truncated = false;
  if (Array.from(body).length > MARKDOWN_IMPORT_BODY_MAX) {
    truncated = true;
    const cut = Array.from(body).slice(0, MARKDOWN_IMPORT_BODY_MAX).join("");
    const boundary = cut.lastIndexOf("\n\n");
    body = (boundary > 0 ? cut.slice(0, boundary) : cut).trim();
    // 閉じていないコードブロックを残さない。
    if ((body.match(/^```/gmu) ?? []).length % 2 === 1) body = `${body}\n\`\`\``;
  }

  const clip = (value: string, max: number) => Array.from(oneLine(finishEscapes(value))).slice(0, max).join("");
  return {
    title: clip(title, MARKDOWN_IMPORT_TITLE_MAX),
    summary: clip(plainText(front.data.description), MARKDOWN_IMPORT_SUMMARY_MAX),
    tags: normalizeArticleTags(front.data.tags),
    body,
    images: stats.images,
    tables: stats.tables,
    htmlRemoved: stats.htmlRemoved,
    droppedLinks: stats.droppedLinks,
    longLines: stats.longLines,
    truncated,
  };
}
