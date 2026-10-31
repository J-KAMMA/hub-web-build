import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { V2AccountShell } from "@/components/v2/v2-account-shell";
import { V2WalletLinks } from "@/components/v2/v2-wallet-links";
import { getHubLocale } from "@/lib/server/locale";
import { getHubViewer } from "@/lib/server/hub-viewer";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "支払いと売上 | Hub v2",
};

/* 既存の /account/payment と同じ文言と入口。決済そのものは Commerce 側。 */
export default async function V2AccountPaymentPage() {
  const [viewer, locale] = await Promise.all([getHubViewer(), getHubLocale()]);
  if (!viewer) redirect("/v2/auth?next=/v2/account/payment");
  const japanese = locale === "ja";
  return (
    <V2AccountShell currentPath="/v2/account/payment" title={japanese ? "支払いと売上" : "Payments and sales"}>
      <section className="v2-msec" aria-labelledby="v2-payment-separation">
        <header className="v2-msec__head"><h2 id="v2-payment-separation" className="v2-column__title v2-column__title--section">{japanese ? "決済情報は Hub に保存しない" : "Payment details are not stored in Hub"}</h2></header>
        <p className="v2-note">{japanese ? "Commerce が支払いと会計記録を管理し、Hub には処理結果と取引に必要な限定情報だけを返します。秘密鍵、カード情報、内部決済IDは Hub へ渡しません。" : "Commerce manages payments and accounting; Hub receives only outcomes and the minimum needed for a transaction. Secret keys, card details and internal payment ids never reach Hub."}</p>
      </section>
      <section className="v2-msec" aria-labelledby="v2-payment-areas">
        <header className="v2-msec__head"><h2 id="v2-payment-areas" className="v2-column__title v2-column__title--section">{japanese ? "管理する内容" : "What you manage"}</h2></header>
        <ul className="v2-account__areas">
          <li><Link href="/v2/market/orders"><strong>{japanese ? "注文と返金" : "Orders and refunds"}</strong><span>{japanese ? "注文状況、返品、返金" : "Order status, returns, refunds"}</span></Link></li>
          <li><Link href="/v2/market/sell"><strong>{japanese ? "販売と売上" : "Sales and revenue"}</strong><span>{japanese ? "売上、手数料、販売条件" : "Revenue, fees, terms"}</span></Link></li>
          <li><Link href="/v2/account/identity"><strong>{japanese ? "本人・事業者確認" : "Identity verification"}</strong><span>{japanese ? "取引に必要な確認状態" : "Verification state needed for transactions"}</span></Link></li>
        </ul>
      </section>
      {/*
        * ウォレット本体は /v2/wallet（ページ内）・拡張機能・外部ウォレット。
        * ここに残るのは署名による所有権確認でプロフィールへアドレスを
        * 連携/解除する Hub 側の機能だけ（チップ受取・ランキング・ガバナンスに使う）。
        */}
      <V2WalletLinks locale={locale} />
    </V2AccountShell>
  );
}
