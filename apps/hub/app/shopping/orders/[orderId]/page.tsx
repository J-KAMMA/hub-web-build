import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyShoppingOrdersOrderIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ orderId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { orderId } = await params;
  return toV2(`/v2/market/orders/${encodeURIComponent(orderId)}`, await searchParams);
}
