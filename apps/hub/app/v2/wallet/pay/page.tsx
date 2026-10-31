import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { MerchantPaymentCheckout } from "@/components/merchant-payment-checkout";
import { UiStatePanel } from "@/components/ui/primitives";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";
import "../../v2-luxe.css";
import "../../v2-luxe-account.css";
import "../../v2-account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "支払い | Hub v2",
};

export default async function V2WalletPaymentPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <p className="v2-column__title">{japanese ? "支払い" : "Pay"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/wallet/tax"><span className="v2-nav__label">{japanese ? "支払いと税務" : "Payments and tax"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/market/orders"><span className="v2-nav__label">{japanese ? "注文" : "Orders"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/account/payment"><span className="v2-nav__label">{japanese ? "支払いと売上" : "Payments and sales"}</span></Link></li>
      </ul>
    </>
  );

  return (
    <V2Shell
      skin="luxe"
      currentPath="/v2/wallet/pay"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "支払い" : "Pay"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "支払い" : "Pay"} />
      <Suspense
        fallback={
          <UiStatePanel
            state="loading"
            title="支払い内容を確認しています"
            description="商品、金額、支払先を安全に読み込んでいます。"
          />
        }
      >
        <MerchantPaymentCheckout />
      </Suspense>
    </V2Shell>
  );
}
