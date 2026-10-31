"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { CrossProviderVideoPlayer } from "@/components/cross-provider-video-player";
import { NativeVideoPlayer } from "@/components/native-video-player";
import { V2VideoLike } from "@/components/v2/v2-video-like";
import { VideoReportPicker } from "@/components/video-report-picker";
import type { PublicVideoEntry } from "@/lib/server/d1-videos";
import { V2_PROVIDER_LABELS } from "@/lib/v2-video";

/*
 * 縦のショート。1画面に1本（scroll-snap）。見えている（60%以上）1本だけを再生し、ほかは外す
 * （プレーヤーごと取り除く。裏で鳴らさない）。再生の開始は各プレーヤーが claimPlayback を出すので、
 * 音楽・ほかの動画は止まる（lib/media-playback.ts）。YouTube は CrossProviderVideoPlayer の
 * 可視判定（200×200以上・覆われていない）を通る。絵の上には何も重ねない。
 * キー: ↑ / ↓ で1本ずつ。
 */
const OWNER = "shorts-feed";
const VISIBLE = 0.6;

function isEditable(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/u.test(element.tagName)));
}

export function V2ShortsFeed({ videos, locale, authenticated }: { videos: PublicVideoEntry[]; locale: string; authenticated: boolean }) {
  const ja = locale === "ja";
  const root = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const container = root.current;
    if (!container || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= VISIBLE) {
          const index = Number((entry.target as HTMLElement).dataset.index);
          if (Number.isInteger(index)) { setActive(index); setMessage(""); }
        }
      }
    }, { root: container, threshold: [VISIBLE] });
    container.querySelectorAll("[data-index]").forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [videos]);

  const go = useCallback((delta: number) => {
    const container = root.current;
    if (!container) return;
    const next = Math.max(0, Math.min(videos.length - 1, active + delta));
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
  }, [active, videos.length]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || isEditable(event.target)) return;
      if (event.key === "ArrowDown") { event.preventDefault(); go(1); }
      else if (event.key === "ArrowUp") { event.preventDefault(); go(-1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  const onEnded = useCallback(() => setMessage(ja ? "再生が終わりました。↓ キーで次へ。" : "Finished. Press ↓ for the next one."), [ja]);
  const onBlocked = useCallback(() => setMessage(ja ? "プレーヤーの再生ボタンを押してください。" : "Press play in the player."), [ja]);
  const onError = useCallback(() => setMessage(ja ? "埋め込みで再生できません。配信元で確かめてください。" : "This embed cannot play. Open it at the source."), [ja]);
  const noop = useCallback(() => undefined, []);

  if (!videos.length) return <p className="v2-note">{ja ? "ショートはまだありません。" : "No shorts yet."}</p>;

  return (
    <div className="v2-shorts" ref={root} role="feed" aria-label={ja ? "ショート" : "Shorts"} aria-busy="false">
      {videos.map((video, index) => {
        const playing = index === active;
        const hub = video.provider === "hub";
        return (
          <article key={video.id} className="v2-shorts__item" data-index={index} aria-posinset={index + 1} aria-setsize={videos.length} aria-label={video.title}>
            <div className="v2-shorts__stage">
              {playing ? (
                hub
                  ? <NativeVideoPlayer key={video.id} videoId={video.id} title={video.title} owner={OWNER} autoplay compact />
                  : <CrossProviderVideoPlayer key={video.id} authenticated={authenticated} video={video} autoplay playbackOwner={OWNER} onStarted={noop} onEnded={onEnded} onAutoplayBlocked={onBlocked} onPlaybackError={onError} />
              ) : (
                <div className="v2-shorts__idle"><b>{V2_PROVIDER_LABELS[video.provider]}</b></div>
              )}
            </div>
            <div className="v2-shorts__info">
              <h2 className="v2-shorts__title"><Link href={`/v2/videos/${encodeURIComponent(video.id)}`}>{video.title}</Link></h2>
              <p className="v2-shorts__channel">
                {hub && video.channelHandle
                  ? <Link href={`/v2/videos/channel/${encodeURIComponent(video.channelHandle)}`}>{video.channel}</Link>
                  : <span>{video.channel}</span>}
              </p>
              <div className="v2-shorts__actions">
                {playing ? <V2VideoLike videoId={video.id} authenticated={authenticated} locale={locale} /> : null}
                {playing && hub ? <VideoReportPicker videoId={video.id} authenticated={authenticated} japanese={locale === "ja"} /> : null}
              </div>
              {playing && message ? <p className="v2-shorts__status" role="status">{message}</p> : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
