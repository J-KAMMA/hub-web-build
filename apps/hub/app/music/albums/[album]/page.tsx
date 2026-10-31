import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyMusicAlbumsAlbumPage({
  params,
  searchParams,
}: {
  params: Promise<{ album: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { album } = await params;
  return toV2(`/v2/music/albums/${encodeURIComponent(album)}`, await searchParams);
}
