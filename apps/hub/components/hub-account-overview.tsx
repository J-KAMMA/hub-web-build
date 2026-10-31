import Link from "next/link";
import { HubAccountLinkSettings } from "./hub-account-link-settings";
import { AccountRecoveryPanel } from "./account-recovery-panel";
import { AccountStoragePanel } from "./account-storage-panel";
import { HubAccountControls } from "./hub-account-controls";
import { DesktopDeviceList } from "./desktop-device-list";
import type { HubLocale } from "@/lib/i18n";
import { isOptionalServiceEnabled } from "@/lib/optional-services";

export function HubAccountOverview({ displayName, handle, locale }: { displayName: string; handle: string; locale: HubLocale }) {
  return <section className="hub-account">
    <header className="hub-account__header">
      <div><small>Hubアカウント</small><h1>{displayName}</h1><p>@{handle}</p></div>
      <Link href={`/profile/${encodeURIComponent(handle)}`}>公開プロフィールを見る</Link>
    </header>

    <section className="hub-account__privacy" aria-labelledby="account-privacy-heading">
      <div><h2 id="account-privacy-heading">公開名で利用できます</h2><p>投稿、レビュー、出品一覧ではHubの表示名を使います。本名、住所、電話番号、本人確認書類、注文番号、支払い情報は公開しません。</p></div>
      <span>公開プロフィールと取引情報を分離</span>
    </section>

    <nav className="hub-account__areas" aria-label="アカウント機能">
      <Link href={`/profile/${encodeURIComponent(handle)}`}><small>公開</small><strong>プロフィール</strong><span>表示名、投稿、レビュー</span></Link>
      <Link href="/account/transactions"><small>非公開</small><strong>取引</strong><span>購入、販売、応募、問い合わせ</span></Link>
      <Link href="/settings"><small>管理</small><strong>セキュリティと設定</strong><span>ログイン、公開範囲、端末</span></Link>
    </nav>

    <section className="hub-account__section" id="account-session" aria-labelledby="account-session-title">
      <header>
        <div>
          <h2 id="account-session-title">ログインとデータ</h2>
          <p className="hub-account__lead">ログイン中の端末、データの書き出し、プロフィールの削除申請を管理します。</p>
        </div>
      </header>
      <HubAccountControls />
    </section>

    <AccountRecoveryPanel />
    {isOptionalServiceEnabled("account-link") ? <HubAccountLinkSettings /> : null}
    <DesktopDeviceList />

    <section className="hub-account__section" id="account-storage" aria-labelledby="account-storage-title">
      <header>
        <div>
          <h2 id="account-storage-title">ストレージ</h2>
          <p className="hub-account__lead">Hub、Music、Video、Vaultで共有する保存容量を確認できます。</p>
        </div>
      </header>
      <AccountStoragePanel locale={locale} />
    </section>

    <section className="hub-account__section">
      <header><h2>取引</h2><Link href="/account/transactions">すべて見る</Link></header>
      <div className="hub-account__links">
        <Link href="/market/orders"><strong>注文・返品</strong><span>実物商品の配送状況と返品</span></Link>
        <Link href="/work"><strong>仕事</strong><span>応募、依頼、契約</span></Link>
      </div>
    </section>
  </section>;
}
