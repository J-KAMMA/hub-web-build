import { V2ArticleQuoteButton } from "@/components/v2/v2-article-quote";
import { loadGatesForTargets } from "@/lib/server/gated-content";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";

/**
 * 引用ボタンの出し分け。条件付き（トークンゲート）の記事には出さない。
 * 条件を満たして本文が見えている読者にも出さない: 鍵付きの文章を投稿・フィードへ流さないため。
 * 本文が閉じている読者には、そもそも本文が描画されないので引用する対象が無い。
 * 条件の有無が分からないとき（D1が無い・読み出しの失敗）は出さない。
 */
export async function V2ArticleQuote({
  articleId,
  viewerId,
  locked,
  japanese,
}: {
  articleId: string;
  viewerId: string | null;
  locked: boolean;
  japanese: boolean;
}) {
  if (locked) return null;
  const database = getOptionalHubD1();
  if (!database) return null;
  try {
    const gates = await loadGatesForTargets(database, "article", [articleId]);
    if (gates.size > 0) return null;
  } catch {
    return null;
  }
  return <V2ArticleQuoteButton articleId={articleId} viewerId={viewerId} japanese={japanese} />;
}
