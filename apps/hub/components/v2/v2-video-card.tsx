import Link from "next/link";

import { V2Icon } from "@/components/v2/v2-icons";
import { Avatar, MediaBadge, MediaFrame } from "@/components/v2/ui";
import { agoLabel, formatViews } from "@/components/v2/v2-video-format";

import type { PublicVideoEntry } from "@/lib/server/d1-videos";
import { V2_PROVIDER_LABELS, isShort } from "@/lib/v2-video";
import { classifyVideoBroadcastStatus, videoBroadcastLabel } from "@/lib/video-broadcast-status";

/*
 * 動画1枚（SPEC 4.4 / 4.5）。一覧でも関連でも同じものを使う。
 *
 *   絵      MediaFrame。枠が縦横比を持ち、絵は枠いっぱいに object-fit: cover。
 *           4:3 の原画でも黒帯は出ない。再生時間は右下、ライブは左下（--media-badge-*）。
 *   下      発信者の顔 36・題 2行・発信者名・「n回視聴・3年前」。
 *   押す    札ぜんぶが詳細へのリンク（題の ::after で札いっぱいに広げる）。
 *   見る    onFloat があれば、絵の右上に「ここで見る」の押し手が出る（hover、
 *           タッチでは常に）。絵の上の右下は再生時間の札なので、押し手は上に置く。
 *   compact 「次に見る」の行。絵 168×94 の隣に題・発信者・回数。
 *
 * 縦型（ショート）は 9:16 の枠で出す。横型の枠に縦の絵を入れると両脇が空く。
 * 第三者への通信: 絵は既存どおり一覧が読む。ここで動く下見は作らない（同意の前に
 * 配信元へ何も取りに行かない、AGENTS）。
 */
export function V2VideoCard({ video, locale, compact = false, onFloat, onOpen, priority = false }: {
  video: PublicVideoEntry;
  locale: string;
  compact?: boolean;
  /* 渡すと、絵の「ここで見る」の押し手で浮かせる盤が開く（2026-09-03）。 */
  onFloat?: (video: PublicVideoEntry) => void;
  onOpen?: (video: PublicVideoEntry) => void;
  priority?: boolean;
}) {
  const ja = locale === "ja";
  const short = isShort(video);
  const broadcast = videoBroadcastLabel(classifyVideoBroadcastStatus(video));
  const href = `/v2/videos/${encodeURIComponent(video.id)}`;
  const className = ["v2-vcard", compact ? "v2-vcard--compact" : "", short ? "v2-vcard--tall" : ""].filter(Boolean).join(" ");

  if (video.accessGate) {
    return (
      <Link className={className} href={href} onClick={onOpen ? () => onOpen(video) : undefined}>
        <span className="v2-vcard__body">
          <strong className="v2-vcard__title">{video.title}</strong>
          <span className="v2-vcard__channel">{ja ? "閲覧条件あり" : "Viewing conditions apply"}</span>
        </span>
      </Link>
    );
  }

  const stats = [video.viewCount > 0 ? formatViews(video.viewCount, ja) : "", agoLabel(video.publishedAt, ja)].filter(Boolean);
  const dims = short ? { width: 180, height: 320 } : { width: 320, height: 180 };
  const art = (
    <MediaFrame
      className="v2-vcard__art"
      src={video.thumbnailUrl}
      ratio={short ? "9/16" : "16/9"}
      radius={compact ? "sm" : "md"}
      priority={priority}
      sizes={compact ? "168px" : "(min-width: 1280px) 296px, (min-width: 600px) 50vw, 100vw"}
      {...dims}
    >
      {video.thumbnailUrl ? null : <b className="v2-vcard__fallback">{V2_PROVIDER_LABELS[video.provider]}</b>}
      {video.duration ? <MediaBadge><time>{video.duration}</time></MediaBadge> : null}
      {broadcast ? <MediaBadge tone="live">{broadcast}</MediaBadge> : null}
    </MediaFrame>
  );

  return (
    <article className={className}>
      <div className="v2-vcard__thumb">
        {art}
        {onFloat && video.provider !== "hub" ? (
          <button
            type="button"
            className="v2-vcard__here"
            aria-label={ja ? `${video.title} をここで見る` : `Watch ${video.title} here`}
            onClick={() => onFloat(video)}
          >
            <V2Icon name="play" />
          </button>
        ) : null}
      </div>
      <div className="v2-vcard__info">
        {compact ? null : <Avatar name={video.channel} size={40} className="v2-vcard__avatar" />}
        <div className="v2-vcard__body">
          <h3 className="v2-vcard__heading">
            <Link className="v2-vcard__link" href={href} onClick={onOpen ? () => onOpen(video) : undefined}>{video.title}</Link>
          </h3>
          <span className="v2-vcard__channel">{video.channel}</span>
          {stats.length ? <span className="v2-vcard__meta" suppressHydrationWarning>{stats.join(" ・ ")}</span> : null}
        </div>
      </div>
    </article>
  );
}
