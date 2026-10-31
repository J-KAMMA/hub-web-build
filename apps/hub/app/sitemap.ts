import type { MetadataRoute } from "next";

import { getPublicReaderReadySeedArticles } from "@/lib/encyclopedia/public-seed";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { listAllIndexableHubpediaArticles } from "@/lib/server/hubpedia-search-exposure";
import { getInstanceOrigin } from "@/lib/instance-origin";

const HUB_ORIGIN = getInstanceOrigin();

export const dynamic = "force-dynamic";

/*
 * D1 entries are listed only when a human has reviewed the live revision
 * (docs/hubpedia-hybrid/DESIGN.md section 7). A read failure lists none.
 */
async function humanReviewedDatabaseArticles() {
  try {
    const database = getOptionalHubD1();
    return database ? await listAllIndexableHubpediaArticles(database) : [];
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const publicArticles = await getPublicReaderReadySeedArticles();
  const seedSlugs = new Set(publicArticles.filter(({ aiGenerated }) => !aiGenerated).map(({ slug }) => slug));
  const databaseArticles = (await humanReviewedDatabaseArticles()).filter(({ slug }) => !seedSlugs.has(slug));
  return [
    { url: HUB_ORIGIN, changeFrequency: "daily", priority: 1 },
    { url: `${HUB_ORIGIN}/hubpedia`, changeFrequency: "daily", priority: 0.9 },
    { url: `${HUB_ORIGIN}/hubpedia/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${HUB_ORIGIN}/about`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${HUB_ORIGIN}/privacy`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${HUB_ORIGIN}/terms`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${HUB_ORIGIN}/games`, changeFrequency: "daily", priority: 0.85 },
    { url: `${HUB_ORIGIN}/games/fallout-4`, changeFrequency: "weekly", priority: 0.8 },
    /* Model-written seeds are listed only through the database listing below,
     * which requires a live human-reviewed revision. */
    ...publicArticles.filter(({ aiGenerated }) => !aiGenerated).map(({ slug, translations }) => ({
      url: `${HUB_ORIGIN}/hubpedia/${encodeURIComponent(slug)}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
      alternates: {
        languages: Object.fromEntries([
          ["ja", `${HUB_ORIGIN}/hubpedia/${encodeURIComponent(slug)}`],
          ...Object.keys(translations ?? {}).map((locale) => [locale, `${HUB_ORIGIN}/hubpedia/${encodeURIComponent(slug)}?lang=${encodeURIComponent(locale)}`]),
        ]),
      },
    })),
    ...databaseArticles.map(({ slug, updatedAt }) => ({
      url: `${HUB_ORIGIN}/hubpedia/${encodeURIComponent(slug)}`,
      ...(updatedAt && Number.isFinite(updatedAt) ? { lastModified: new Date(updatedAt) } : {}),
      changeFrequency: "monthly" as const,
      priority: 0.6,
    })),
  ];
}
