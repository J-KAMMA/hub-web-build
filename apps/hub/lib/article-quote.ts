import { appendContentShare } from "@/lib/content-share";

/**
 * 記事の一節を引用して投稿するための純関数。
 * 引用は1行にまとめた「> 」つきの引用ブロックと、記事へのリンクだけを投稿の下書きに入れる。
 * 本文の一部が選ばれた範囲そのままで済むので、記事の他の部分は渡らない。
 */
export const ARTICLE_QUOTE_MAX_CHARACTERS = 280;

/** 選択文字列を引用に使える形へ。空白をまとめ、空・長すぎるときは null。 */
export function normalizeArticleQuote(raw: string): string | null {
  const text = raw.replace(/[\u0000-\u001f\u007f​-‍﻿]/gu, " ").replace(/\s+/gu, " ").trim();
  if (!text) return null;
  return Array.from(text).length > ARTICLE_QUOTE_MAX_CHARACTERS ? null : text;
}

/** 投稿の下書き本文。上限を超えるときは null（記事のリンクが入らない形では出さない）。 */
export function articleQuotePostBody(quote: string, articlePath: string, origin: string): string | null {
  const text = normalizeArticleQuote(quote);
  if (!text) return null;
  try {
    return appendContentShare(`> ${text}`, articlePath, origin);
  } catch {
    return null;
  }
}

/** 投稿の下書きの保存先（V2Compose と同じ鍵）。すでに書きかけがあれば、その後ろに足す。 */
export function mergeQuoteIntoDraft(existing: string | null, quoteBody: string): string {
  const current = (existing ?? "").trimEnd();
  if (!current) return quoteBody;
  if (current.includes(quoteBody)) return current;
  return `${current}\n\n${quoteBody}`;
}
