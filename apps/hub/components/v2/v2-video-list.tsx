"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import { V2VideoCard } from "@/components/v2/v2-video-card";
import { playPersistentVideo } from "@/lib/video-player-events";
import { Skeleton } from "@/components/v2/ui";
import type { PublicVideoEntry } from "@/lib/server/d1-videos";
import { matchesVideoFilters, type V2VideoFilters } from "@/lib/v2-video";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { rankDiscoveryItems } from "@/lib/discovery-recommendations";
import { readVideoHistory, rememberVideo, personalizeVideos } from "@/lib/video-personalization";
import { HUB_INTEREST_PROFILE_CHANGED_EVENT } from "@/lib/hub-interest-profile";

/*
 * 動画の一覧。既存の video-discovery.tsx（2,000行）から一覧の機能だけを抜いた。
 *
 * 落とさなかったもの: 新着／人気／急上昇／ショート／保存の5つ、配信元・分類・
 * 長さ・日付・言語・語の絞り込み（式は既存と同じ、lib/v2-video.ts）、
 * 30件ずつのもっと見る（上限100件、既存と同じ）。
 * 人気と急上昇は既存と同じ /api/videos/rankings を押されたときだけ取る。
 * 頁の描画で集計を呼ばない（D1は読んだ行数で課金する）。
 *
 * まだ無いもの: 関心プロファイルによる並べ替え、URL貼付からの登録、
 * チャンネルのフォロー、取り込みジョブ（サーバー側は410で終了済み）。
 */

export type V2VideoMode = "recommended" | "recent" | "popular" | "rising" | "shorts" | "saved";

const BATCH = 30;
const CAP = 100;

export function V2VideoList({
  initialVideos,
  initialTotal,
  filters,
  mode,
  authenticated,
  locale,
}: {
  initialVideos: PublicVideoEntry[];
  initialTotal: number;
  filters: V2VideoFilters;
  mode: V2VideoMode;
  authenticated: boolean;
  locale: string;
}) {
  const ja = locale === "ja";
  const { interests, enabled, record } = useHubRecommendations();
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    const refresh = () => {
      try { setHistory(enabled ? readVideoHistory(window.localStorage) : []); } catch { setHistory([]); }
    };
    refresh();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [enabled]);
  const [catalog, setCatalog] = useState(initialVideos);
  const [total, setTotal] = useState(initialTotal);
  const [ranked, setRanked] = useState<PublicVideoEntry[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");
  const [retry, setRetry] = useState(0);
  const sentinel = useRef<HTMLDivElement | null>(null);
  const remote = mode === "popular" || mode === "rising" || mode === "saved";

  /* 人気・急上昇・保存は別の入口から取る。新着とショートは頁の分から続ける。 */
  useEffect(() => {
    if (!remote || (mode === "saved" && !authenticated)) { setRanked(null); setStatus("idle"); return; }
    let cancelled = false;
    setStatus("loading");
    const url = mode === "saved" ? "/api/videos/library" : "/api/videos/rankings";
    fetch(url, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { popular?: PublicVideoEntry[]; rising?: PublicVideoEntry[]; savedVideos?: PublicVideoEntry[] };
        if (cancelled) return;
        const videos = mode === "saved" ? payload?.savedVideos : payload?.[mode];
        if (!Array.isArray(videos)) throw new Error("Invalid video list");
        setRanked(videos);
        setStatus("idle");
      })
      .catch(() => { if (!cancelled) { setRanked([]); setStatus("failed"); } });
    return () => { cancelled = true; };
  }, [mode, remote, authenticated, retry]);

  /* 絵を押したら、浮かせる盤で見る。画面を移っても続く（components/v2/v2-video-player.tsx）。 */
  const remember = (video: PublicVideoEntry) => {
    if (enabled) {
      try { rememberVideo(window.localStorage, video.id); } catch { /* Optional history. */ }
    }
    record("video", [video.category, video.topic, video.purpose], 2);
  };
  const float = (video: PublicVideoEntry) => {
    remember(video);
    playPersistentVideo({
    id: video.id,
    title: video.title,
    channel: video.channel,
    provider: video.provider,
    sourceUrl: video.sourceUrl,
    authenticated,
    });
  };

  const source = remote ? ranked ?? [] : catalog;
  const visible = useMemo(() => {
    const matched = source.filter((video) => matchesVideoFilters(video, filters));
    if (mode !== "recommended" || !enabled) return matched;
    const personalized = personalizeVideos(matched, catalog.filter((video) => history.includes(video.id)));
    return rankDiscoveryItems(personalized, interests, (video) => ({ text: `${video.title} ${video.category} ${video.topic} ${video.purpose}`, author: video.channel }));
  }, [source, filters, mode, enabled, catalog, history, interests]);
  const canLoadMore = !remote && catalog.length < Math.min(total, CAP) && status !== "loading";

  /* 下端が見えたら次の30件。既存と同じ IntersectionObserver。 */
  useEffect(() => {
    if (!canLoadMore || !sentinel.current) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      setStatus("loading");
      fetch(`/api/videos?limit=${BATCH}&offset=${catalog.length}`)
        .then(async (response) => {
          if (!response.ok) throw new Error(String(response.status));
          const payload = await response.json() as { videos: PublicVideoEntry[]; total: number };
          setCatalog((previous) => {
            const known = new Set(previous.map((video) => video.id));
            return [...previous, ...payload.videos.filter((video) => !known.has(video.id))].slice(0, CAP);
          });
          setTotal(payload.total);
          setStatus("idle");
        })
        .catch(() => setStatus("failed"));
    }, { rootMargin: "320px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [canLoadMore, catalog.length]);

  if (mode === "saved" && !authenticated) {
    return (
      <p className="v2-note v2-reply-auth">
        <Link href="/v2/auth">{ja ? "ログイン" : "Sign in"}</Link>{ja ? "すると保存した動画が出ます。" : " to see saved videos."}
      </p>
    );
  }

  return (
    <div className="v2-vlist">
      {visible.length ? (
        <ul className="v2-vgrid">
          {visible.map((video, index) => <li key={video.id}><V2VideoCard video={video} locale={locale} onFloat={float} onOpen={remember} priority={index < 3} /></li>)}
        </ul>
      ) : status === "loading" ? (
        <Skeleton kind="video" count={6} className="v2-vgrid" label={ja ? "読み込んでいます" : "Loading"} />
      ) : (
        <p className="v2-note">
          {status === "failed"
            ? (ja ? "読み込めませんでした。" : "Could not load.")
            : mode === "saved"
              ? (ja ? "保存した動画はまだありません。" : "Nothing saved yet.")
              : (ja ? "条件に合う動画がありません。" : "No videos matched.")}
        </p>
      )}
      {canLoadMore ? <div ref={sentinel} className="v2-vlist__more" aria-hidden="true" /> : null}
      {remote && status === "failed" ? <button className="v2-button v2-button--text" type="button" onClick={() => setRetry(value => value + 1)}>{ja ? "もう一度読み込む" : "Try again"}</button> : null}
      {!remote ? (
        <p className="v2-note v2-vlist__count">
          {ja ? `${visible.length}本を表示（読み込み ${catalog.length} / ${total}）` : `${visible.length} shown (${catalog.length} / ${total} loaded)`}
          {catalog.length >= CAP && total > CAP ? (ja ? "。絞り込みで探してください" : ". Narrow down to find more") : ""}
        </p>
      ) : null}
    </div>
  );
}
