import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyVideosVideoIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ videoId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { videoId } = await params;
  return toV2(`/v2/videos/${encodeURIComponent(videoId)}`, await searchParams);
}
