/*
 * 相対時刻。サーバーでもクライアントでも呼ぶので、"use client" の部品には置かない。
 *
 * 2026-09-02、これを v2-post.tsx（"use client"）から export していて、サーバーの
 * 一覧ページが呼んだ瞬間に「Attempted to call relativeTime() from the server but
 * relativeTime is on the client」で500になった。クライアント境界のファイルから
 * 出た関数は、サーバーからはクライアント参照になって呼べない。
 */
export function relativeTime(value: string, locale: string): string {
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return "";
  const ja = locale === "ja";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return ja ? "たった今" : "just now";
  if (minutes < 60) return ja ? `${minutes}分前` : `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return ja ? `${hours}時間前` : `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return ja ? `${days}日前` : `${days}d`;
  return new Date(value).toLocaleDateString(ja ? "ja-JP" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
