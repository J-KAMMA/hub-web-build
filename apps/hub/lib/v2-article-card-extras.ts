/*
 * 記事一覧のカードに添える情報。HubArticleContent（Vault・Hubpedia と共通の契約）を
 * 変えずに、Hubの書き手の記事だけが持つ値を contentId で引けるようにする。
 * クライアントの一覧からも読むので、サーバー専用のモジュールをここへ入れない。
 */

import { READING_CHARS_PER_MINUTE } from "@/lib/article-reading";

export type ArticleCardExtra = {
  readingMinutes: number;
  authorHandle: string | null;
  authorAvatarUrl: string | null;
  /* いいねの数。誰にでも見せる。0 や未取得のときは出さない。 */
  likeCount?: number;
};

export type ArticleCardExtras = Record<string, ArticleCardExtra>;

/* 読了時間は読む画面と同じ規則（lib/article-reading.ts）。字数は日本語の字として数える。 */
export function estimateReadingMinutes(chars: number): number {
  return Math.max(1, Math.ceil(Math.max(0, chars) / READING_CHARS_PER_MINUTE));
}

export function articleCardExtras(
  cards: readonly { id: string; bodyChars: number; authorHandle: string | null; authorAvatarUrl: string | null }[],
  likeCounts?: ReadonlyMap<string, number>,
): ArticleCardExtras {
  const result: ArticleCardExtras = {};
  for (const card of cards) {
    result[`member:${card.id}`] = {
      readingMinutes: estimateReadingMinutes(card.bodyChars),
      authorHandle: card.authorHandle,
      authorAvatarUrl: card.authorAvatarUrl,
      likeCount: likeCounts?.get(card.id) ?? 0,
    };
  }
  return result;
}
