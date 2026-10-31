import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyThreadsThreadIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ threadId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { threadId } = await params;
  return toV2(`/v2/threads/${encodeURIComponent(threadId)}`, await searchParams);
}
