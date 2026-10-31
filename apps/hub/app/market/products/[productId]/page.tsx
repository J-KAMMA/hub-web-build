import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyMarketProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ productId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { productId } = await params;
  return toV2(`/v2/market/products/${encodeURIComponent(productId)}`, await searchParams);
}
