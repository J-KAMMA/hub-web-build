import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { V2Aside } from "@/components/v2/v2-aside";
import { V2ChannelVideos } from "@/components/v2/v2-channel-videos";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2VideoFollow } from "@/components/v2/v2-video-follow";
import { Avatar } from "@/components/v2/ui";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubLocale } from "@/lib/server/locale";
import { AUTHOR_HANDLE } from "@/lib/server/profile-works";
import { getD1VideoChannel } from "@/lib/server/video-channel";
import { v2NavItems } from "@/lib/v2-nav";

import "../../../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  return { title: `@${handle} | チャンネル | Hub v2` };
}

/*
 * Hub動画のチャンネル。投稿者のプロフィールに紐づく（フォローもプロフィールのフォロー）。
 * 動画は keyset で24本ずつ。数え上げはしない（フォロワー数は1000で打ち切り「1000+」）。
 */
export default async function V2VideoChannelPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!AUTHOR_HANDLE.test(handle)) notFound();
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const database = getHubD1();
  const { currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount } = await getAppShellData();
  const viewerId = currentProfile.id ?? "";
  const data = await getD1VideoChannel(database, handle, viewerId || null, null);
  if (!data) notFound();
  const { channel } = data;
  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });
  const followers = `${channel.followerCount}${channel.followerCountCapped ? "+" : ""}`;

  return (
    <V2Shell skin="luxe"
      directoryRail={<V2DirectoryRail back={{ href: "/v2/videos", label: japanese ? "動画一覧へ" : "All videos" }} japanese={japanese} />}
      currentPath="/v2/videos"
      profile={currentProfile}
      items={items}
      aside={<V2Aside posts={socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={viewerId} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead title={japanese ? "チャンネル" : "Channel"} />
      <header className="v2-channel__head">
        <Avatar name={channel.displayName} src={channel.avatarUrl ?? undefined} size={96} />
        <div className="v2-channel__text">
          <h1 className="v2-channel__name">{channel.displayName}</h1>
          <p className="v2-channel__meta">
            <Link href={`/v2/profile/${encodeURIComponent(channel.handle)}`}>@{channel.handle}</Link>
            <span>{japanese ? `フォロワー ${followers}人` : `${followers} followers`}</span>
          </p>
          {channel.bio ? <p className="v2-channel__bio">{channel.bio}</p> : null}
        </div>
        {channel.isViewer ? null : (
          <div className="v2-channel__follow">
            <V2VideoFollow target={{ kind: "profile", profileId: channel.profileId }} initialFollowing={channel.viewerFollows} authenticated={Boolean(viewerId)} locale={locale} />
          </div>
        )}
      </header>
      <V2ChannelVideos handle={channel.handle} channelName={channel.displayName} initialVideos={data.videos} initialCursor={data.nextCursor} locale={locale} />
    </V2Shell>
  );
}
