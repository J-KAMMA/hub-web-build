import { toV2Permanent } from "@/lib/v2-legacy-redirect";

/* 2026-10-29: 攻略はコミュニティ側へ移った。恒久転送。 */
export default async function V2GameGuideMovedPage({ params, searchParams }: {
  params: Promise<{ gameSlug: string; guidePath: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { gameSlug, guidePath } = await params;
  return toV2Permanent(`/v2/community/games/${encodeURIComponent(gameSlug)}/guides/${guidePath.map(encodeURIComponent).join("/")}`, await searchParams);
}
