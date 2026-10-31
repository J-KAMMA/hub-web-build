import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyCommunityInviteCodePage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { code } = await params;
  return toV2(`/v2/community/invite/${encodeURIComponent(code)}`, await searchParams);
}
