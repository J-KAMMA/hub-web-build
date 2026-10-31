import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyShoppingSellPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return toV2("/v2/market/sell", await searchParams);
}
