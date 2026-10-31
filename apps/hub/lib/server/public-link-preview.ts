import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { extractLinkPreview, type LinkPreview } from "@/lib/link-preview";
import { LinkPreviewError, validatePublicPreviewUrl } from "@/lib/link-preview-url";
import { assertSafeUrl } from "@/lib/encyclopedia/url-security";
import { getHubD1 } from "@/lib/server/hub-d1";

/*
 * 覚える量の上限。**1頁につきこれ以上は持たない。**
 * 512KB では足りなかった（2026-09-04）。YouTube の視聴頁は og: の並びが 693KB の所に
 * あり、その手前を巨大な script が占める。頭だけ読む作戦が効かない作りになっている。
 * 1MB にすると届く。上限そのものは残す（無制限にはしない）。
 */
const MAX_HTML_BYTES = 1024 * 1024;
const READY_TTL_SECONDS = 7 * 24 * 60 * 60;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const ALLOWED_MIME_TYPES = new Set(["text/html", "application/xhtml+xml"]);

async function validateForRuntime(rawUrl: string): Promise<URL> {
  const syntacticallySafe = validatePublicPreviewUrl(rawUrl);
  if (process.env.CLOUDFLARE_RUNTIME === "workers") return syntacticallySafe;
  try {
    return await assertSafeUrl(syntacticallySafe.toString());
  } catch {
    throw new LinkPreviewError("unsafe_url", "URL does not resolve to a public address.");
  }
}

/*
 * 上限まで読んで、**そこで止める**（2026-09-04）。
 *
 * もとは上限を超えた時点で too_large を投げていたので、大きな頁は札が出ず 502 だった。
 * YouTube の視聴頁は 1,461KB あり、上限は 512KB。**Hubに貼られた YouTube のリンクは
 * すべて下見に失敗していた**（自動の測定で 502 を拾って気付いた）。
 *
 * 欲しいのは <head> の og: と title で、それは頭の数十KBに在る。上限は覚える量を
 * 抑えるための物なので、途中で止めればその役目は果たす。切れた所で終わる分には、
 * 見つかる札が減るだけで、502 で何も出ないより良い。
 */
async function readBoundedHtml(response: Response): Promise<string> {
  if (!response.body) throw new LinkPreviewError("empty", "Page has no body.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    /*
     * **一塊を丸ごと受けてから数えない。** 上限を超える分は切り落としてから積む。
     * 丸ごと積んでから判定すると、1回で全部届く応答（試験や小さな頁）で上限が
     * 効かず、2MBでも2MB持ってしまう。実際それで検査が素通りした（2026-09-04）。
     */
    const room = MAX_HTML_BYTES - size;
    const slice = value.byteLength <= room ? value : value.subarray(0, room);
    size += slice.byteLength;
    chunks.push(slice);
    if (size >= MAX_HTML_BYTES) {
      /* ここで打ち切る。読んだ分から札を作る。 */
      await reader.cancel();
      break;
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPreview(rawUrl: string, fetchImpl: typeof fetch): Promise<LinkPreview> {
  let current = await validateForRuntime(rawUrl);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    let response: Response;
    try {
      response = await fetchImpl(current, {
        cache: "no-store",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          accept: "text/html,application/xhtml+xml",
          "user-agent": "JKamma-Hub-LinkPreview/1.0"
        }
      });
    } catch {
      throw new LinkPreviewError("fetch_failed", "Page could not be fetched.");
    } finally {
      clearTimeout(timeout);
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) throw new LinkPreviewError("redirect_failed", "Redirect is invalid.");
      current = await validateForRuntime(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new LinkPreviewError("fetch_failed", "Page could not be fetched.");
    const mimeType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new LinkPreviewError("unsupported_type", "Page is not HTML.");
    return extractLinkPreview(await readBoundedHtml(response), current.toString());
  }
  throw new LinkPreviewError("redirect_failed", "Too many redirects.");
}

interface CachedPreviewRow {
  final_url: string;
  site_name: string;
  title: string;
  description: string;
  image_url: string | null;
}

async function readCache(database: D1Database, normalizedUrl: string, now: number): Promise<LinkPreview | null> {
  const row = await database.prepare(
    "SELECT final_url, site_name, title, description, image_url FROM link_previews WHERE normalized_url = ? AND expires_at > ?"
  ).bind(normalizedUrl, now).first<CachedPreviewRow>();
  return row ? { url: row.final_url, siteName: row.site_name, title: row.title, description: row.description, imageUrl: row.image_url } : null;
}

async function writeCache(database: D1Database, normalizedUrl: string, preview: LinkPreview, now: number): Promise<void> {
  await database.prepare(`
    INSERT INTO link_previews (normalized_url, final_url, site_name, title, description, image_url, fetched_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(normalized_url) DO UPDATE SET
      final_url = excluded.final_url, site_name = excluded.site_name, title = excluded.title,
      description = excluded.description, image_url = excluded.image_url,
      fetched_at = excluded.fetched_at, expires_at = excluded.expires_at
  `).bind(normalizedUrl, preview.url, preview.siteName, preview.title, preview.description, preview.imageUrl, now, now + READY_TTL_SECONDS).run();
}

export async function getPublicLinkPreview(
  rawUrl: string,
  dependencies: { fetchImpl?: typeof fetch; database?: D1Database | null; now?: number } = {}
): Promise<LinkPreview> {
  const normalizedUrl = validatePublicPreviewUrl(rawUrl).toString();
  const now = dependencies.now ?? Math.floor(Date.now() / 1000);
  let database = dependencies.database;
  if (database === undefined && process.env.CLOUDFLARE_RUNTIME === "workers") database = getHubD1();
  if (database) {
    const cached = await readCache(database, normalizedUrl, now);
    if (cached) return cached;
  }
  const preview = await fetchPreview(normalizedUrl, dependencies.fetchImpl ?? fetch);
  if (database) await writeCache(database, normalizedUrl, preview, now);
  return preview;
}
