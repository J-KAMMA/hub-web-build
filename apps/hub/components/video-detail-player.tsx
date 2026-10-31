"use client";

import { useCallback, useEffect, useState } from "react";

import { CrossProviderVideoPlayer } from "./cross-provider-video-player";
import { NativeVideoPlayer } from "./native-video-player";
import { rememberVideo } from "@/lib/video-personalization";
import { rememberHandoffPosition } from "@/lib/media-playback";
import { playPersistentVideo, VIDEO_PLAYER_STOP_EVENT } from "@/lib/video-player-events";

type DetailPlayerVideo = {
  id: string;
  channel: string;
  provider: "youtube" | "vimeo" | "twitch" | "niconico" | "tiktok" | "dailymotion" | "peertube" | "hub";
  sourceUrl: string;
  title: string;
  viewCount: number;
};

export function VideoDetailPlayer({ authenticated = false, video }: {
  authenticated?: boolean;
  video: DetailPlayerVideo;
}) {
  const [message, setMessage] = useState("");

  useEffect(() => {
    window.dispatchEvent(new Event(VIDEO_PLAYER_STOP_EVENT));
    rememberVideo(window.localStorage, video.id);
  }, [video.id]);

  const recordStarted = useCallback(async () => {
    setMessage("");
    try {
      const response = await fetch(`/api/videos/${encodeURIComponent(video.id)}/view`, {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok) return;
    } catch {
      // Analytics must never interrupt playback.
    }
  }, [video.id]);

  // A Hub self-made video plays from the Video Worker, not from an embed. Hooks above run for every provider.
  if (video.provider === "hub") {
    /* 再生中に画面を離れたら、同じ位置から隅の小窓で鳴らし続ける（2026-10-18、所有者承認）。 */
    const handOff = (seconds: number, playing: boolean) => {
      if (!playing) return;
      rememberHandoffPosition(video.id, seconds);
      playPersistentVideo({ id: video.id, title: video.title, channel: video.channel, provider: "hub", sourceUrl: video.sourceUrl, authenticated });
    };
    return <NativeVideoPlayer videoId={video.id} title={video.title} onStarted={() => void recordStarted()} onLeave={handOff} />;
  }

  return <div className="video-detail-player">
    <CrossProviderVideoPlayer
      authenticated={authenticated}
      video={video}
      autoplay
      onStarted={() => void recordStarted()}
      onEnded={() => setMessage("再生が終了しました。")}
      onAutoplayBlocked={() => setMessage("再生ボタンを押して動画を開始してください。")}
    />
    {message ? <div className="video-detail-player__status" role="status">{message}</div> : null}
  </div>;
}
