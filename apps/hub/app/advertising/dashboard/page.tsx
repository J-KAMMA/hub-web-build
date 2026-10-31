import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyAdvertisingDashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return toV2("/v2/advertising/dashboard", await searchParams);
}
