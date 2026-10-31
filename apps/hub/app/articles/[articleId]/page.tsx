import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyArticlesArticleIdPage({
  params,
  searchParams,
}: {
  params: Promise<{ articleId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { articleId } = await params;
  return toV2(`/v2/articles/${encodeURIComponent(articleId)}`, await searchParams);
}
