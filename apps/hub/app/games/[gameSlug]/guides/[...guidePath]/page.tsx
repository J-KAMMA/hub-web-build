import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyGamesGameSlugGuidesGuidePathPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameSlug: string; guidePath: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gameSlug, guidePath } = await params;
  return toV2(`/v2/community/games/${encodeURIComponent(gameSlug)}/guides/${guidePath.map(encodeURIComponent).join("/")}`, await searchParams);
}
