import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { AccountStoragePanel } from "@/components/account-storage-panel";
import { AgentAccessSettings } from "@/components/agent-access-settings";
import { DataPortabilityCenter } from "@/components/data-portability-center";
import { DistributedNetworkSettings } from "@/components/distributed-network-settings";
import { DomainAliasSettings } from "@/components/domain-alias-settings";
import { HubPersonalizationSettings } from "@/components/hub-personalization-settings";
import { ExternalProtocolSettings } from "@/components/external-protocol-settings";
import { FederationSettings } from "@/components/federation-settings";
import { PortableIdentitySettings } from "@/components/portable-identity-settings";
import { PersonalNodeSettings } from "@/components/personal-node-settings";
import { ScheduledPostManager } from "@/components/scheduled-post-manager";
import { TranslationLanguageSettings } from "@/components/translation-language-settings";
import { V2SettingsAnchor } from "@/components/v2/v2-settings-anchor";
import { HubConsentChoices } from "@/components/hub-consent-choices";
import { V2SettingsConsent } from "@/components/v2/v2-settings-consent";
import { V2SettingsDownloads } from "@/components/v2/v2-settings-downloads";
import { V2SettingsDisplay } from "@/components/v2/v2-settings-display";
import { V2SettingsLinkVerification } from "@/components/v2/v2-settings-link-verification";
import { V2SettingsPeople } from "@/components/v2/v2-settings-people";
import { V2SettingsNotifications, V2SettingsSafety } from "@/components/v2/v2-settings-server";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2State } from "@/components/v2/v2-state";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { isHubOperator, isInstanceOperator } from "@/lib/hub-operators";
import { getInstanceOrigin } from "@/lib/instance-origin";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import type { HubLocale } from "@/lib/i18n";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../v2.css";
import "../v2-luxe.css";
import "../v2-luxe-account.css";
import "./settings-people.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "設定 | Hub v2",
};

/*
 * v2 の設定。既存の /settings（13区画）のうち、表示・通知・コンテンツの安全は
 * v2 で作り直した。アカウントと容量は /v2/account に在る。
 * 残りは既存の部品をこの画面の続きに置く（2026-09-04）。内側左列が目次。
 *
 * 端末のデータ（保存した表示の好みを消す）は表示の節が持っているので足さない。
 */

/*
 * 既存の設定にしか無かった節（2026-09-04、旦那様の「古いUIを出さない」）。
 *
 * アカウントと容量は /v2/account に在るのでここには置かない。残りは
 * 部品をそのまま v2 の設定の続きに置く。中身は作り直さない——渡していたのは
 * 場所の問題で、機能の問題ではなかった。
 */
const LEGACY_SECTIONS: {
  id: string;
  ja: string;
  en: string;
  needsSignIn: boolean;
  render: (locale: HubLocale) => ReactNode;
}[] = [
  { id: "recommendations", ja: "おすすめ", en: "Recommendations", needsSignIn: false, render: () => <HubPersonalizationSettings /> },
  /*
   * 翻訳する言語（2026-09-05）。既存の表示設定の中にあった節。
   * v2 は V2SettingsDisplay が表示を持っているが、翻訳だけ入っていなかった。
   * 状態は V2Shell の TranslationPreferenceProvider が持つ。
   */
  { id: "translation", ja: "翻訳", en: "Translation", needsSignIn: false, render: (locale) => <TranslationLanguageSettings locale={locale} /> },
  /* アップロード容量。既存へ渡していた #storage の中身をそのまま置く。 */
  { id: "storage", ja: "アップロード容量", en: "Upload capacity", needsSignIn: true, render: (locale) => <AccountStoragePanel locale={locale} /> },
  { id: "posts", ja: "投稿管理", en: "Posts", needsSignIn: true, render: () => <ScheduledPostManager /> },
  { id: "agent-access", ja: "AIエージェント", en: "AI agents", needsSignIn: true, render: () => <AgentAccessSettings /> },
  {
    id: "federation",
    ja: "外部SNS連携",
    en: "Fediverse",
    needsSignIn: true,
    render: (locale) => <><FederationSettings locale={locale === "ja" ? "ja" : "en"} /><DomainAliasSettings locale={locale === "ja" ? "ja" : "en"} /></>,
  },
  { id: "portable-identity", ja: "持ち運べる身元", en: "Portable identity", needsSignIn: true, render: (locale) => <PortableIdentitySettings locale={locale === "ja" ? "ja" : "en"} /> },
  { id: "external-protocols", ja: "外部プロトコル", en: "External protocols", needsSignIn: true, render: () => <ExternalProtocolSettings /> },
  { id: "personal-node", ja: "Personal Node", en: "Personal Node", needsSignIn: true, render: (locale) => <PersonalNodeSettings locale={locale === "ja" ? "ja" : "en"} /> },
  { id: "distributed-network", ja: "分散ネットワーク", en: "Distributed network", needsSignIn: true, render: (locale) => <DistributedNetworkSettings locale={locale === "ja" ? "ja" : "en"} /> },
  { id: "data-portability", ja: "データの持ち出し", en: "Data portability", needsSignIn: true, render: () => <DataPortabilityCenter /> },
];


export default async function V2SettingsPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const signedIn = Boolean(shell.currentProfile.id);
  /* 運営者だけに連合の方針への入口を出す。判定は画面・APIと同じ（環境の名簿＋自前ハブの最初の運営者）。 */
  const database = getOptionalHubD1();
  const operatorIds = process.env.HUB_OPERATOR_PROFILE_IDS;
  const isOperator = signedIn && (database
    ? await isInstanceOperator(database, shell.currentProfile.id, operatorIds).catch(() => false)
    : isHubOperator(shell.currentProfile.id, operatorIds));
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const directory = (
    <>
      <ul className="v2-nav__list">
        <li><a className="v2-nav__item" href="#v2-settings-display"><span className="v2-nav__label">{japanese ? "表示" : "Display"}</span></a></li>
        <li><a className="v2-nav__item" href="#v2-settings-notifications"><span className="v2-nav__label">{japanese ? "通知" : "Notifications"}</span></a></li>
        <li><a className="v2-nav__item" href="#v2-settings-links"><span className="v2-nav__label">{japanese ? "リンクの本人確認" : "Link verification"}</span></a></li>
        <li><a className="v2-nav__item" href="#v2-settings-consent"><span className="v2-nav__label">{japanese ? "同意の記録" : "Consent"}</span></a></li>
        <li><a className="v2-nav__item" href="#v2-settings-downloads"><span className="v2-nav__label">{japanese ? "ダウンロード履歴" : "Download history"}</span></a></li>
        <li><a className="v2-nav__item" href="#v2-settings-safety"><span className="v2-nav__label">{japanese ? "コンテンツの安全" : "Content safety"}</span></a></li>
      </ul>
      {/*
        * アカウント（本人・事業者確認、支払いと売上、取引、Desktop端末の承認）。
        * 5画面あるのに v2 のどこからも指されていなかった（2026-09-04、到達性の走査）。
        * 既存では「アカウントを管理」から入る。v2 では設定の隣に置く。
        */}
      {/*
        * 外部プロトコルの受信（2026-09-04）。既存では設定の節から入る。
        * v2 には画面が在るのに、どこからも指されていなかった。
        */}
      <p className="v2-column__title">{japanese ? "外から届くもの" : "From outside"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/feed/external"><span className="v2-nav__label">{japanese ? "外部の受信" : "External feed"}</span></Link></li>
      </ul>

      {/*
        * つくる・管理する（2026-10-14、到達性の走査）。URLを知らないと開けなかった画面の入口。
        * 記事の一覧は「自分の記事」、閲覧条件はCreator Centerの中からだけ指されていた。
        */}
      {signedIn ? (
        <>
          <p className="v2-column__title">{japanese ? "つくる・管理する" : "Create & manage"}</p>
          <ul className="v2-nav__list">
            <li><Link className="v2-nav__item" href="/v2/creator"><span className="v2-nav__label">{japanese ? "クリエイターセンター" : "Creator Center"}</span></Link></li>
            <li><Link className="v2-nav__item" href="/v2/creator/gates"><span className="v2-nav__label">{japanese ? "閲覧条件の管理" : "Access conditions"}</span></Link></li>
            <li><Link className="v2-nav__item" href="/v2/articles/drafts"><span className="v2-nav__label">{japanese ? "記事の下書き" : "Article drafts"}</span></Link></li>
            <li><Link className="v2-nav__item" href="/v2/articles/series"><span className="v2-nav__label">{japanese ? "記事のシリーズ" : "Article series"}</span></Link></li>
            <li><Link className="v2-nav__item" href="/v2/articles/stats"><span className="v2-nav__label">{japanese ? "記事の統計" : "Article stats"}</span></Link></li>
            <li><Link className="v2-nav__item" href="/v2/ai/ui-adjust"><span className="v2-nav__label">{japanese ? "AIで画面を調整" : "Adjust the UI with AI"}</span></Link></li>
          </ul>
        </>
      ) : null}
      {isOperator ? (
        <>
          <p className="v2-column__title">{japanese ? "運営者" : "Operator"}</p>
          <ul className="v2-nav__list">
            <li><Link className="v2-nav__item" href="/v2/operator/federation"><span className="v2-nav__label">{japanese ? "連合の方針" : "Federation policy"}</span></Link></li>
            <li><Link className="v2-nav__item" href="/v2/hubpedia/patrol"><span className="v2-nav__label">{japanese ? "Hubpediaの見回り" : "Hubpedia patrol"}</span></Link></li>
          </ul>
        </>
      ) : null}

      <p className="v2-column__title">{japanese ? "アカウント" : "Account"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/account"><span className="v2-nav__label">{japanese ? "アカウントを管理" : "Manage account"}</span></Link></li>
        {/*
          * 興味の選び直し（2026-09-04）。既存では設定から /onboarding へ入れる。
          * v2 には画面が在るのに、どこからも指されていなかった。入って最初に
          * 通る画面でもあるが、後から選び直せる場所がここにしか無い。
          * ログインしていない人には出さない——開くと /auth へ送り返される。
          */}
        {signedIn ? <li><Link className="v2-nav__item" href="/v2/onboarding"><span className="v2-nav__label">{japanese ? "興味・おすすめを設定し直す" : "Update interests and recommendations"}</span></Link></li> : null}
      </ul>

      {/* 規約の入口。ナビの脚注は低い画面では畳むので、ここにも置く（2026-09-03）。 */}
      <p className="v2-column__title">{japanese ? "規約" : "Terms"}</p>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/terms"><span className="v2-nav__label">{japanese ? "利用規約" : "Terms of use"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/privacy"><span className="v2-nav__label">{japanese ? "プライバシー" : "Privacy"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/legal"><span className="v2-nav__label">{japanese ? "サービス条件" : "Service terms"}</span></Link></li>
      </ul>
      {/* 既存の設定へ渡していた節。中身ごと v2 の続きに置いたので、目次も中を指す。 */}
      <p className="v2-column__title">{japanese ? "そのほか" : "More"}</p>
      <ul className="v2-nav__list">
        {LEGACY_SECTIONS.map((section) => (
          <li key={section.id}>
            <a className="v2-nav__item" href={`#v2-settings-${section.id}`}><span className="v2-nav__label">{japanese ? section.ja : section.en}</span></a>
          </li>
        ))}
      </ul>
    </>
  );

  return (
    <V2Shell
      skin="luxe"
      currentPath="/v2/settings"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "設定" : "Settings"}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={signedIn} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "設定" : "Settings"} action={signedIn ? <span className="v2-heading__note">@{shell.currentProfile.handle}</span> : undefined} />

      <div className="v2-settings">
        {/* 既存の錨（#storage 等）で着いた人を v2 の節へ。転送は錨を運ばない。 */}
        <V2SettingsAnchor />
        {signedIn ? null : (
          <V2State kind="signedOut" compact next="/v2/settings" japanese={japanese} note={japanese ? "ログインすると変えられます。" : "Sign in to change these."} />
        )}
        <section id="v2-settings-display" className="v2-msec" aria-labelledby="v2-settings-display-title">
          <header className="v2-msec__head"><h2 id="v2-settings-display-title" className="v2-column__title v2-column__title--section">{japanese ? "表示" : "Display"}</h2><span className="v2-msec__note">{japanese ? "この端末に保存" : "Saved on this device"}</span></header>
          <V2SettingsDisplay locale={locale} />
        </section>

        {signedIn ? <section id="v2-settings-notifications" className="v2-msec" aria-labelledby="v2-settings-notifications-title">
          <header className="v2-msec__head"><h2 id="v2-settings-notifications-title" className="v2-column__title v2-column__title--section">{japanese ? "通知とメッセージ" : "Notifications & messages"}</h2></header>
          <V2SettingsNotifications locale={locale} />
        </section> : null}

        {signedIn ? <section id="v2-settings-links" className="v2-msec" aria-labelledby="v2-settings-links-title">
          <header className="v2-msec__head"><h2 id="v2-settings-links-title" className="v2-column__title v2-column__title--section">{japanese ? "リンクの本人確認" : "Link verification"}</h2></header>
          <V2SettingsLinkVerification locale={locale} origin={getInstanceOrigin()} />
        </section> : null}

        <section id="v2-settings-consent" className="v2-msec" aria-labelledby="v2-settings-consent-title">
          <header className="v2-msec__head"><h2 id="v2-settings-consent-title" className="v2-column__title v2-column__title--section">{japanese ? "同意の記録" : "Consent"}</h2></header>
          {signedIn ? <V2SettingsConsent profileId={shell.currentProfile.id} japanese={japanese} /> : <HubConsentChoices />}
        </section>

        {signedIn ? <section id="v2-settings-downloads" className="v2-msec" aria-labelledby="v2-settings-downloads-title">
          <header className="v2-msec__head"><h2 id="v2-settings-downloads-title" className="v2-column__title v2-column__title--section">{japanese ? "ダウンロード履歴" : "Download history"}</h2></header>
          <V2SettingsDownloads profileId={shell.currentProfile.id} />
        </section> : null}

        {signedIn ? <section id="v2-settings-safety" className="v2-msec" aria-labelledby="v2-settings-safety-title">
          <header className="v2-msec__head"><h2 id="v2-settings-safety-title" className="v2-column__title v2-column__title--section">{japanese ? "コンテンツの安全" : "Content safety"}</h2></header>
          <V2SettingsSafety locale={locale} />
          <V2SettingsPeople locale={locale} />
        </section> : null}

        {/*
          * ここから下は既存の設定へ渡していた節（2026-09-04、旦那様の「古いUIを
          * 出さない」）。部品はそのまま置く——中身は作り直さない。渡していたのは
          * 場所の問題で、機能の問題ではなかった。
          *
          * 節ごとに画面を分けず、v2 の設定の続きにする。既存も1枚だったので、
          * 探すときの当たりが変わらない。
          */}
        {LEGACY_SECTIONS.filter((section) => signedIn || !section.needsSignIn).map((section) => (
          <section key={section.id} id={`v2-settings-${section.id}`} className="v2-msec" aria-labelledby={`v2-settings-${section.id}-title`}>
            <header className="v2-msec__head">
              <h2 id={`v2-settings-${section.id}-title`} className="v2-column__title v2-column__title--section">
                {japanese ? section.ja : section.en}
              </h2>
            </header>
            {section.render(locale)}
          </section>
        ))}
      </div>
    </V2Shell>
  );
}
