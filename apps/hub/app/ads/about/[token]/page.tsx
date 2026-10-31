import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyAdsAboutTokenPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token } = await params;
  return toV2(`/v2/ads/about/${encodeURIComponent(token)}`, await searchParams);
}
