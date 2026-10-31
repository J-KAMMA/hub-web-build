/*
 * 現在地の判定（ナビ・携帯の下タブ・携帯のメニューで共有する）。
 *
 * 詳細画面や別名でもナビの項目を光らせる。投稿・スレッドはタイムラインのタブなので、
 * その画面と詳細もタイムライン。ナビに無い機能の画面（コミュニティ・リスト・保存など）は
 * 「すべての機能」。タイムラインを光らせたままにしない（2026-10-14、SPEC 4.1）。
 */
const ALIASES: Record<string, string> = {
  "/v2/posts": "/v2",
  "/v2/threads": "/v2",
  "/v2/bbs": "/v2",
  /* Hubpedia は研究の中の「資料・知識」。研究の行を光らせる（監査 S9）。 */
  "/v2/hubpedia": "/v2/research",
  ...Object.fromEntries(
    ["community", "lists", "code", "store", "work", "compute", "intent", "earnings", "advertising", "node", "vault", "token"]
      .map((name) => [`/v2/${name}`, "/v2/services"]),
  ),
};

export function isCurrent(itemHref: string, currentPath: string): boolean {
  const base = currentPath.split("?")[0];
  if (itemHref === base) return true;
  for (const [prefix, target] of Object.entries(ALIASES)) {
    if ((base === prefix || base.startsWith(`${prefix}/`)) && itemHref === target) return true;
  }
  /* 別名に当たる道は、前方一致の別の項目には属さない（/v2/market と /v2/music など別の項目は影響しない）。 */
  return itemHref !== "/v2" && base.startsWith(`${itemHref}/`);
}
