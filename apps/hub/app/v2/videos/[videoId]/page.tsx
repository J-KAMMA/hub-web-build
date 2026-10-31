import type { Metadata } from "next";
import { V2ContentShare } from '@/components/v2/v2-content-share';
import { ResearchDiscovery } from '@/components/research-discovery';
import Link from "next/link";
import { V2TagChipRow } from "@/components/v2/v2-tag-chip";
import { notFound } from "next/navigation";

import { VideoDetailPlayer } from "@/components/video-detail-player";
import { V2Aside } from "@/components/v2/v2-aside";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import { V2DetailSection } from "@/components/v2/v2-detail";
import { Avatar, ButtonLink } from "@/components/v2/ui";
import { V2VideoDescription } from "@/components/v2/v2-video-description";
import { formatViews } from "@/components/v2/v2-video-format";
import { V2DirectoryRail } from "@/components/v2/v2-directory-rail";
import { V2Shell } from "@/components/v2/v2-shell";
import { V2HubpediaCitations } from "@/components/v2/v2-hubpedia-citations";
import { V2VideoCard } from "@/components/v2/v2-video-card";
import { V2VideoPosts } from "@/components/v2/v2-video-posts";
import { listD1VideoPosts } from "@/lib/server/d1-video-posts";
import { V2VideoComments } from "@/components/v2/v2-video-comments";
import { V2VideoDownload } from "@/components/v2/v2-video-download";
import { V2VideoSave } from "@/components/v2/v2-video-save";
import { V2VideoLike } from "@/components/v2/v2-video-like";
import { VideoReportPicker } from "@/components/video-report-picker";
import { V2VideoFollow } from "@/components/v2/v2-video-follow";
import { getVideoFollowState } from "@/lib/server/video-channel";
import { getAppShellData } from "@/lib/server/app-shell-data";
import { listD1SavedVideos } from "@/lib/server/d1-video-library";
import { listD1VideoThreadComments } from "@/lib/server/d1-video-thread-comments";
import { getD1ExternalVideo, listD1ExternalVideosPage } from "@/lib/server/d1-videos";
import { getHubD1 } from "@/lib/server/hub-d1";
import { loadHubItemCitations } from "@/lib/server/hubpedia-citations";
import { getHubLocale } from "@/lib/server/locale";
import { v2NavItems } from "@/lib/v2-nav";
import { V2_PROVIDER_LABELS, V2_PURPOSE_LABELS, relatedVideos } from "@/lib/v2-video";

import { V2GatedLockedCard } from "@/components/v2/v2-gated-locked-card";
import "../../v2.css";
import "@/app/v2/v2-luxe.css";
import "@/app/v2/v2-luxe-pages.css";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ videoId: string }> }): Promise<Metadata> {
  const { videoId } = await params;
  const video = await getD1ExternalVideo(getHubD1(), videoId);
  return { title: video ? `${video.title} | 動画 | Hub v2` : "動画が見つかりません | Hub v2" };
}

/*
 * v2 の動画詳細。既存の /videos/[videoId] には触れない。
 * 再生は既存の VideoDetailPlayer をそのまま使う（7つの配信元・YouTubeの同意・
 * 視聴の記録はそこにある。見た目ではなく仕組みなので作り直さない）。
 *
 * 内側左列: 関連12本（式は既存の詳細と同じ、lib/v2-video.ts）。
 * 本文: 題・チャンネル・回数・配信元で見る・あとで見る・コメント。
 * まだ無いもの: プレイリストへ追加、チャンネルのフォロー、成人区分の警告文
 * （safetyNotice は出すが、再生を止める門は作っていない。既存も止めない）。
 */
export default async function V2VideoPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
  const locale = await getHubLocale();
  const japanese = locale === "ja";
  const database = getHubD1();
  const { currentProfile, socialPosts, unreadIndicatorCount, unreadMessageCount } = await getAppShellData();
  // Token gates need the viewer, so the video is read after the shell.
  const video = await getD1ExternalVideo(database, videoId, currentProfile.id || null);
  if (!video) notFound();
  const viewerId = currentProfile.id ?? "";

  const [citations, catalog, comments, saved, videoPosts] = await Promise.all([
    loadHubItemCitations("video", video.id),
    listD1ExternalVideosPage(database, 50, 0).catch(() => ({ videos: [], total: 0 })),
    listD1VideoThreadComments(database, video.id, viewerId || undefined).catch(() => []),
    viewerId ? listD1SavedVideos(database, viewerId).then((list) => list.some((item) => item.id === video.id)).catch(() => false) : Promise.resolve(false),
    listD1VideoPosts(database, video.id, viewerId || null).catch(() => ({ posts: [], nextCursor: null })),
  ]);
  const followState = video.accessGate ? null : await getVideoFollowState(database, video, viewerId || null).catch(() => null);
  const related = relatedVideos(video, catalog.videos, 12);
  const items = v2NavItems(japanese, { notifications: unreadIndicatorCount, messages: unreadMessageCount });

  return (
    <V2Shell skin="luxe" directoryRail={<V2DirectoryRail back={{ href: "/v2/videos", label: japanese ? "動画一覧へ" : "All videos" }} japanese={japanese} />}
      currentPath="/v2/videos"
      profile={currentProfile}
      items={items}
      aside={<V2Aside posts={socialPosts} japanese={japanese} signedIn={Boolean(viewerId)} viewerId={viewerId} title={japanese ? "並べて見る" : "Alongside"} />}
      japanese={japanese}
    >
      <V2ColumnHead title={V2_PROVIDER_LABELS[video.provider]} />

      <div className="v2-watch">
        <div className="v2-watch__layout">
          <div className="v2-watch__main">
            <div className="v2-watch__player">
              {video.accessGate
                ? <V2GatedLockedCard gate={video.accessGate.gate} status={video.accessGate.status} title={video.title} targetType="video" targetId={video.id} externalVideo />
                : <VideoDetailPlayer authenticated={Boolean(viewerId)} video={video} />}
            </div>

            {video.provider === "hub" && !video.accessGate ? <V2VideoDownload videoId={video.id} japanese={japanese} /> : null}

            <div className="v2-watch__head">
              <h1 className="v2-watch__title">{video.title}</h1>
              <div className="v2-watch__byline">
                <div className="v2-watch__channel">
                  <Avatar name={video.channel} size={40} />
                  <div className="v2-watch__channel-text">
                    {video.provider === "hub" && video.channelHandle
                      ? <Link className="v2-watch__channel-name" href={`/v2/videos/channel/${encodeURIComponent(video.channelHandle)}`}>{video.channel}</Link>
                      : <span className="v2-watch__channel-name">{video.channel}</span>}
                    {video.submittedByDisplayName ? <span className="v2-watch__channel-sub">{japanese ? `Hubで共有: ${video.submittedByDisplayName}` : `Shared on Hub by ${video.submittedByDisplayName}`}</span> : null}
                  </div>
                </div>
                <div className="v2-watch__actions">
                  {followState ? <V2VideoFollow key={video.id} target={followState.kind === "profile" ? { kind: "profile", profileId: followState.profileId } : { kind: "channel", channel: followState.channel, provider: followState.provider }} initialFollowing={followState.following} authenticated={Boolean(viewerId)} locale={locale} /> : null}
                  {video.accessGate ? null : <V2VideoLike videoId={video.id} authenticated={Boolean(viewerId)} locale={locale} />}
                  <V2VideoSave videoId={video.id} initialSaved={saved} authenticated={Boolean(viewerId)} locale={locale} />
                  <V2ContentShare href={`/v2/videos/${video.id}`} japanese={japanese} />
                  {video.provider === "hub" ? <VideoReportPicker videoId={video.id} authenticated={Boolean(viewerId)} japanese={japanese} /> : null}
                  {video.sourceUrl && video.provider !== "hub" ? <ButtonLink variant="secondary" external href={video.sourceUrl} label={japanese ? `${V2_PROVIDER_LABELS[video.provider]}で見る` : `Open at ${V2_PROVIDER_LABELS[video.provider]}`} /> : null}
                </div>
              </div>
            </div>

            <V2VideoDescription
              locale={locale}
              stats={[
                video.viewCount ? formatViews(video.viewCount, japanese) : "",
                video.publishedAt ? new Date(video.publishedAt).toLocaleDateString(japanese ? "ja-JP" : "en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Tokyo" }) : "",
                video.category ? `#${video.category}` : "",
              ].filter(Boolean).join(" ・ ")}
              tags={
                <V2TagChipRow tags={[video.category, ...(video.topic && video.topic !== video.category ? [video.topic] : [])].filter(Boolean)} kind="videos" label={japanese ? "タグ" : "Tags"} />
              }
            >
              {japanese ? V2_PURPOSE_LABELS[video.purpose].ja : V2_PURPOSE_LABELS[video.purpose].en}
              {video.provider === "hub"
                ? (japanese ? "の動画。Hubで投稿された動画で、Hubの中で再生します。" : ". A video posted on Hub, played on Hub.")
                : japanese ? "の動画。Hubに共有された外部の動画で、再生できないときは配信元で確かめてください。" : ". An external video shared on Hub; if it will not play, open it at the source."}
              {video.safetyLevel && video.safetyLevel !== "standard" ? <b> {video.safetyNotice || (japanese ? "閲覧には注意が要る内容です。" : "Sensitive content.")}</b> : null}
            </V2VideoDescription>
          </div>

          <aside className="v2-watch__next" aria-label={japanese ? "次に見る" : "Up next"}>
            <h2 className="v2-watch__next-title">{japanese ? "次に見る" : "Up next"}</h2>
            {related.length ? (
              <ul className="v2-watch__next-list">
                {related.map((item) => <li key={item.id}><V2VideoCard video={item} locale={locale} compact /></li>)}
              </ul>
            ) : <p className="v2-note">{japanese ? "関連する動画はまだありません。" : "No related videos yet."}</p>}
          </aside>

          {/* 投稿とコメントは「次に見る」の後（狭い幅では関連動画が先に来る。YouTube と同じ順）。 */}
          <div className="v2-watch__rest">
            <V2HubpediaCitations citations={citations} japanese={japanese} />

            <V2DetailSection title={japanese ? "ポスト" : "Posts"}>
              <V2VideoPosts videoId={video.id} initialPosts={videoPosts.posts} initialCursor={videoPosts.nextCursor} viewerId={viewerId} locale={locale} />
            </V2DetailSection>
            {comments.length ? (
              <V2DetailSection title={japanese ? "以前のコメント" : "Earlier comments"}>
                <V2VideoComments videoId={video.id} initialComments={comments} authenticated={Boolean(viewerId)} locale={locale} readOnly />
              </V2DetailSection>
            ) : null}
            <ResearchDiscovery kind="video" targetId={video.id} />
          </div>
        </div>
      </div>
    </V2Shell>
  );
}
