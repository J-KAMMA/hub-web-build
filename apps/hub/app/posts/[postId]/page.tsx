import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyPostsPostIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { postId } = await params;
  return toV2(`/v2/posts/${encodeURIComponent(postId)}`, await searchParams);
}
