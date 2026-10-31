import type { Metadata } from "next";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2NativeWallet } from "@/components/v2/v2-native-wallet";
import { V2State } from "@/components/v2/v2-state";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../v2-luxe.css";
import "../v2-luxe-account.css";
import "../v2-account.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ウォレット | Hub v2",
};

/*
 * Web版Hub本体のウォレット。パスキー＋ERC-4337スマートアカウントを
 * ページ内で完結させる（非カストディアル。鍵は端末の認証器のみ）。
 * 操作本体はクライアント部品 V2NativeWallet、署名・送信の確認は
 * NativeWalletHost の承認ダイアログが担う。
 */
export default async function V2WalletPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <ul className="v2-nav__list">
      <li><a className="v2-nav__item" href="#v2-wallet-account"><span className="v2-nav__label">{japanese ? "アカウント・残高" : "Account & balance"}</span></a></li>
      <li><a className="v2-nav__item" href="#v2-wallet-send"><span className="v2-nav__label">{japanese ? "送金" : "Send"}</span></a></li>
      <li><Link className="v2-nav__item" href="/v2/wallet/pay"><span className="v2-nav__label">{japanese ? "支払い確認" : "Payment confirmation"}</span></Link></li>
      <li><Link className="v2-nav__item" href="/v2/wallet/tax"><span className="v2-nav__label">{japanese ? "税務" : "Tax"}</span></Link></li>
      <li><Link className="v2-nav__item" href="/v2/account/payment"><span className="v2-nav__label">{japanese ? "支払いと売上" : "Payments and sales"}</span></Link></li>
    </ul>
  );

  return (
    <V2Shell
      skin="luxe"
      currentPath="/v2/wallet"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "ウォレット" : "Wallet"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "ウォレット" : "Wallet"}
      />
      <p className="v2-note">{japanese ? "JPYCのあるチェーン（Ethereum・Polygon・Avalanche・Kaia）。拡張機能・外部ウォレットでの連携は「支払いと売上」から。" : "JPYC networks (Ethereum, Polygon, Avalanche, Kaia). Extension/external-wallet linking lives under Payments and sales."}</p>
      {shell.currentProfile.id
        ? <V2NativeWallet japanese={japanese} />
        : <V2State kind="signedOut" next="/v2/wallet" japanese={japanese} icon="wallet" note={japanese ? "ログインするとウォレットが使えます。" : "Sign in to use the wallet."} />}
    </V2Shell>
  );
}
