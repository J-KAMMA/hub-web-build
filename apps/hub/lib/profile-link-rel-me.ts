/*
 * rel="me" の逆リンクの判定。純粋な関数（取得はしない）。
 * 相手のページ（html）に、<a> または <link> で rel に "me" を含み、href がこのプロフィールの
 * 頁のどれかを指すものがあれば true。href は pageUrl を基準に解決する。
 */

const TAG = /<(a|link)\b([^>]*)>/giu;
const ATTRIBUTE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gu;

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&quot;/giu, "\"")
    .replace(/&#0*39;|&apos;/giu, "'")
    .replace(/&lt;/giu, "<")
    .replace(/&gt;/giu, ">");
}

/** 比較用の形。ホストは小文字、末尾の / と # と ?... は無視、パスは小文字で比べる。 */
export function normalizeProfileUrlForCompare(raw: string, base?: string): string | null {
  try {
    const url = new URL(decodeEntities(raw.trim()), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const path = url.pathname.replace(/\/+$/u, "").toLowerCase();
    return `${url.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

export function profileBackLinkTargets(origin: string, handle: string): string[] {
  const encoded = encodeURIComponent(handle);
  return [`/profile/${encoded}`, `/v2/profile/${encoded}`]
    .map((path) => normalizeProfileUrlForCompare(path, origin))
    .filter((value): value is string => Boolean(value));
}

export function hasRelMeBackLink(html: string, pageUrl: string, targets: readonly string[]): boolean {
  if (!targets.length) return false;
  const wanted = new Set(targets);
  for (const tag of html.matchAll(TAG)) {
    let rel: string | null = null;
    let href: string | null = null;
    for (const attribute of tag[2].matchAll(ATTRIBUTE)) {
      const name = attribute[1].toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? "";
      if (name === "rel") rel = value;
      else if (name === "href") href = value;
    }
    if (rel === null || href === null) continue;
    if (!rel.toLowerCase().split(/\s+/u).includes("me")) continue;
    const normalized = normalizeProfileUrlForCompare(href, pageUrl);
    if (normalized && wanted.has(normalized)) return true;
  }
  return false;
}
