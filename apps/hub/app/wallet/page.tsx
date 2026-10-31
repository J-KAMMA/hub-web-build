import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyWalletPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return toV2("/v2/account/payment", await searchParams);
}
