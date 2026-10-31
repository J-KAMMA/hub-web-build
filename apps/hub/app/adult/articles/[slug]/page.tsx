import { toV2 } from "@/lib/v2-legacy-redirect";

export default async function LegacyAdultArticlesSlugPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { slug } = await params;
  return toV2(`/v2/adult/articles/${encodeURIComponent(slug)}`, await searchParams);
}
