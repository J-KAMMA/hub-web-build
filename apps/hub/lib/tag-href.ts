import { splitTagInput, tagSlug } from "@jkamma/content-tags";

/*
 * The one place that decides where a tag chip links to: /v2/tag/<tagSlug(key)>. Any spelling (display
 * form, #prefix, full-width) lands on the same canonical page. Text that is not a single valid tag
 * (for example "a b", which the shared splitter treats as two tags) links to its first valid part.
 */
export type TagChipKind = "posts" | "threads" | "articles" | "videos" | "music" | "market" | "category";

/** The canonical path segment for a tag, or null when no part of the text is a valid tag. */
export function canonicalTagSlug(raw: string): string | null {
  const whole = tagSlug(raw);
  if (whole) return whole;
  for (const part of splitTagInput(raw)) {
    const slug = tagSlug(part);
    if (slug) return slug;
  }
  return null;
}

export function tagHref(display: string, kind?: TagChipKind): string {
  const slug = canonicalTagSlug(display) ?? encodeURIComponent(display.trim().replace(/^[#＃]+/u, ""));
  const base = `/v2/tag/${slug}`;
  // "category" chips (music genre, video category) share the page; the page has no category tab.
  return kind && kind !== "category" ? `${base}?kind=${kind}` : base;
}
