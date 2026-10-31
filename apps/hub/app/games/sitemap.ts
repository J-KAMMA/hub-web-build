import type { MetadataRoute } from "next";
import { listPublicGameGuideHubs } from "@/lib/server/public-game-guides";
import { getInstanceOrigin } from "@/lib/instance-origin";

const ORIGIN = getInstanceOrigin();
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const games = await listPublicGameGuideHubs();
  return games.flatMap((game) => [
    { url: `${ORIGIN}/games/${encodeURIComponent(game.slug)}`, lastModified: game.updatedAt, changeFrequency: "weekly" as const, priority: 0.8 },
    ...game.guides.map((guide) => ({ url: `${ORIGIN}/games/${encodeURIComponent(game.slug)}/guides/${guide.path.split("/").map(encodeURIComponent).join("/")}`, lastModified: guide.updatedAt, changeFrequency: "weekly" as const, priority: 0.75 })),
  ]);
}
