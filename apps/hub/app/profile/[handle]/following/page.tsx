import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyProfileHandleFollowingPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { handle } = await params;
  return toV2(`/v2/profile/${encodeURIComponent(handle)}/following`, await searchParams);
}
