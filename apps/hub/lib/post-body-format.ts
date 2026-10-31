/*
 * 投稿本文の「見せ方」だけを整える。保存された本文は変えない。
 *   - 連続した空行は1つにまとめる。本文と末尾URLのあいだの空行は消す
 *   - URL は部品に分ける。このHub内の道は種類つきの短い名前、外部は ホスト＋短いパス
 */

export type PostBodyPart =
  | { type: "text"; text: string }
  | { type: "link"; href: string; label: string; kindLabel: string | null; internal: boolean };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const TRAILING_PUNCTUATION = /[.,!?;:\)\]}>、。！）：；？]+$/u;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function collapseBlankLines(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    /* 本文とURLだけの行のあいだの空行は、空の段落に見えるだけなので詰める。 */
    .replace(/\n\n(?=https?:\/\/[^\s]+[ \t]*(?:\n|$))/g, "\n")
    .replace(/\n+$/g, "");
}

const INTERNAL_KINDS: [RegExp, string][] = [
  [/^\/v2\/music(?:\/|$)/, "音楽"],
  [/^\/v2\/videos(?:\/|$)/, "動画"],
  [/^\/v2\/articles(?:\/|$)/, "記事"],
  [/^\/v2\/posts(?:\/|$)/, "投稿"],
  [/^\/v2\/threads(?:\/|$)/, "スレッド"],
  [/^\/v2\/hubpedia(?:\/|$)/, "Hubpedia"],
  [/^\/v2\/community(?:\/|$)/, "コミュニティ"],
  [/^\/v2\/profile(?:\/|$)/, "プロフィール"],
];

function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function shortenPath(path: string, max = 28): string {
  return path.length > max ? `${path.slice(0, max - 1)}…` : path;
}

function isInternalHost(hostname: string, hubHost: string | null): boolean {
  return LOOPBACK_HOSTS.has(hostname) || (hubHost !== null && hostname === hubHost);
}

function describeLink(rawUrl: string, hubHost: string | null): PostBodyPart & { type: "link" } {
  const url = new URL(rawUrl);
  const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
  if (isInternalHost(url.hostname.toLowerCase(), hubHost)) {
    const kind = INTERNAL_KINDS.find(([pattern]) => pattern.test(url.pathname));
    if (kind) {
      const segments = url.pathname.split("/").filter(Boolean);
      const last = decodeSegment(segments[segments.length - 1] ?? "");
      const isDirectory = segments.length <= 2;
      return {
        type: "link",
        href: rawUrl,
        label: isDirectory || !last ? kind[1] : shortenPath(last),
        kindLabel: isDirectory || !last ? null : kind[1],
        internal: true,
      };
    }
    return { type: "link", href: rawUrl, label: shortenPath(`${url.pathname}${url.search}`, 40), kindLabel: null, internal: true };
  }
  const path = `${url.pathname}${url.search}`;
  return {
    type: "link",
    href: rawUrl,
    label: path === "/" ? hostname : `${hostname}${shortenPath(path, 24)}`,
    kindLabel: null,
    internal: false,
  };
}

export function splitPostBody(body: string, hubHost: string | null = null): PostBodyPart[] {
  const text = collapseBlankLines(body);
  const parts: PostBodyPart[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const raw = match[0];
    const candidate = raw.replace(TRAILING_PUNCTUATION, "");
    const index = match.index ?? 0;
    let link: ReturnType<typeof describeLink>;
    try {
      if (!candidate || candidate.length > 2048) continue;
      link = describeLink(candidate, hubHost);
    } catch {
      continue;
    }
    if (index > cursor) parts.push({ type: "text", text: text.slice(cursor, index) });
    parts.push(link);
    cursor = index + candidate.length;
  }
  if (cursor < text.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts;
}
