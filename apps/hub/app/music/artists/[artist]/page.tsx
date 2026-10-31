import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyMusicArtistsArtistPage({
  params,
  searchParams,
}: {
  params: Promise<{ artist: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { artist } = await params;
  return toV2(`/v2/music/artists/${encodeURIComponent(artist)}`, await searchParams);
}
