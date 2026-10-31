"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  useYouTubeEmbedPermission,
  YouTubeEmbedConsentPrompt,
} from "@/components/youtube-embed-consent";
import { ThirdPartyEmbedPlaceholder } from "@/components/third-party-embed-placeholder";
import { externalVideoProviderLabel } from "@/lib/video-source";
import { isVerticalVideo } from "@/lib/video-display-format";
import { claimPlayback, onPlaybackClaimed, playbackOwnerId } from "@/lib/media-playback";
import { checkYouTubeEmbedVisible } from "@/lib/youtube-embed-visibility";

type PlayerVideo = {
  channel: string;
  provider: "youtube" | "vimeo" | "twitch" | "niconico" | "tiktok" | "dailymotion" | "peertube" | "hub";
  sourceUrl: string;
  title: string;
};

type YouTubePlayer = {
  destroy: () => void;
  loadVideoById: (videoId: string) => void;
  pauseVideo: () => void;
  getPlayerState?: () => number;
  playVideo: () => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  getVolume: () => number;
  isMuted: () => boolean;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  setVolume: (volume: number) => void;
  mute: () => void;
  unMute: () => void;
};
type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: {
      events: Record<
        string,
        (event: { data?: number; target: YouTubePlayer }) => void
      >;
    },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number; PLAYING: number };
};
type VimeoPlayer = {
  destroy: () => Promise<void>;
  on: (event: "play" | "ended" | "error", listener: () => void) => void;
  play: () => Promise<void>;
  pause: () => Promise<void>;
  getCurrentTime: () => Promise<number>;
  getDuration: () => Promise<number>;
  getVolume: () => Promise<number>;
  getMuted: () => Promise<boolean>;
  setCurrentTime: (seconds: number) => Promise<number>;
  setVolume: (volume: number) => Promise<number>;
  setMuted: (muted: boolean) => Promise<boolean>;
};
type VimeoApi = { Player: new (element: HTMLIFrameElement) => VimeoPlayer };

let youtubeApiPromise: Promise<YouTubeApi> | null = null;
let vimeoApiPromise: Promise<VimeoApi> | null = null;

function appendScript(id: string, src: string) {
  const existing = document.getElementById(id) as HTMLScriptElement | null;
  if (existing) return existing;
  const script = document.createElement("script");
  script.id = id;
  script.src = src;
  script.async = true;
  document.body.append(script);
  return script;
}

function loadYouTubeApi() {
  const playerWindow = window as typeof window & {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  };
  if (playerWindow.YT?.Player) return Promise.resolve(playerWindow.YT);
  if (!youtubeApiPromise)
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previous = playerWindow.onYouTubeIframeAPIReady;
      playerWindow.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (playerWindow.YT) resolve(playerWindow.YT);
      };
      appendScript(
        "hub-youtube-iframe-api",
        "https://www.youtube.com/iframe_api",
      ).addEventListener(
        "error",
        () => reject(new Error("YouTube player API failed to load")),
        { once: true },
      );
    });
  return youtubeApiPromise;
}

function loadVimeoApi() {
  const playerWindow = window as typeof window & { Vimeo?: VimeoApi };
  if (playerWindow.Vimeo?.Player) return Promise.resolve(playerWindow.Vimeo);
  if (!vimeoApiPromise)
    vimeoApiPromise = new Promise((resolve, reject) => {
      const script = appendScript(
        "hub-vimeo-player-api",
        "https://player.vimeo.com/api/player.js",
      );
      script.addEventListener(
        "load",
        () => {
          if (playerWindow.Vimeo) resolve(playerWindow.Vimeo);
          else reject(new Error("Vimeo player API is unavailable"));
        },
        { once: true },
      );
      script.addEventListener(
        "error",
        () => reject(new Error("Vimeo player API failed to load")),
        { once: true },
      );
    });
  return vimeoApiPromise;
}

export function sourceId(video: PlayerVideo) {
  const url = new URL(video.sourceUrl);
  if (video.provider === "youtube") {
    const path = url.pathname.split("/").filter(Boolean);
    if (url.hostname === "youtu.be") return path[0] ?? "";
    if (path[0] === "shorts" || path[0] === "embed") return path[1] ?? "";
    return url.searchParams.get("v") ?? "";
  }
  if (video.provider === "vimeo")
    return url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (video.provider === "twitch")
    return url.pathname.split("/").filter(Boolean)[1] ?? "";
  if (video.provider === "tiktok")
    return url.pathname.split("/").filter(Boolean)[2] ?? "";
  if (video.provider === "dailymotion") {
    const path = url.pathname.split("/").filter(Boolean);
    return url.hostname === "dai.ly" ? path[0] ?? "" : path[1] ?? "";
  }
  if (video.provider === "peertube") {
    const path = url.pathname.split("/").filter(Boolean);
    return path[0] === "w" ? path[1] ?? "" : path[2] ?? "";
  }
  return url.pathname.split("/").filter(Boolean)[1] ?? "";
}

function embedUrl(
  video: PlayerVideo,
  autoplay: boolean,
  authorizedYouTubeUrl?: string,
) {
  const id = sourceId(video);
  if (video.provider === "youtube") {
    const url = new URL(
      authorizedYouTubeUrl ??
        `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`,
    );
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("playsinline", "1");
    url.searchParams.set("autoplay", autoplay ? "1" : "0");
    url.searchParams.set("origin", window.location.origin);
    return url.toString();
  }
  if (video.provider === "vimeo")
    return `https://player.vimeo.com/video/${encodeURIComponent(id)}?dnt=1&autoplay=${autoplay ? "1" : "0"}`;
  if (video.provider === "twitch")
    return `https://player.twitch.tv/?video=${encodeURIComponent(id)}&parent=${encodeURIComponent(window.location.hostname)}&autoplay=${autoplay ? "true" : "false"}`;
  if (video.provider === "tiktok")
    return `https://www.tiktok.com/player/v1/${encodeURIComponent(id)}?autoplay=${autoplay ? "1" : "0"}&controls=1&description=1&loop=0&muted=0&volume_control=1`;
  if (video.provider === "dailymotion")
    return `https://geo.dailymotion.com/player.html?video=${encodeURIComponent(id)}&autoplay=${autoplay ? "1" : "0"}&mute=0`;
  if (video.provider === "peertube") {
    const source = new URL(video.sourceUrl);
    return `${source.origin}/videos/embed/${encodeURIComponent(id)}?api=1&autoplay=${autoplay ? "1" : "0"}&controls=1&p2p=0`;
  }
  return `https://embed.nicovideo.jp/watch/${encodeURIComponent(id)}?autoplay=${autoplay ? "1" : "0"}`;
}

/* 埋め込みの提供元の名前。PeerTube は誰でも立てられるので、実際に繋がる先のホスト名も添える。 */
export function thirdPartyProviderLabel(video: PlayerVideo) {
  const label = externalVideoProviderLabel(video.provider);
  if (video.provider !== "peertube") return label;
  try { return `${label}（${new URL(video.sourceUrl).host}）`; } catch { return label; }
}

export function CrossProviderVideoPlayer({
  authenticated = false,
  autoplay,
  requireMostlyVisible = true,
  onAutoplayBlocked,
  onEnded,
  onPlaybackError,
  onPlaybackState,
  onStarted,
  initialPlaybackState,
  seekToSeconds,
  playbackOwner,
  video,
}: {
  authenticated?: boolean;
  autoplay: boolean;
  requireMostlyVisible?: boolean;
  onAutoplayBlocked: () => void;
  onEnded: () => void;
  onPlaybackError?: () => void;
  onPlaybackState?: (state: { positionSeconds: number; durationSeconds: number; volume: number; muted: boolean; completed: boolean }) => void;
  onStarted: () => void;
  initialPlaybackState?: { positionSeconds: number; volume: number; muted: boolean };
  seekToSeconds?: number;
  /* 鳴らす場所の名前（lib/media-playback.ts）。無ければこの部品ごとに別の名前を作る。 */
  playbackOwner?: string;
  video: PlayerVideo;
}) {
  const dataSavingEnabled = typeof navigator !== "undefined" && Boolean(
    (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection?.saveData
      || (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection?.effectiveType === "2g",
  );
  const videoId = sourceId(video);
  const vertical = isVerticalVideo(video);
  const youtubePermission = useYouTubeEmbedPermission(
    videoId,
    video.provider === "youtube",
    false,
  );
  const wrapperRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const youtubePlayerRef = useRef<YouTubePlayer | null>(null);
  const youtubeLoadedIdRef = useRef("");
  const initialYouTubeEmbedUrlRef = useRef<string | null>(null);
  const startedRef = useRef(false);
  const [ownId] = useState(() => playbackOwnerId("embed"));
  const owner = playbackOwner ?? ownId;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const [mostlyVisible, setMostlyVisible] = useState(false);
  const [frameState, setFrameState] = useState<"loading" | "ready" | "error">("loading");
  const [retryKey, setRetryKey] = useState(0);
  /* YouTube 以外は、押されるまで提供元へ何も送らない。押した動画の sourceUrl を覚える。 */
  const [thirdPartyLoadedFor, setThirdPartyLoadedFor] = useState("");
  const thirdPartyReady = video.provider === "youtube" || thirdPartyLoadedFor === video.sourceUrl;
  const [pageVisible, setPageVisible] = useState(true);
  const effectiveAutoplay =
    autoplay && pageVisible && !dataSavingEnabled && (!requireMostlyVisible || mostlyVisible);
  const notifyStarted = useCallback(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    onStarted();
  }, [onStarted]);
  const notifyPlaybackError = useCallback(() => {
    setFrameState("error");
    onPlaybackError?.();
  }, [onPlaybackError]);
  const callbacksRef = useRef({ notifyStarted, onAutoplayBlocked, onEnded, onPlaybackError: notifyPlaybackError, onPlaybackState });
  callbacksRef.current = { notifyStarted, onAutoplayBlocked, onEnded, onPlaybackError: notifyPlaybackError, onPlaybackState };

  useEffect(() => setFrameState("loading"), [video.sourceUrl]);

  useEffect(() => {
    if (frameState !== "loading" || !thirdPartyReady) return;
    const timeout = window.setTimeout(() => notifyPlaybackError(), 15_000);
    return () => window.clearTimeout(timeout);
  }, [frameState, notifyPlaybackError, retryKey, thirdPartyReady]);

  useEffect(() => {
    const sync = () => setPageVisible(document.visibilityState === "visible");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  useEffect(() => {
    if (pageVisible) return;
    youtubePlayerRef.current?.pauseVideo();
    const frame = frameRef.current;
    if (video.provider === "vimeo") {
      frame?.contentWindow?.postMessage({ method: "pause" }, "https://player.vimeo.com");
    } else if (video.provider === "tiktok") {
      frame?.contentWindow?.postMessage(
        { type: "pause", "x-tiktok-player": true },
        "https://www.tiktok.com",
      );
    }
  }, [pageVisible, video.provider]);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (
      !autoplay ||
      !requireMostlyVisible ||
      !wrapper ||
      typeof IntersectionObserver === "undefined"
    )
      return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        setMostlyVisible(
          Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.5),
        );
      },
      { threshold: [0.5] },
    );
    observer.observe(wrapper);
    return () => observer.disconnect();
  }, [autoplay, requireMostlyVisible]);

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    const frame = frameRef.current;
    if (!frame || !thirdPartyReady) return;
    startedRef.current = false;

    if (video.provider === "tiktok") {
      const receivePlayerMessage = (event: MessageEvent) => {
        if (
          event.origin !== "https://www.tiktok.com" ||
          event.source !== frame.contentWindow
        )
          return;
        const message = event.data as {
          "x-tiktok-player"?: boolean;
          type?: string;
          value?: unknown;
        } | null;
        if (!message?.["x-tiktok-player"]) return;
        if (message.type === "onStateChange" && message.value === 0) onEnded();
        if (message.type === "onStateChange" && message.value === 1) {
          claimPlayback(ownerRef.current);
          notifyStarted();
        }
        if (message.type === "onPlayerError") notifyPlaybackError();
        if (message.type === "onPlayerReady" && effectiveAutoplay) {
          frame.contentWindow?.postMessage(
            { type: "unMute", "x-tiktok-player": true },
            "https://www.tiktok.com",
          );
          frame.contentWindow?.postMessage(
            { type: "play", "x-tiktok-player": true },
            "https://www.tiktok.com",
          );
        }
      };
      window.addEventListener("message", receivePlayerMessage);
      cleanup = () =>
        window.removeEventListener("message", receivePlayerMessage);
    } else if (video.provider === "youtube") {
      void loadYouTubeApi()
        .then((api) => {
          if (cancelled) return;
          const player = new api.Player(frame, {
            events: {
              onAutoplayBlocked: () => callbacksRef.current.onAutoplayBlocked(),
              onError: () => callbacksRef.current.onPlaybackError(),
              onReady: (event) => {
                if (initialPlaybackState?.positionSeconds) event.target.seekTo(initialPlaybackState.positionSeconds, true);
                if (typeof initialPlaybackState?.volume === "number") event.target.setVolume(initialPlaybackState.volume);
                if (initialPlaybackState?.muted) event.target.mute?.(); else event.target.unMute?.();
                if (effectiveAutoplay) event.target.playVideo();
              },
              onStateChange: (event) => {
                if (event.data === api.PlayerState.PLAYING) {
                  /* 鳴り始めたら名乗る。ほかの音楽・動画はこれで止まる。 */
                  claimPlayback(ownerRef.current);
                  callbacksRef.current.notifyStarted();
                }
                if (event.data === api.PlayerState.ENDED)
                  callbacksRef.current.onEnded();
              },
            },
          });
          youtubePlayerRef.current = player;
          youtubeLoadedIdRef.current = videoId;
          const progressTimer = window.setInterval(() => {
            callbacksRef.current.onPlaybackState?.({
              positionSeconds: Math.max(0, Math.trunc(player.getCurrentTime?.() ?? 0)),
              durationSeconds: Math.max(0, Math.trunc(player.getDuration?.() ?? 0)),
              volume: Math.max(0, Math.min(100, Math.trunc(player.getVolume?.() ?? 100))),
              muted: Boolean(player.isMuted?.()), completed: false,
            });
          }, 5000);
          cleanup = () => {
            window.clearInterval(progressTimer);
            youtubePlayerRef.current = null;
            youtubeLoadedIdRef.current = "";
            player.destroy();
          };
        })
        .catch(onAutoplayBlocked);
    } else if (video.provider === "vimeo") {
      void loadVimeoApi()
        .then((api) => {
          if (cancelled) return;
          const player = new api.Player(frame);
          player.on("play", () => { claimPlayback(ownerRef.current); notifyStarted(); });
          player.on("ended", onEnded);
          player.on("error", notifyPlaybackError);
          if (initialPlaybackState?.positionSeconds) void player.setCurrentTime(initialPlaybackState.positionSeconds).catch(() => undefined);
          if (typeof initialPlaybackState?.volume === "number") void player.setVolume(initialPlaybackState.volume / 100).catch(() => undefined);
          void player.setMuted(Boolean(initialPlaybackState?.muted)).catch(() => undefined);
          if (effectiveAutoplay) void player.play().catch(onAutoplayBlocked);
          const progressTimer = window.setInterval(() => {
            void Promise.all([player.getCurrentTime(), player.getDuration(), player.getVolume(), player.getMuted()])
              .then(([position, duration, volume, muted]) => callbacksRef.current.onPlaybackState?.({ positionSeconds: Math.trunc(position), durationSeconds: Math.trunc(duration), volume: Math.trunc(volume * 100), muted, completed: false }))
              .catch(() => undefined);
          }, 5000);
          cleanup = () => {
            window.clearInterval(progressTimer);
            void player.destroy();
          };
        })
        .catch(onAutoplayBlocked);
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [
    effectiveAutoplay,
    notifyStarted,
    onAutoplayBlocked,
    onEnded,
    onPlaybackError,
    initialPlaybackState,
    video.provider,
    youtubePermission.status,
    retryKey,
    thirdPartyReady,
  ]);

  /* ほかが鳴り始めたら一時停止する（鳴らすのは画面に1つ、2026-10-18）。 */
  useEffect(() => onPlaybackClaimed(owner, () => {
    youtubePlayerRef.current?.pauseVideo();
    const frame = frameRef.current;
    if (video.provider === "vimeo") frame?.contentWindow?.postMessage({ method: "pause" }, "https://player.vimeo.com");
    else if (video.provider === "tiktok") frame?.contentWindow?.postMessage({ type: "pause", "x-tiktok-player": true }, "https://www.tiktok.com");
  }), [owner, video.provider]);

  /*
   * YouTube は鳴っている間ずっと 200×200 以上で見えていなければならない
   * （lib/youtube-embed-visibility.ts）。隠れた・縮んだ・覆われた・画面の外へ出たら止める。
   */
  useEffect(() => {
    if (video.provider !== "youtube") return;
    const guard = () => {
      const player = youtubePlayerRef.current;
      if (!player || player.getPlayerState?.() !== 1) return;
      if (!checkYouTubeEmbedVisible(frameRef.current).visible) player.pauseVideo();
    };
    const timer = window.setInterval(guard, 500);
    window.addEventListener("resize", guard);
    window.addEventListener("scroll", guard, true);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", guard);
      window.removeEventListener("scroll", guard, true);
    };
  }, [video.provider]);

  useEffect(() => {
    if (video.provider !== "youtube") return;
    startedRef.current = false;
    const player = youtubePlayerRef.current;
    if (!player || !videoId || youtubeLoadedIdRef.current === videoId) return;
    youtubeLoadedIdRef.current = videoId;
    player.loadVideoById(videoId);
  }, [video.provider, videoId]);

  useEffect(() => {
    if (typeof seekToSeconds !== "number") return;
    youtubePlayerRef.current?.seekTo(Math.max(0, seekToSeconds), true);
  }, [seekToSeconds]);

  if (video.provider === "youtube" && youtubePermission.status !== "allowed") {
    return (
      <div
        ref={wrapperRef}
        className={`video-unified-player__frame video-unified-player__frame--youtube${vertical ? " video-unified-player__frame--vertical" : ""}`}
      >
        <YouTubeEmbedConsentPrompt
          message={youtubePermission.message}
          onAccept={youtubePermission.accept}
          sourceUrl={video.sourceUrl}
          status={youtubePermission.status}
        />
      </div>
    );
  }

  if (!thirdPartyReady) {
    return (
      <div
        ref={wrapperRef}
        className={`video-unified-player__frame video-unified-player__frame--${video.provider}${vertical ? " video-unified-player__frame--vertical" : ""}`}
      >
        <ThirdPartyEmbedPlaceholder
          providerLabel={thirdPartyProviderLabel(video)}
          sourceUrl={video.sourceUrl}
          onLoad={() => setThirdPartyLoadedFor(video.sourceUrl)}
        />
      </div>
    );
  }

  if (
    video.provider === "youtube" &&
    initialYouTubeEmbedUrlRef.current === null
  ) {
    initialYouTubeEmbedUrlRef.current = embedUrl(
      video,
      effectiveAutoplay,
      youtubePermission.embedUrl ?? undefined,
    );
  }
  const playerUrl =
    video.provider === "youtube"
      ? initialYouTubeEmbedUrlRef.current!
      : embedUrl(
          video,
          effectiveAutoplay,
          youtubePermission.embedUrl ?? undefined,
        );

  return (
    <div
      ref={wrapperRef}
      className={`video-unified-player__frame video-unified-player__frame--${video.provider}${vertical ? " video-unified-player__frame--vertical" : ""}`}
    >
      <iframe
        key={retryKey}
        ref={frameRef}
        src={playerUrl}
        title={`${video.title} — ${video.channel}`}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        loading="lazy"
        referrerPolicy="strict-origin-when-cross-origin"
        onLoad={() => setFrameState("ready")}
      />
      {video.provider !== "youtube" && frameState === "loading" ? <div className="video-unified-player__state" role="status">動画を読み込んでいます…</div> : null}
      {video.provider !== "youtube" && frameState === "error" ? <div className="video-unified-player__state video-unified-player__state--error" role="alert"><strong>埋め込みを再生できません</strong><span><button type="button" onClick={() => { startedRef.current = false; setFrameState("loading"); setRetryKey((value) => value + 1); }}>再試行</button><a href={video.sourceUrl} target="_blank" rel="noopener noreferrer">配信元サイトで見る</a></span></div> : null}
    </div>
  );
}
