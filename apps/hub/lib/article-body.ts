import { normalizeTagList } from "@jkamma/content-tags";
/**
 * 記事本文の構造化。
 *
 * 本文はHTMLとして解釈しない。行頭の記号と、限られたインライン記法だけを見て
 * ブロックへ分け、描画側はReact要素として組み立てる。`dangerouslySetInnerHTML`
 * を使わないため、著者の書いた文字列がそのまま実行される経路が存在しない。
 *
 * 執筆画面のプレビューと公開後の記事は同じ関数を通す。片方だけ直すと
 * 「書いたとおりに出ない」が起きるので、分岐をここ以外へ置かない。
 *
 * Hub Desktop の `apps/hub-desktop/ui/article-body.mjs` は同じ文法を持つ移植で、
 * `article-body-fixtures.json` の全件が両方で同じ構造になることを試験している。
 * 文法を変えるときは両方と、そのJSONを一緒に直す。
 *
 * 書式:
 *   ## 見出し / ### 小見出し     段落（空行で区切る）
 *   - 項目 / * 項目               1. 項目
 *   > 引用（連続行は1つ）         --- 区切り線
 *   ```lang ... ```              コードブロック
 *   ![代替文](画像URL)            行全体で画像。HTTPSか、Hubにアップロードした画像のみ
 *   https://youtu.be/ID           行全体がYouTubeのURLなら埋め込み
 *   **強調** *斜体* `コード` [文字](URL) と、文中のhttp(s) URL
 */
export type ArticleInline =
  | { t: "text"; v: string }
  | { t: "strong"; c: ArticleInline[] }
  | { t: "em"; c: ArticleInline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; external: boolean; c: ArticleInline[] };

export type ArticleBlock =
  | { kind: "heading"; level: 2 | 3; text: string; id: string; inline: ArticleInline[] }
  | { kind: "quote"; text: string; inline: ArticleInline[] }
  | { kind: "list"; ordered: boolean; items: string[]; itemsInline: ArticleInline[][] }
  | { kind: "paragraph"; text: string; inline: ArticleInline[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "hr" }
  | { kind: "image"; src: string; alt: string }
  | { kind: "embed"; provider: "youtube"; id: string };

export type ArticleHeading = { id: string; level: 2 | 3; text: string };

const HUB_IMAGE_PATH = /^\/api\/(?:media|articles)\/images\/[A-Za-z0-9_-]{1,64}$/u;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/u;
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"]);
const MAX_INLINE_DEPTH = 3;

function parseWebUrl(value: string): URL | null {
  if (value.length > 2048 || /[\u0000- \u007f]/u.test(value)) return null;
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || !url.hostname) return null;
  return url;
}

/** リンク先。http/https と、Hub内の絶対パスだけ。javascript: や data: は null。 */
export function safeArticleLink(value: string): { href: string; external: boolean } | null {
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.length > 2048 || /[\u0000- \u007f\\]/u.test(value)) return null;
    return { href: value, external: false };
  }
  const url = parseWebUrl(value);
  return url ? { href: url.href, external: true } : null;
}

/** 画像の出所。HTTPSの外部画像か、Hubにアップロードした画像だけ。http は拒否する。 */
export function safeArticleImageSource(value: string): string | null {
  if (HUB_IMAGE_PATH.test(value)) return value;
  const url = parseWebUrl(value);
  return url && url.protocol === "https:" ? url.href : null;
}

/** YouTube の動画ID。YouTube 以外、形の崩れたものは null。 */
export function articleYouTubeId(value: string): string | null {
  const url = parseWebUrl(value);
  if (!url || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase())) return null;
  let id: string | null = null;
  if (url.hostname.toLowerCase() === "youtu.be") id = url.pathname.slice(1).split("/")[0] ?? null;
  else if (url.pathname === "/watch") id = url.searchParams.get("v");
  else id = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/u)?.[1] ?? null;
  return id && YOUTUBE_ID.test(id) ? id : null;
}

function pushText(out: ArticleInline[], value: string) {
  if (!value) return;
  const last = out[out.length - 1];
  if (last?.t === "text") last.v += value;
  else out.push({ t: "text", v: value });
}

export function parseArticleInline(source: string, depth = 0, allowLinks = true): ArticleInline[] {
  const out: ArticleInline[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "`") {
      const end = source.indexOf("`", i + 1);
      if (end > i + 1) {
        out.push({ t: "code", v: source.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
    } else if (ch === "[" && allowLinks && depth < MAX_INLINE_DEPTH) {
      const match = /^\[([^\]\n]{1,200})\]\(([^)\s]{1,2048})\)/u.exec(source.slice(i));
      const link = match ? safeArticleLink(match[2]) : null;
      if (match && link) {
        out.push({ t: "link", ...link, c: parseArticleInline(match[1], depth + 1, false) });
        i += match[0].length;
        continue;
      }
    } else if (ch === "*" && depth < MAX_INLINE_DEPTH) {
      if (source.startsWith("**", i)) {
        const end = source.indexOf("**", i + 2);
        if (end > i + 2 && !/^\s|\s$/u.test(source.slice(i + 2, end))) {
          out.push({ t: "strong", c: parseArticleInline(source.slice(i + 2, end), depth + 1, allowLinks) });
          i = end + 2;
          continue;
        }
      } else {
        const rest = source.slice(i + 1);
        const end = rest.search(/\*/u);
        if (end > 0 && !/^\s|\s$/u.test(rest.slice(0, end))) {
          out.push({ t: "em", c: parseArticleInline(rest.slice(0, end), depth + 1, allowLinks) });
          i += end + 2;
          continue;
        }
      }
    } else if (ch === "h" && allowLinks && !(i > 0 && /[A-Za-z0-9]/u.test(source[i - 1])) && /^https?:\/\//u.test(source.slice(i, i + 8))) {
      const match = /^https?:\/\/[^\s\u0000- \u007f-￿<>"'`]+/u.exec(source.slice(i));
      if (match) {
        const text = match[0].replace(/[.,;:!?)\]]+$/u, "");
        const link = safeArticleLink(text);
        if (link) {
          out.push({ t: "link", ...link, c: [{ t: "text", v: text }] });
          i += text.length;
          continue;
        }
      }
    }
    pushText(out, ch);
    i += 1;
  }
  return out;
}

export function articleInlinePlainText(nodes: ArticleInline[]): string {
  return nodes.map((node) => (node.t === "text" || node.t === "code" ? node.v : articleInlinePlainText(node.c))).join("");
}

function headingSlug(text: string): string {
  const slug = text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/gu, "");
  return Array.from(slug).slice(0, 48).join("").replace(/-+$/u, "") || "section";
}

export function articleBlocks(body: string): ArticleBlock[] {
  const blocks: ArticleBlock[] = [];
  const slugCounts = new Map<string, number>();
  let paragraph: string[] = [];
  let quote: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: { lang: string; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const text = paragraph.join("\n");
    blocks.push({ kind: "paragraph", text, inline: parseArticleInline(text) });
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const text = quote.join("\n");
    blocks.push({ kind: "quote", text, inline: parseArticleInline(text) });
    quote = [];
  };
  const flushList = () => {
    if (!list) return;
    blocks.push({ kind: "list", ordered: list.ordered, items: list.items, itemsInline: list.items.map((item) => parseArticleInline(item)) });
    list = null;
  };
  const flushAll = () => { flushList(); flushQuote(); flushParagraph(); };
  const pushHeading = (level: 2 | 3, raw: string) => {
    const inline = parseArticleInline(raw);
    const text = articleInlinePlainText(inline);
    const slug = headingSlug(text);
    const count = (slugCounts.get(slug) ?? 0) + 1;
    slugCounts.set(slug, count);
    blocks.push({ kind: "heading", level, text, id: count === 1 ? `h-${slug}` : `h-${slug}-${count}`, inline });
  };

  for (const line of body.replaceAll("\r\n", "\n").split("\n")) {
    if (fence) {
      if (line.trim() === "```") {
        blocks.push({ kind: "code", lang: fence.lang, text: fence.lines.join("\n") });
        fence = null;
      } else fence.lines.push(line);
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed) { flushAll(); continue; }
    if (trimmed.startsWith("```")) {
      flushAll();
      const lang = trimmed.slice(3).trim();
      fence = { lang: /^[A-Za-z0-9_+#.-]{1,20}$/u.test(lang) ? lang : "", lines: [] };
      continue;
    }
    if (trimmed.startsWith("### ")) { flushAll(); pushHeading(3, trimmed.slice(4).trim()); continue; }
    if (trimmed.startsWith("## ")) { flushAll(); pushHeading(2, trimmed.slice(3).trim()); continue; }
    if (/^(?:-{3,}|\*{3,}|_{3,})$/u.test(trimmed)) { flushAll(); blocks.push({ kind: "hr" }); continue; }
    if (trimmed === ">" || trimmed.startsWith("> ")) {
      flushList(); flushParagraph();
      quote.push(trimmed.slice(1).trim());
      continue;
    }
    const bullet = /^[-*] +(.*)$/u.exec(trimmed);
    const numbered = bullet ? null : /^\d{1,3}[.)] +(.*)$/u.exec(trimmed);
    if (bullet || numbered) {
      flushQuote(); flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1].trim());
      continue;
    }
    const image = /^!\[([^\]\n]{0,200})\]\(([^)\s]{1,2048})\)$/u.exec(trimmed);
    const imageSource = image ? safeArticleImageSource(image[2]) : null;
    if (image && imageSource) {
      flushAll();
      blocks.push({ kind: "image", src: imageSource, alt: image[1].trim() });
      continue;
    }
    if (/^https?:\/\/\S+$/u.test(trimmed)) {
      const id = articleYouTubeId(trimmed);
      if (id) { flushAll(); blocks.push({ kind: "embed", provider: "youtube", id }); continue; }
    }
    flushList(); flushQuote();
    paragraph.push(trimmed);
  }
  if (fence) blocks.push({ kind: "code", lang: fence.lang, text: fence.lines.join("\n") });
  flushAll();
  return blocks;
}

/** 目次用。見出しブロックと同じ id を返す。 */
export function articleHeadingList(body: string): ArticleHeading[] {
  return articleBlocks(body).flatMap((block) =>
    block.kind === "heading" ? [{ id: block.id, level: block.level, text: block.text }] : []);
}

/** 一覧やメタ情報へ出す要約。著者が書いていなければ本文の頭から作る。 */
export function articleSummaryFallback(body: string, limit = 120): string {
  const firstParagraph = articleBlocks(body).find((block) => block.kind === "paragraph");
  const text = firstParagraph?.kind === "paragraph" ? articleInlinePlainText(firstParagraph.inline).replaceAll("\n", " ") : "";
  const characters = Array.from(text);
  return characters.length > limit ? `${characters.slice(0, limit).join("")}…` : text;
}

/** 表示用の文字数。結合文字を1文字と数え、前後の空白は数えない。 */
export function articleCharacterCount(value: string): number {
  return Array.from(value.trim()).length;
}

export function normalizeArticleTags(tags: string | string[]): string[] {
  return normalizeTagList(tags).map((tag) => tag.display);
}
