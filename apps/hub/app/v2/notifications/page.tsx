import type { Metadata } from "next";
import Link from "next/link";

import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2State } from "@/components/v2/v2-state";
import { V2Notifications } from "@/components/v2/v2-notifications";
import { Tabs } from "@/components/v2/ui/tabs";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { getNotificationsPageData } from "@/lib/server/notifications-page-data";
import { v2NavItems } from "@/lib/v2-nav";
import { V2_NOTIFICATION_TABS, type V2NotificationTab } from "@/lib/v2-notifications";

import "../v2.css";
import "../redesign-sns.css";
import "./notifications-more.css";
import "../v2-luxe.css";
import "../v2-luxe-social.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "通知 | Hub v2",
};

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/*
 * v2 の通知。既存の /notifications には触れない。データは既存の
 * getNotificationsPageData をそのまま使う（メッセージ受信は除外済み）。
 * 未ログインは既存と同じくログインへ（既存は redirect、ここは案内を出す。
 * 開発の bypass で開いた頁に redirect を混ぜると走査が「開けなかった」になる）。
 *
 * 内側左列: 区分6つ（数つき）と、既存の画面への入口（通知の設定）。
 */
export default async function V2NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const requestedTab = one(params.tab);
  const tab: V2NotificationTab = V2_NOTIFICATION_TABS.some((item) => item.id === requestedTab) ? requestedTab as V2NotificationTab : "all";
  const query = one(params.q).trim().slice(0, 80);

  const [shell, data] = await Promise.all([getAppShellData(), getNotificationsPageData({ mentions: tab === "mentions" })]);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  const href = (patch: { tab?: string; q?: string }) => {
    const merged = { tab: tab === "all" ? "" : tab, q: query, ...patch };
    const next = new URLSearchParams();
    if (merged.tab) next.set("tab", merged.tab);
    if (merged.q) next.set("q", merged.q);
    const search = next.toString();
    return `/v2/notifications${search ? `?${search}` : ""}`;
  };

    const tabItems = V2_NOTIFICATION_TABS.map((item) => ({
    id: item.id,
    label: japanese ? item.ja : item.en,
    href: href({ tab: item.id === "all" ? "" : item.id }),
  }));
  const hasAny = Boolean(data && (data.notifications.length > 0 || query));

  return (
    <V2Shell skin="luxe"
      currentPath="/v2/notifications"
      profile={shell.currentProfile}
      items={items}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={japanese ? "通知" : "Notifications"}
        action={<Link className="v2-heading__note" href="/v2/settings#v2-settings-notifications">{japanese ? "通知の設定" : "Settings"}</Link>}
      />

      {data ? <div className="v2-subtabs"><Tabs items={tabItems} value={tab} label={japanese ? "通知の種類" : "Notification type"} /></div> : null}

      {!data ? (
        <V2State kind="signedOut" icon="bell" next="/v2/notifications" japanese={japanese} note={japanese ? "ログインすると通知が見られます。" : "Sign in to see notifications."} />
      ) : (
        <>
          {hasAny ? <details className="v2-filter-disclosure" open={query ? true : undefined}>
            <summary>{japanese ? "絞り込み" : "Filter"}</summary>
            <div className="v2-filter-disclosure__body">
          <form className="v2-search__form" role="search" action="/v2/notifications" method="get">
            {tab !== "all" ? <input type="hidden" name="tab" value={tab} /> : null}
            <input type="search" name="q" defaultValue={query} maxLength={80} placeholder={japanese ? "通知を検索" : "Search notifications"} aria-label={japanese ? "通知を検索" : "Search notifications"} />
            <button type="submit" className="v2-search__submit">{japanese ? "検索" : "Search"}</button>
          </form>
            </div>
          </details> : null}
          <V2Notifications
            key={`${tab}:${query}`}
            initialNotifications={tab === "mentions" && data.mentions ? data.mentions.notifications : data.notifications}
            initialCursor={tab === "mentions" ? data.mentions?.nextCursor ?? null : null}
            profiles={data.profiles}
            threadPostDestinations={data.threadPostDestinations}
            communityMessageDestinations={data.communityMessageDestinations}
            initialUnread={data.notificationCount}
            tab={tab}
            query={query}
            locale={locale}
          />
        </>
      )}
    </V2Shell>
  );
}
