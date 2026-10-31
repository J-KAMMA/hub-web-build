import type { Metadata } from "next";
import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2ExternalFeed } from "@/components/v2/v2-external-feed";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";

import "../../v2.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "外部フィード | Hub v2",
};

/* 既存の /feed/external。フィードの並びの1つとして内側左列から辿れる。 */
export default async function V2ExternalFeedPage() {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const shell = await getAppShellData();
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });

  return (
    <V2Shell
      currentPath="/v2"
      profile={shell.currentProfile}
      items={items}
      directoryTitle={japanese ? "フィード" : "Feed"}
      directory={
        <ul className="v2-nav__list">
          <li><Link className="v2-nav__item" href="/v2"><span className="v2-nav__label">{japanese ? "おすすめ" : "For you"}</span></Link></li>
          <li><Link className="v2-nav__item" href="/v2?feed=following"><span className="v2-nav__label">{japanese ? "フォロー中" : "Following"}</span></Link></li>
          <li><Link className="v2-nav__item" href="/v2/feed/external" aria-current="page"><span className="v2-nav__label">{japanese ? "外部SNS" : "External"}</span></Link></li>
        </ul>
      }
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead heading title={japanese ? "外部SNSのフィード" : "External feed"} action={<span className="v2-heading__note">AT Protocol</span>} />
      {shell.currentProfile.id
        ? <V2ExternalFeed japanese={japanese} locale={locale} />
        : (
          <p className="v2-note v2-reply-auth">
            <Link href="/v2/auth?next=/v2/feed/external">{japanese ? "ログイン" : "Sign in"}</Link>{japanese ? "すると外部SNSのフィードが見られます。" : " to see the external feed."}
          </p>
        )}
    </V2Shell>
  );
}
