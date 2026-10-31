import { toV2 } from "@/lib/v2-legacy-redirect";

/* ブラウザ行き先はデスクトップアプリの機能になった。Web 側のページは
   撤去したので、残った導線はフィードへ戻す（2026-10-05）。 */
export default async function LegacyBrowserPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return toV2("/v2", await searchParams);
}
