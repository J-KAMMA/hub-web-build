import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyHubpediaPapersIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  return toV2(`/v2/hubpedia/papers/${encodeURIComponent(id)}`, await searchParams);
}
