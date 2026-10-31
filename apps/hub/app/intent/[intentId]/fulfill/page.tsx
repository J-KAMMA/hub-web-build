import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyIntentIntentIdFulfillPage({
  params,
  searchParams,
}: {
  params: Promise<{ intentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { intentId } = await params;
  return toV2(`/v2/intent/${encodeURIComponent(intentId)}/fulfill`, await searchParams);
}
