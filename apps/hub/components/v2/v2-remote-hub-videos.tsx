import { MediaBadge, MediaFrame } from "@/components/v2/ui";
import { agoLabel } from "@/components/v2/v2-video-format";
import type { RemoteHubVideoEntry } from "@/lib/server/remote-hub-videos";
import "@/app/v2/v2-media-column.css";

/*
 * 他のハブの動画の棚。題・ハブ名・長さ・絵だけを出し、押すと相手のハブの再生ページへ出る
 * （別タブ。Hubの外へ出ると分かる表示つき）。相手の動画は埋め込まない・中継しない・取りに行かない。
 * 絵は取り込み時に相手と同じホストと確認済みだが、ここでも再確認する。
 */
function sameHost(a: string, b: string): boolean {
  try { return new URL(a).host === new URL(b).host; } catch { return false; }
}

function clock(ms: number | null): string {
  if (ms === null || ms <= 0) return "";
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function V2RemoteHubVideos({ videos, locale }: { videos: RemoteHubVideoEntry[]; locale: string }) {
  const shown = videos.filter((video) => !video.sensitive);
  if (!shown.length) return null;
  const ja = locale === "ja";
  return (
    <section className="v2-short-shelf v2-remote-videos" aria-labelledby="v2-remote-videos-title">
      <h2 id="v2-remote-videos-title" className="v2-short-shelf__title">{ja ? "他のハブ" : "Other Hubs"}</h2>
      <ul className="v2-short-shelf__track v2-remote-videos__track">
        {shown.map((video) => {
          const host = (() => { try { return new URL(video.watchUrl).host; } catch { return ""; } })();
          const thumb = video.thumbnailUrl && sameHost(video.thumbnailUrl, video.watchUrl) ? video.thumbnailUrl : null;
          const duration = clock(video.durationMs);
          const when = agoLabel(video.publishedAt, ja);
          return (
            <li key={video.objectId}>
              <article className="v2-vcard">
                <div className="v2-vcard__thumb">
                  <MediaFrame className="v2-vcard__art" src={thumb} ratio="16/9" radius="md" referrerPolicy="no-referrer" width={320} height={180} sizes="296px">
                    {duration ? <MediaBadge><time>{duration}</time></MediaBadge> : null}
                  </MediaFrame>
                </div>
                <span className="v2-vcard__body">
                  <a
                    className="v2-vcard__title v2-remote-videos__link"
                    href={video.watchUrl}
                    target="_blank"
                    rel="noopener noreferrer nofollow ugc"
                  >
                    {video.title}
                    <span className="v2-remote-videos__leave">{ja ? "（Hubの外へ出ます）" : " (leaves Hub)"}</span>
                  </a>
                  <span className="v2-vcard__channel">{host}</span>
                  {when ? <span className="v2-vcard__meta">{when}</span> : null}
                </span>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
