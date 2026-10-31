"use client";

import Link from "next/link";
import { useRef, useState } from "react";

import { V2VideoCard } from "@/components/v2/v2-video-card";
import type { AuthorHubVideoCard, PublicVideoEntry } from "@/lib/server/d1-videos";

/*
 * チャンネルの動画の格子と「もっと見る」。続きは GET /api/videos/channels/{handle}?cursor=
 * （キーセット。数や総数は読まない）。カードは既存の V2VideoCard をそのまま使う。
 */
function toEntry(card: AuthorHubVideoCard, channel: string): PublicVideoEntry {
  return {
    id: card.id,
    title: card.title,
    channel,
    category: "Hub動画",
    purpose: "creation",
    topic: "",
    provider: "hub",
    sourceUrl: card.href,
    thumbnailUrl: card.thumbnailUrl,
    duration: card.duration ?? undefined,
    publishedAt: card.publishedAt,
    createdAt: card.publishedAt,
    viewCount: 0,
  };
}

export function V2ChannelVideos({ handle, channelName, initialVideos, initialCursor, locale }: {
  handle: string;
  channelName: string;
  initialVideos: AuthorHubVideoCard[];
  initialCursor: string | null;
  locale: string;
}) {
  const ja = locale === "ja";
  const [videos, setVideos] = useState(initialVideos);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const busy = useRef(false);

  const more = async () => {
    if (!cursor || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(`/api/videos/channels/${encodeURIComponent(handle)}?cursor=${encodeURIComponent(cursor)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { videos?: AuthorHubVideoCard[]; nextCursor?: string | null } | null;
      if (!response.ok || !payload?.videos) throw new Error("failed");
      const next = payload.videos;
      setVideos((current) => {
        const seen = new Set(current.map((video) => video.id));
        return [...current, ...next.filter((video) => !seen.has(video.id))];
      });
      setCursor(payload.nextCursor ?? null);
    } catch {
      setError(true);
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  if (!videos.length) return <p className="v2-note">{ja ? "公開されている動画はまだありません。" : "No public videos yet."}</p>;
  return (
    <>
      <ul className="v2-vgrid v2-channel__grid">
        {videos.map((video) => (
          <li key={video.id}>
            {video.locked
              ? <Link className="v2-vcard" href={video.href}><span className="v2-vcard__body"><strong className="v2-vcard__title">{video.title}</strong><span className="v2-vcard__channel">{ja ? "閲覧条件あり" : "Viewing conditions apply"}</span></span></Link>
              : <V2VideoCard video={toEntry(video, channelName)} locale={locale} />}
          </li>
        ))}
      </ul>
      {cursor ? (
        <div className="v2-channel__more">
          <button type="button" className="v2-toggle v2-toggle--text" disabled={loading} onClick={() => void more()}>{loading ? (ja ? "読み込み中…" : "Loading…") : (ja ? "もっと見る" : "Show more")}</button>
          {error ? <span className="v2-error" role="status">{ja ? "読み込めませんでした。" : "Could not load more."}</span> : null}
        </div>
      ) : null}
    </>
  );
}
