import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyMarketGamesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return toV2("/v2/market?q=%E3%82%B2%E3%83%BC%E3%83%A0", await searchParams);
}
