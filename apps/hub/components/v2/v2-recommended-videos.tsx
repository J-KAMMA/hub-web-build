"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { V2VideoCard } from "@/components/v2/v2-video-card";
import { Skeleton } from "@/components/v2/ui";
import { V2DiscoveryOptions, V2DiscoveryFeedbackStatus } from "./v2-discovery-feedback";
import { useDiscoveryFeedback } from "@/lib/use-discovery-feedback";
import { useHubRecommendations } from "@/lib/use-hub-recommendations";
import { rankDiscoveryItems } from "@/lib/discovery-recommendations";
import { loadVideoDiscoveryBatch, type VideoDiscoveryPage } from "@/lib/video-discovery-index";
import { matchesVideoFilters, type V2VideoFilters } from "@/lib/v2-video";
import { readVideoHistory, rememberVideo } from "@/lib/video-personalization";
import { HUB_INTEREST_PROFILE_CHANGED_EVENT } from "@/lib/hub-interest-profile";
import { playPersistentVideo } from "@/lib/video-player-events";
import type { PublicVideoEntry, VideoDiscoveryEntry } from "@/lib/server/d1-videos";

const DISPLAY_BATCH = 30;

export function V2RecommendedVideos({ filters, authenticated, locale }: {
  filters: V2VideoFilters; authenticated: boolean; locale: string;
}) {
  const ja = locale === "ja";
  const feedback = useDiscoveryFeedback("videos");
  const { interests, enabled, record } = useHubRecommendations();
  const [history, setHistory] = useState<string[]>([]);
  const [index, setIndex] = useState<VideoDiscoveryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [request, setRequest] = useState<{ cursor: string | null; nonce: number }>({ cursor: null, nonce: 0 });
  const [indexState, setIndexState] = useState<"loading" | "ready" | "error">("loading");
  const [count, setCount] = useState(DISPLAY_BATCH);
  const [videos, setVideos] = useState<PublicVideoEntry[]>([]);
  const [detailsState, setDetailsState] = useState<"loading" | "ready" | "error">("loading");
  const [retryDetails, setRetryDetails] = useState(0);
  const failedCursor = useRef<string | null>(null);

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

  useEffect(() => {
    const controller = new AbortController();
    setIndexState("loading");
    loadVideoDiscoveryBatch(async after => {
      const params = new URLSearchParams();
      if (after) params.set("after", after);
      const response = await fetch(`/api/videos/discovery?${params}`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error("Index unavailable");
      return response.json() as Promise<VideoDiscoveryPage>;
    }, request.cursor).then(page => {
      if (controller.signal.aborted) return;
      setIndex(previous => [...new Map([...previous, ...page.videos].map(video => [video.id, video])).values()]);
      setCursor(page.nextCursor);
      setIndexState("ready");
    }).catch(() => {
      if (controller.signal.aborted) return;
      failedCursor.current = request.cursor;
      setIndexState("error");
    });
    return () => controller.abort();
  }, [request]);

  const terms = useMemo(() => {
    const historyTerms = enabled ? index.filter(video => history.includes(video.id)).flatMap(video => [video.topic, video.category]) : [];
    return [...new Set([...interests, ...historyTerms])].filter(Boolean).slice(0, 12);
  }, [index, enabled, history, interests]);
  const ranked = useMemo(() => {
    const baseline = index.filter(video => matchesVideoFilters(video, filters)).sort((a, b) =>
      b.publishedAt.localeCompare(a.publishedAt) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    return rankDiscoveryItems(baseline, terms, video => ({ text: `${video.title} ${video.category} ${video.topic} ${video.purpose}`, author: video.channel }));
  }, [index, filters, terms]);
  const eligible = ranked.filter(video => !feedback.isHidden(video.id));
  const selectedIds = eligible.slice(0, count).map(video => video.id);
  const selectionKey = JSON.stringify(selectedIds);

  useEffect(() => {
    const ids = JSON.parse(selectionKey) as string[];
    const controller = new AbortController();
    if (!ids.length) { setVideos([]); setDetailsState("ready"); return; }
    setDetailsState("loading");
    // Recheck current publication status before rendering selected cards.
    (async () => {
      const selected: PublicVideoEntry[] = [];
      for (let offset = 0; offset < ids.length; offset += DISPLAY_BATCH) {
        const params = new URLSearchParams();
        for (const id of ids.slice(offset, offset + DISPLAY_BATCH)) params.append("id", id);
        const response = await fetch(`/api/videos/discovery?${params}`, { signal: controller.signal, cache: "no-store" });
        if (!response.ok) throw new Error("Details unavailable");
        const body = await response.json() as { videos: PublicVideoEntry[] };
        if (!Array.isArray(body.videos)) throw new Error("Invalid details");
        selected.push(...body.videos);
      }
      if (controller.signal.aborted) return;
      const byId = new Map(selected.map(video => [video.id, video]));
      setVideos(ids.flatMap(id => {
        const video = byId.get(id);
        return video && matchesVideoFilters(video, filters) ? [video] : [];
      }));
      setDetailsState("ready");
    })().catch(() => {
      if (!controller.signal.aborted) { setVideos([]); setDetailsState("error"); }
    });
    return () => controller.abort();
  }, [selectionKey, retryDetails, filters]);

  const remember = (video: PublicVideoEntry) => {
    if (enabled) { try { rememberVideo(window.localStorage, video.id); } catch { /* Optional history. */ } }
    record("video", [video.category, video.topic, video.purpose], 2);
  };
  const play = (video: PublicVideoEntry) => {
    remember(video);
    playPersistentVideo({ id: video.id, title: video.title, channel: video.channel, provider: video.provider, sourceUrl: video.sourceUrl, authenticated });
  };
  const loading = indexState === "loading" || detailsState === "loading";
  const shown = videos.filter(video => !feedback.isHidden(video.id));
  return <div className="v2-vlist" aria-busy={loading}>
    <V2DiscoveryFeedbackStatus feedback={feedback} japanese={ja} />
    {indexState === "error" ? <p className="v2-error" role="status">
      {ja ? "おすすめの候補を取得できませんでした。" : "Could not load recommendation candidates."}{" "}
      <button className="v2-card__link" onClick={() => setRequest(value => ({ cursor: failedCursor.current, nonce: value.nonce + 1 }))}>{ja ? "再試行" : "Retry"}</button>{" "}
      <Link href="/v2/videos?mode=recent">{ja ? "新着を見る" : "View latest"}</Link>
    </p> : null}
    {detailsState === "error" ? <p className="v2-error" role="status">
      {ja ? "動画を取得できませんでした。" : "Could not load videos."}{" "}
      <button className="v2-card__link" onClick={() => setRetryDetails(value => value + 1)}>{ja ? "再試行" : "Retry"}</button>
    </p> : null}
    {shown.length ? <ul className="v2-vgrid">{shown.map(video => <li key={video.id}>
      <V2VideoCard video={video} locale={locale} onFloat={play} onOpen={remember} priority={shown.indexOf(video) < 3} />
      <V2DiscoveryOptions text={`${video.title} ${video.category} ${video.topic} ${video.purpose}`} interests={terms} japanese={ja} dismiss={() => feedback.dismiss(video.id)} fallbackReason={ja ? "公開動画のカテゴリ・話題・目的から紹介しています。" : "Selected from public videos using category, topic and purpose signals."} />
    </li>)}</ul>
      : loading ? <Skeleton kind="video" count={6} className="v2-vgrid" label={ja ? "読み込んでいます" : "Loading"} />
        : indexState !== "error" && detailsState !== "error" ? <p className="v2-note">{ranked.length > 0 && !eligible.length ? (ja ? "おすすめを非表示にしています。設定で非表示をリセットできます。" : "Recommendations are hidden. Reset them in settings.") : (ja ? "条件に合う動画がありません。" : "No videos matched.")}</p> : null}
    {eligible.length > count ? <button className="v2-toggle v2-toggle--text" disabled={loading} onClick={() => setCount(value => value + DISPLAY_BATCH)}>{ja ? "もっと見る" : "Show more"}</button> : null}
    {cursor && indexState !== "error" ? <button className="v2-toggle v2-toggle--text" disabled={loading} onClick={() => setRequest(value => ({ cursor, nonce: value.nonce + 1 }))}>{ja ? "候補をさらに探す" : "Find more candidates"}</button> : null}
  </div>;
}
