/*
 * 画像検索の共通部分 (2026-10-29)。ブラウザとサーバーの両方が読む素のモジュール。
 * Hub の外の画像 (Openverse / Wikimedia Commons) はブラウザが直接呼ぶ。Hub のハンドラーは中継しない。
 * 失敗・制限・想定外の形はすべて null にして、呼び出し側はその節を出さない (静かに失敗する)。
 */

export const IMAGE_KINDS = ["hub-post", "hub-article", "remote", "openverse", "commons"] as const;
export type ImageKind = (typeof IMAGE_KINDS)[number];

export type ImageItem = {
  /* 一覧の中で一意。kind:ref */
  key: string;
  kind: ImageKind;
  /* Hub の画像は画像ID、リモートはオブジェクトURL、外部は提供元のID */
  ref: string;
  title: string;
  thumbnailUrl: string;
  width: number | null;
  height: number | null;
  /* 元のページ。Hub内なら /v2/posts/…、外部なら提供元のページ */
  sourceUrl: string;
  licence: string;
  creator: string;
  tags: string[];
};

export type ImagePage = { items: ImageItem[]; nextCursor: string | null };

export const IMAGE_PAGE_SIZE = 24;
const MAX_TEXT = 300;

export function isImageKind(value: unknown): value is ImageKind {
  return typeof value === "string" && (IMAGE_KINDS as readonly string[]).includes(value);
}

/* ---- cursors: base64url(JSON). A cursor names the last row (a key), never an offset into a growing list. ---- */

export function encodeCursor(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeCursor(value: string | null | undefined): Record<string, unknown> | null {
  if (!value || value.length > 600 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* ---- small validators ---- */

export function safeHttpsUrl(value: unknown, hosts?: readonly RegExp[]): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    if (hosts && !hosts.some((pattern) => pattern.test(url.hostname))) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function plainText(value: unknown, max = MAX_TEXT): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  return value.replace(/<[^>]*>/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function dimension(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 20000 ? value : null;
}

/* Thumbnails only ever come from these hosts; anything else is dropped rather than loaded. */
export const OPENVERSE_THUMB_HOSTS: readonly RegExp[] = [/^api\.openverse\.org$/, /^[a-z0-9-]+\.openverse\.org$/];
export const COMMONS_THUMB_HOSTS: readonly RegExp[] = [/^upload\.wikimedia\.org$/];

/* ---- Openverse ---- */

export const OPENVERSE_ENDPOINT = "https://api.openverse.org/v1/images/";

export function openverseSearchUrl(query: string, page: number): string {
  const params = new URLSearchParams({ q: query, page: String(page), page_size: String(IMAGE_PAGE_SIZE), mature: "false" });
  return `${OPENVERSE_ENDPOINT}?${params.toString()}`;
}

export function licenceLabel(license: unknown, version: unknown): string {
  const code = plainText(license, 20).toUpperCase();
  if (!code) return "";
  if (code === "CC0") return "CC0";
  if (code === "PDM") return "Public Domain Mark";
  const v = plainText(version, 10);
  return `CC ${code}${v ? ` ${v}` : ""}`;
}

export function parseOpenverse(payload: unknown, page: number): ImagePage | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (!Array.isArray(record.results)) return null;
  const items: ImageItem[] = [];
  for (const raw of record.results) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    if (row.mature === true) continue;
    const id = plainText(row.id, 80);
    const thumbnailUrl = safeHttpsUrl(row.thumbnail, OPENVERSE_THUMB_HOSTS);
    const sourceUrl = safeHttpsUrl(row.foreign_landing_url);
    if (!id || !thumbnailUrl || !sourceUrl) continue;
    const tags = Array.isArray(row.tags)
      ? row.tags.flatMap((tag) => (tag && typeof tag === "object" ? [plainText((tag as Record<string, unknown>).name, 40)] : [])).filter(Boolean).slice(0, 8)
      : [];
    items.push({
      key: `openverse:${id}`,
      kind: "openverse",
      ref: id,
      title: plainText(row.title) || "Untitled",
      thumbnailUrl,
      width: dimension(row.width),
      height: dimension(row.height),
      sourceUrl,
      licence: licenceLabel(row.license, row.license_version),
      creator: plainText(row.creator, 120),
      tags,
    });
  }
  const pageCount = typeof record.page_count === "number" ? record.page_count : page;
  return { items, nextCursor: page < pageCount && items.length > 0 ? encodeCursor({ s: "openverse", p: page + 1 }) : null };
}

/* ---- Wikimedia Commons ---- */

export const COMMONS_ENDPOINT = "https://commons.wikimedia.org/w/api.php";

export function commonsSearchUrl(query: string, offset: number): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    generator: "search",
    gsrsearch: `${query} filetype:bitmap`,
    gsrnamespace: "6",
    gsrlimit: String(IMAGE_PAGE_SIZE),
    gsroffset: String(offset),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata",
    iiurlwidth: "400",
  });
  return `${COMMONS_ENDPOINT}?${params.toString()}`;
}

function metaValue(meta: unknown, key: string, max = MAX_TEXT): string {
  if (!meta || typeof meta !== "object") return "";
  const entry = (meta as Record<string, unknown>)[key];
  return entry && typeof entry === "object" ? plainText((entry as Record<string, unknown>).value, max) : "";
}

export function parseCommons(payload: unknown, offset: number): ImagePage | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const query = record.query as Record<string, unknown> | undefined;
  if (!query || !Array.isArray(query.pages)) return null;
  const pages = (query.pages as unknown[])
    .filter((page): page is Record<string, unknown> => Boolean(page) && typeof page === "object")
    .sort((a, b) => (Number(a.index) || 0) - (Number(b.index) || 0));
  const items: ImageItem[] = [];
  for (const page of pages) {
    const info = Array.isArray(page.imageinfo) ? (page.imageinfo[0] as Record<string, unknown> | undefined) : undefined;
    if (!info) continue;
    const pageId = typeof page.pageid === "number" ? String(page.pageid) : "";
    const thumbnailUrl = safeHttpsUrl(info.thumburl, COMMONS_THUMB_HOSTS);
    const sourceUrl = safeHttpsUrl(info.descriptionurl, [/^commons\.wikimedia\.org$/]);
    if (!pageId || !thumbnailUrl || !sourceUrl) continue;
    const meta = info.extmetadata;
    const licence = metaValue(meta, "LicenseShortName", 80);
    // Without a licence line we cannot honour attribution, so the image is not offered.
    if (!licence) continue;
    const rawTitle = typeof page.title === "string" ? page.title.replace(/^File:/, "").replace(/\.[A-Za-z0-9]+$/, "") : "";
    items.push({
      key: `commons:${pageId}`,
      kind: "commons",
      ref: pageId,
      title: plainText(rawTitle) || "Untitled",
      thumbnailUrl,
      width: dimension(info.thumbwidth),
      height: dimension(info.thumbheight),
      sourceUrl,
      licence,
      creator: metaValue(meta, "Artist", 120),
      tags: [],
    });
  }
  const cont = record.continue as Record<string, unknown> | undefined;
  const nextOffset = cont && typeof cont.gsroffset === "number" ? cont.gsroffset : null;
  return { items, nextCursor: nextOffset !== null && nextOffset > offset ? encodeCursor({ s: "commons", o: nextOffset }) : null };
}

/* ---- fetching (browser). null = the section stays absent. ---- */

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

async function getJson(fetcher: Fetcher, url: string, signal?: AbortSignal): Promise<unknown | null> {
  try {
    const response = await fetcher(url, { signal, credentials: "omit", referrerPolicy: "no-referrer", headers: { Accept: "application/json" } });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export async function fetchOpenverseImages(query: string, cursor: string | null, fetcher: Fetcher, signal?: AbortSignal): Promise<ImagePage | null> {
  const q = query.trim().slice(0, 100);
  if (!q) return null;
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return null;
  const page = decoded && decoded.s === "openverse" && typeof decoded.p === "number" && decoded.p >= 1 && decoded.p <= 50 ? Math.trunc(decoded.p) : 1;
  const payload = await getJson(fetcher, openverseSearchUrl(q, page), signal);
  return payload ? parseOpenverse(payload, page) : null;
}

export async function fetchCommonsImages(query: string, cursor: string | null, fetcher: Fetcher, signal?: AbortSignal): Promise<ImagePage | null> {
  const q = query.trim().slice(0, 100);
  if (!q) return null;
  const decoded = cursor ? decodeCursor(cursor) : null;
  if (cursor && !decoded) return null;
  const offset = decoded && decoded.s === "commons" && typeof decoded.o === "number" && decoded.o >= 0 && decoded.o <= 1000 ? Math.trunc(decoded.o) : 0;
  const payload = await getJson(fetcher, commonsSearchUrl(q, offset), signal);
  return payload ? parseCommons(payload, offset) : null;
}

/* Terms for "似た画像": the tags when there are any, otherwise the longest words of the title. */
export function similarQueryTerms(item: Pick<ImageItem, "tags" | "title">): string {
  if (item.tags.length) return item.tags.slice(0, 2).join(" ");
  const words = item.title.split(/[\s　,、。/_-]+/).filter((word) => word.length >= 2).sort((a, b) => b.length - a.length);
  return words.slice(0, 2).join(" ");
}
