import Link from "next/link";
import type { ReactNode } from "react";

// 2026-10-11 redesign layers. Load order is not guaranteed against each page's
// v2.css import, so their selectors carry enough specificity on their own.
import "@/app/v2/redesign-shell.css";
import "@/app/v2/redesign-aside.css";
import "@/app/v2/redesign-home.css";
// Hub Desktop と同じ骨組み（2026-10-18）。上の層より後に読む。
import "@/app/v2/desktop-parity.css";

import { ToastProvider } from "@/components/v2/ui/toast";
import { V2Columns } from "@/components/v2/v2-columns";
import { directoryContent } from "@/components/v2/v2-directory-content";
import { V2NavGroups } from "@/components/v2/v2-nav-groups";
import { distinctDirectoryTitle, pageHeadingTitle } from "@/components/v2/v2-page-composition";
import { V2Hotkeys } from "@/components/v2/v2-hotkeys";
import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import type { Profile } from "@/lib/domain";
import { TranslationPreferenceProvider } from "@/components/translation-preference-provider";
import { profileNavAvatar } from "@/lib/v2-nav-avatar";
import { HubSurfaceProvider } from "@/lib/hub-surface-context";

/*
 * v2 のシェル。既存の AppShell とは別物で、既存には触れない。
 *
 * 列はナビ・本文・右列（2026-10-11）。内側左列は無く、画面の目録（directory）は
 * 本文の見出しの下の横並びのタブになる。ナビは1本の列で、ハンバーガーで開閉する。
 * 右列は右端上部のボタンで開閉する。中身を渡されなかった列は作らない。
 *
 * 開け閉めは V2Columns が持つ。ここはサーバー側の組み立てだけを受け持つ。
 */

export type V2NavItem = {
  href: string;
  label: string;
  /* 行の頭の記号。無ければ字だけ。 */
  icon?: V2IconName;
  count?: number;
  /* 直前に群の余白を入れる（線は引かない）。 */
  gapBefore?: boolean;
  /* 未読数が全体のイベントで動く項目。通知とメッセージ。 */
  live?: "notifications" | "messages";
  /* ウォレット・プロフィール・設定。列の下端にまとめる。群の見出しは無い。 */
  bottom?: boolean;
  /* 本人のプロフィールの行。href は V2Shell が本人のハンドルで差し替える（未ログインはログイン）。 */
  profile?: boolean;
  /* プロフィールの行だけ、記号の代わりに本人の顔（丸）を出す。src が無ければ頭字。 */
  avatar?: { name: string | null; src: string | null };
};

/*
 * 本文の測り（SPEC 4.1）。タイムライン型の1列は 600px、一覧・動画・記事・音楽などは可変。
 * 画面ごとの内側の幅は各画面の CSS が決める。ここは外郭の幅だけ。
 */
const NARROW_PREFIXES = ["/v2/posts", "/v2/threads", "/v2/bbs", "/v2/notifications", "/v2/profile", "/v2/search", "/v2/tag", "/v2/bookmarks", "/v2/lists"];
/* 動画・音楽・フィード・記事の一覧は、フォロー中とマイページの内側の列を左に持つ（2026-10-16）。 */
const MEDIA_COLUMN_PATHS = ["/v2", "/v2/videos", "/v2/music", "/v2/articles"];

export function shellMeasure(path: string): "narrow" | "wide" {
  const base = path.split("?")[0];
  if (base === "/v2" || base === "/v2/feed") return "narrow";
  return NARROW_PREFIXES.some((prefix) => base === prefix || base.startsWith(`${prefix}/`)) ? "narrow" : "wide";
}

/*
 * 本文の幅は2つだけ（S6, 2026-10-30）。reading は --v2-width-reading（720px）で中央、
 * workspace は枠いっぱい（--v2-width-full まで）。フォーム・設定・記事・タイムライン型は reading。
 */
const READING_PREFIXES = ["/v2/settings", "/v2/account", "/v2/wallet", "/v2/onboarding", "/v2/auth", "/v2/articles/new", "/v2/commissions/new", "/v2/legal", "/v2/terms", "/v2/privacy", "/v2/about", "/v2/appeal", "/v2/copyright", "/v2/contacts"];

export function shellLayout(path: string): "reading" | "workspace" {
  const base = path.split("?")[0];
  if (shellMeasure(base) === "narrow") return "reading";
  return READING_PREFIXES.some((prefix) => base === prefix || base.startsWith(`${prefix}/`)) ? "reading" : "workspace";
}

export function V2Shell({
  currentPath,
  pageTitle,
  profile,
  items,
  directoryTitle,
  directory,
  directoryRail,
  directoryEssential,
  aside,
  children,
  japanese = true,
  skin,
}: {
  currentPath: string;
  pageTitle?: string;
  profile: Profile;
  items: V2NavItem[];
  directoryTitle?: ReactNode;
  directory?: ReactNode;
  /* 目録タブの行に添える汎用の部品（戻る・作る・検索）。 */
  directoryRail?: ReactNode;
  directoryEssential?: boolean;
  aside?: ReactNode;
  children: ReactNode;
  japanese?: boolean;
  /* 見た目の層（2026-10-30）。luxe はタイムラインの新しい見た目。骨組みは変えず、CSS が data-skin で切り替える。 */
  skin?: "luxe";
}) {
  const sectionPath = currentPath.split("?")[0];
  const knowledge = sectionPath === "/v2/hubpedia" || sectionPath.startsWith("/v2/hubpedia/");
  const research = knowledge || sectionPath === "/v2/research" || sectionPath.startsWith("/v2/research/");
  const contextualDirectory = research ? <>
    <nav aria-label={japanese ? "プロジェクトと研究" : "Projects & Research"}>
      <ul className="v2-nav__list">
        <li><Link className="v2-nav__item" href="/v2/research" aria-current={!knowledge ? "page" : undefined}><V2Icon name="research" className="v2-nav__icon" /><span className="v2-nav__label">{japanese ? "プロジェクト" : "Projects"}</span></Link></li>
        <li><Link className="v2-nav__item" href="/v2/hubpedia" aria-current={knowledge ? "page" : undefined}><V2Icon name="book" className="v2-nav__icon" /><span className="v2-nav__label">{japanese ? "資料・知識" : "Reference & Knowledge"}</span></Link></li>
      </ul>
    </nav>
    {directory}
  </> : directory;
  const signedIn = Boolean(profile.id);
  const navItems = items.map((item) => item.profile
    ? { ...item, href: signedIn ? `/v2/profile/${profile.handle}` : "/v2/auth", label: signedIn ? item.label : japanese ? "ログイン" : "Sign in", avatar: profileNavAvatar(profile) }
    : item);
  const nav = <V2NavGroups items={navItems} currentPath={currentPath} japanese={japanese} />;

  return (
    /*
     * 中の部品に「ここは v2 だ」と配る（2026-09-04）。共有の部品はこれを見て、
     * 行き先を v2 の中に留める。v2 の画面はすべてこの外郭を通る。
     */
    <HubSurfaceProvider surface="/v2">
    {/*
      * 翻訳の設定（2026-09-05）。既存は app-shell が同じものを置いている。
      * v2 に無かったので、useTranslationPreference は context の既定値
      * （preferences {}、updateLanguage は常に false）を返していた。
      * 型も検査も通ったまま、v2 では翻訳の設定が読み込まれず、
      * 切り替えても保存されない状態だった。
      */}
    <TranslationPreferenceProvider loadRemote={Boolean(profile.id)}>
    <div className="v2" data-skin={skin}>
    <ToastProvider>
      <V2Hotkeys japanese={japanese} />
      <V2Columns
        nav={nav}
        directoryTitle={distinctDirectoryTitle(directoryTitle, pageTitle ?? pageHeadingTitle(children))}
        directory={directoryContent(contextualDirectory)}
        directoryRail={directoryRail}
        directoryEssential={directoryEssential}
        aside={aside}
        measure={shellMeasure(sectionPath)}
        layout={shellLayout(sectionPath)}
        directoryPlacement={knowledge || research || MEDIA_COLUMN_PATHS.includes(sectionPath) || sectionPath === "/v2/settings" || sectionPath.startsWith("/v2/settings/") ? "side" : "top"}
        hideDirectory={sectionPath.startsWith("/v2/videos/") || sectionPath === "/v2/onboarding"}
        hideSearch={sectionPath === "/v2/search"}
        defaultNavOpen={skin === "luxe"}
        composeLabel={sectionPath === "/v2" ? (japanese ? "投稿する" : "Compose") : undefined}
        menu={{
          items: navItems.map(({ href, label, icon }) => ({ href, label, icon })),
          currentPath,
          title: japanese ? "メニュー" : "Menu",
          close: japanese ? "閉じる" : "Close",
        }}
        labels={{
          open: japanese ? "開く" : "Open",
          close: japanese ? "閉じる" : "Close",
          nav: japanese ? "ナビ" : "Navigation",
          directory: typeof directoryTitle === "string" ? directoryTitle : japanese ? "ページ内の切り替え" : "Page sections",
          aside: japanese ? "右の列" : "Side column",
          pin: japanese ? "固定して開く" : "Pin open",
          search: japanese ? "Hubを検索" : "Search Hub",
          columns: japanese ? "サイドバーを切り替える" : "Toggle sidebar",
        }}
      >
        {children}
      </V2Columns>
    </ToastProvider>
    </div>
    </TranslationPreferenceProvider>
    </HubSurfaceProvider>
  );
}
