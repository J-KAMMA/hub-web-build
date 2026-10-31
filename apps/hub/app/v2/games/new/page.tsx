import { toV2Permanent } from "@/lib/v2-legacy-redirect";

/* 2026-10-29: 攻略のためのゲーム登録はコミュニティ側へ移った。恒久転送。 */
export default async function V2NewGameMovedPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return toV2Permanent("/v2/community/games/new", await searchParams);
}
