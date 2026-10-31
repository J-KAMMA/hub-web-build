import { load } from "cheerio";
import type { HubActionProjection } from "@/lib/action-layer";

export interface LinkPreview {
  url: string;
  siteName: string;
  title: string;
  description: string;
  imageUrl: string | null;
  kind?: "video";
  action?: HubActionProjection;
}

export const LINK_PREVIEW_CACHE_CONTROL = {
  action: "public, max-age=15, s-maxage=30, stale-while-revalidate=15",
  content: "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
  fallbackAction: "public, max-age=10, s-maxage=30",
} as const;

export function getLinkPreviewCacheControl(
  preview: Pick<LinkPreview, "action">,
  options?: { fallback?: boolean },
): string {
  if (!preview.action) return LINK_PREVIEW_CACHE_CONTROL.content;
  return options?.fallback
    ? LINK_PREVIEW_CACHE_CONTROL.fallbackAction
    : LINK_PREVIEW_CACHE_CONTROL.action;
}

function clean(value: string | undefined, maxLength: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeImageUrl(value: string | undefined, pageUrl: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value, pageUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.toString().length > 2048) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function extractLinkPreview(html: string, pageUrl: string): LinkPreview {
  const $ = load(html);
  const meta = (selector: string) => $(selector).first().attr("content");
  const page = new URL(pageUrl);
  const title = clean(
    meta('meta[property="og:title"]') ?? meta('meta[name="twitter:title"]') ?? $("title").first().text(),
    200
  );
  const description = clean(
    meta('meta[property="og:description"]') ??
      meta('meta[name="twitter:description"]') ??
      meta('meta[name="description"]'),
    500
  );
  const siteName = clean(meta('meta[property="og:site_name"]') ?? page.hostname.replace(/^www\./, ""), 100);
  const imageUrl = safeImageUrl(
    meta('meta[property="og:image:secure_url"]') ??
      meta('meta[property="og:image"]') ??
      meta('meta[name="twitter:image"]'),
    pageUrl
  );

  return { url: pageUrl, siteName, title: title || siteName, description, imageUrl };
}
