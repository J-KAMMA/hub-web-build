import Link from "next/link";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2Connections } from "@/components/v2/v2-connections";
import { V2RemoteFollow } from "@/components/v2/v2-remote-follow";
import { V2Shell } from "@/components/v2/v2-shell";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubLocale } from "@/lib/server/locale";
import { getProfilePageData } from "@/lib/server/profile-page-data";
import { v2NavItems } from "@/lib/v2-nav";

import "@/app/v2/v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-social.css";

/*
 * フォロワー／フォロー中の画面。2つの経路が同じ形なので、組み立てはここ1つ。
 * 既存の /profile/{handle}/followers・following から機能だけを抜いた: 40件ずつの一覧、
 * プロフィールへ戻る、見つからないときの表示。
 */
export async function V2ProfileConnectionsPage({ handle, kind }: { handle: string; kind: "followers" | "following" }) {
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const [shell, data] = await Promise.all([getAppShellData(), getProfilePageData(handle, true)]);
  const items = v2NavItems(japanese, { notifications: shell.unreadIndicatorCount, messages: shell.unreadMessageCount });
  const title = kind === "followers" ? (japanese ? "フォロワー" : "Followers") : (japanese ? "フォロー中" : "Following");
  const profile = data.profile;

  const directory = profile ? (
    <ul className="v2-nav__list">
      <li><Link className="v2-nav__item" href={`/v2/profile/${profile.handle}`}><span className="v2-nav__label">{japanese ? "プロフィール" : "Profile"}</span></Link></li>
      <li><Link className="v2-nav__item" href={`/v2/profile/${profile.handle}/followers`} aria-current={kind === "followers" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "フォロワー" : "Followers"}</span></Link></li>
      <li><Link className="v2-nav__item" href={`/v2/profile/${profile.handle}/following`} aria-current={kind === "following" ? "page" : undefined}><span className="v2-nav__label">{japanese ? "フォロー中" : "Following"}</span></Link></li>
    </ul>
  ) : undefined;

  return (
    <V2Shell skin="luxe"
      currentPath={`/v2/profile/${handle}/${kind}`}
      profile={shell.currentProfile}
      items={items}
      directoryTitle={profile?.displayName ?? title}
      directory={directory}
      aside={<V2Aside posts={shell.socialPosts} japanese={japanese} signedIn={Boolean(shell.currentProfile.id)} viewerId={shell.currentProfile.id} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead
        heading
        title={title}
        action={profile ? <Link className="v2-card__link" href={`/v2/profile/${profile.handle}`}>{japanese ? `← ${profile.displayName}` : `← ${profile.displayName}`}</Link> : undefined}
      />
      {profile && kind === "following" && data.isCurrentUser ? <V2RemoteFollow japanese={japanese} /> : null}
      {profile
        ? <V2Connections handle={profile.handle} kind={kind} japanese={japanese} />
        : <p className="v2-note">{japanese ? "このプロフィールは見つかりません。" : "This profile could not be found."}</p>}
    </V2Shell>
  );
}
