import Link from "next/link";
import type { ReactNode } from "react";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2PageHeader } from "@/components/v2/v2-columns";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../app/v2/v2-luxe.css";
import "../../app/v2/v2-luxe-account.css";

/*
 * アカウント5画面の共通の枠。内側左列に5画面と関係する既存の入口を並べる。
 * 中身（鍵・端末・復旧・取引）は認証に関わるので既存の部品をそのまま置く。
 * 既存の app/account.css をここで読む（部品がその見た目を前提にしている）。
 */
export const ACCOUNT_PAGES = [
  { href: "/v2/account", ja: "概要", en: "Overview" },
  { href: "/v2/account/transactions", ja: "取引", en: "Transactions" },
  { href: "/v2/account/identity", ja: "本人・事業者確認", en: "Identity" },
  { href: "/v2/account/payment", ja: "支払いと売上", en: "Payments" },
  { href: "/v2/account/desktop", ja: "Desktop端末の承認", en: "Desktop device" },
] as const;

export async function V2AccountShell({ currentPath, title, note, panelOwnsHeading = false, children }: {
  currentPath: string;
  title: string;
  note?: ReactNode;
  /* 本文が見出しを持つときは、枠の重複見出しを出さない。 */
  panelOwnsHeading?: boolean;
  children: ReactNode;
}) {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  return (
    <V2Shell
      skin="luxe"
      currentPath={currentPath}
      pageTitle={title}
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "アカウント" : "Account"}
      directory={
        <ul className="v2-nav__list">
          {ACCOUNT_PAGES.filter((page) => page.href !== "/v2/account/desktop").map((page) => (
            <li key={page.href}><Link className="v2-nav__item" href={page.href} aria-current={page.href === currentPath ? "page" : undefined}><span className="v2-nav__label">{japanese ? page.ja : page.en}</span></Link></li>
          ))}
          <li><Link className="v2-nav__item" href="/v2/settings"><span className="v2-nav__label">{japanese ? "設定" : "Settings"}</span></Link></li>
          <li>
            <details>
              <summary className="v2-nav__item"><span className="v2-nav__label">{japanese ? "その他" : "More"}</span></summary>
              <ul className="v2-nav__list v2-nav__list--nested">
                <li><Link className="v2-nav__item" href="/v2/account/desktop" aria-current={currentPath === "/v2/account/desktop" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "Desktop端末の承認" : "Desktop device"}</span></Link></li>
                <li><Link className="v2-nav__item" href="/v2/developers/services"><span className="v2-nav__label">{japanese ? "開発者サービス" : "Developer services"}</span></Link></li>
                <li><Link className="v2-nav__item" href="/v2/advertising"><span className="v2-nav__label">{japanese ? "広告" : "Ads"}</span></Link></li>
                {shell.currentProfile.id ? <li><Link className="v2-nav__item" href={`/v2/profile/${shell.currentProfile.handle}`}><span className="v2-nav__label">{japanese ? "公開プロフィール" : "Public profile"}</span></Link></li> : null}
              </ul>
            </details>
          </li>
        </ul>
      }
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2PageHeader panelOwnsHeading={panelOwnsHeading} title={title} action={note ? <span className="v2-heading__note">{note}</span> : undefined} />
      {children}
    </V2Shell>
  );
}
