import { permanentRedirect } from "next/navigation";

import { canonicalTagSlug } from "@/lib/tag-href";

export const dynamic = "force-dynamic";

function decodeSlug(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/* The article-only tag page became a tab of the one tag page: /v2/tag/<canonical slug>?kind=articles. */
export default async function V2ArticleTagRedirect({ params }: { params: Promise<{ tag: string }> }) {
  const slug = canonicalTagSlug(decodeSlug((await params).tag));
  permanentRedirect(slug ? `/v2/tag/${slug}?kind=articles` : "/v2/articles");
}
