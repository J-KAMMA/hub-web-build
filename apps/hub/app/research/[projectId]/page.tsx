import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyResearchProjectIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  return toV2(`/v2/research/${encodeURIComponent(projectId)}`, await searchParams);
}
