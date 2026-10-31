/*
 * 販売チームの招待リンク（AUDIT.md 8.3-7）。
 * トークンは `#token=` に置く。フラグメントはサーバーへ送られず、リファラにも載らない。
 * 以前に配った `?token=` のリンクも受け付けるが、読んだらすぐに URL から消す。
 */
export const MERCHANT_INVITE_PATH = "/market/wallet/invite";

export function merchantInviteUrl(origin: string, token: string): string {
  return `${origin}${MERCHANT_INVITE_PATH}#token=${encodeURIComponent(token)}`;
}

/** フラグメントの token を先に、無ければ問い合わせ文字列の token（古いリンク）を読む。 */
export function readMerchantInviteToken(href: string, fallback = ""): string {
  const url = new URL(href);
  const fromHash = new URLSearchParams(url.hash.replace(/^#/, "")).get("token");
  if (fromHash) return fromHash;
  return url.searchParams.get("token") ?? fallback;
}

/** token を問い合わせ文字列とフラグメントの両方から取り除いた、同じページの URL（パス以降）。 */
export function stripMerchantInviteToken(href: string): string | null {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  if (!url.searchParams.has("token") && !hash.has("token")) return null;
  url.searchParams.delete("token");
  hash.delete("token");
  const rest = hash.toString();
  return `${url.pathname}${url.search}${rest ? `#${rest}` : ""}`;
}
