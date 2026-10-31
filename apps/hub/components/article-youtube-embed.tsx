"use client";

import React, { useEffect, useRef, useState } from "react";
import { useYouTubeEmbedPermission, YouTubeEmbedConsentPrompt } from "@/components/youtube-embed-consent";
import { claimPlayback, onPlaybackClaimed, playbackOwnerId } from "@/lib/media-playback";
import { loadYouTubeApi, youtubeEmbedSrc, type YouTubePlayer } from "@/lib/youtube-iframe-api";
import { checkYouTubeEmbedVisible } from "@/lib/youtube-embed-visibility";

/**
 * 記事本文のYouTube埋め込み。既存の同意付きnocookie埋め込みだけを使う。
 * 同意するまでYouTubeへは何も送らない。動画IDの形が崩れていれば何も出さない。
 * 鳴らすのは画面に1つ（lib/media-playback.ts）：鳴り始めたら音楽・動画を止め、ほかが鳴り始めたら止まる。
 * 鳴っている間に 200×200 未満・画面の外・覆われた状態になったら止める（lib/youtube-embed-visibility.ts）。
 */
export function ArticleYouTubeEmbed({ videoId }: { videoId: string }) {
  const permission = useYouTubeEmbedPermission(videoId);
  const sourceUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const [owner] = useState(() => playbackOwnerId("article-youtube"));
  const allowed = permission.status === "allowed";
  /* 埋め込み先の URL は画面側でだけ組み立てる（origin を添えるため）。 */
  const [src, setSrc] = useState("");
  useEffect(() => {
    setSrc(allowed && permission.embedUrl ? youtubeEmbedSrc(permission.embedUrl, false) : "");
  }, [allowed, permission.embedUrl]);

  useEffect(() => {
    const frame = frameRef.current;
    if (!src || !frame) return;
    let cancelled = false;
    let player: YouTubePlayer | null = null;
    void loadYouTubeApi().then((api) => {
      if (cancelled) return;
      player = new api.Player(frame, {
        events: {
          onStateChange: (event) => { if (event.data === api.PlayerState.PLAYING) claimPlayback(owner); },
        },
      });
      playerRef.current = player;
    }).catch(() => undefined);
    const stopOthers = onPlaybackClaimed(owner, () => playerRef.current?.pauseVideo());
    const guard = () => {
      const current = playerRef.current;
      if (!current || current.getPlayerState?.() !== 1) return;
      if (!checkYouTubeEmbedVisible(frameRef.current).visible) current.pauseVideo();
    };
    const timer = window.setInterval(guard, 500);
    window.addEventListener("scroll", guard, true);
    window.addEventListener("resize", guard);
    return () => {
      cancelled = true;
      stopOthers();
      window.clearInterval(timer);
      window.removeEventListener("scroll", guard, true);
      window.removeEventListener("resize", guard);
      playerRef.current = null;
      player?.destroy();
    };
  }, [src, owner]);

  if (allowed) {
    return (
      <div className="hub-article-embed">
        {src ? (
          <iframe
            ref={frameRef}
            src={src}
            title="YouTube動画"
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
            allow="encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          />
        ) : null}
      </div>
    );
  }
  return (
    <div className="hub-article-embed hub-article-embed--consent">
      <YouTubeEmbedConsentPrompt message={permission.message} onAccept={permission.accept} sourceUrl={sourceUrl} status={permission.status} />
    </div>
  );
}
