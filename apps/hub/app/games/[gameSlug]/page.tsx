import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyGamesGameSlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ gameSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gameSlug } = await params;
  return toV2(`/v2/games/${encodeURIComponent(gameSlug)}`, await searchParams);
}
