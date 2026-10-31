"use client";

import dynamic from "next/dynamic";

/* viem は重い。記事の初期バンドルに入れない。 */
const WalletTipControl = dynamic(() => import("@/components/wallet-tip-control").then((m) => m.WalletTipControl), { ssr: false });

/*
 * 記事を応援（投げ銭）。既存の非カストディアルな投げ銭の流れ（WalletTipControl）をそのまま使う。
 * 書き手が受取を有効にしていなければ WalletTipControl が何も出さない。
 * 投げ銭は贈り物で、購入ではない。何も開かない。自分の記事・未ログインでは出さない。
 */
export function V2ArticleTip({
  articleId,
  authorHandle,
  authorProfileId,
  viewerId,
  japanese = true,
}: {
  articleId: string;
  authorHandle: string | null;
  authorProfileId: string;
  viewerId: string | null;
  japanese?: boolean;
}) {
  if (!viewerId || viewerId === authorProfileId || !authorHandle) return null;
  return (
    <section className="v2-article-tip" aria-label={japanese ? "記事を応援（投げ銭）" : "Support this article (tip)"}>
      <WalletTipControl
        handle={authorHandle}
        isCurrentUser={false}
        articleId={articleId}
        openLabel={japanese ? "記事を応援（投げ銭）" : "Support this article (tip)"}
      />
      <small className="v2-article-tip__note">
        {japanese ? "書き手への贈り物です。購入ではなく、何も開きません。" : "A gift to the author. Not a purchase; it unlocks nothing."}
      </small>
    </section>
  );
}
