/*
 * 投稿者が貼ったリンクが紹介リンクかどうかの判定。カードの「PR」表示のためだけに使う。
 *
 * Hub自身は紹介料を受け取らない（2026-10-15、アフィリエイトを外した）。ここは
 * 投稿者の紹介リンクを見分けて、読む人へ開示するための判定で、リンクを作らない。
 */
const AMAZON_JP_TAG = /^[a-zA-Z0-9_-]{1,64}-22$/;
const AFFILIATE_HOSTS = new Set([
  "hb.afl.rakuten.co.jp",
  "ck.jp.ap.valuecommerce.com",
]);

export function isAffiliateUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const hostname = url.hostname.toLowerCase();
    if (AFFILIATE_HOSTS.has(hostname)) return true;
    return hostname === "www.amazon.co.jp" && AMAZON_JP_TAG.test(url.searchParams.get("tag")?.trim() ?? "");
  } catch {
    return false;
  }
}
