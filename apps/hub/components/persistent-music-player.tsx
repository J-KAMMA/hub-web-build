"use client";

import React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import {
  useYouTubeEmbedPermission,
  YouTubeEmbedConsentPrompt,
} from "@/components/youtube-embed-consent";
import {
  MUSIC_PLAYER_PLAY_EVENT,
  MUSIC_PLAYER_ENDED_EVENT,
  MUSIC_PLAYER_ENQUEUE_NEXT_EVENT,
  MUSIC_PLAYER_NEXT_EVENT,
  MUSIC_PLAYER_PAUSE_EVENT,
  MUSIC_PLAYER_PREVIOUS_EVENT,
  MUSIC_PLAYER_QUEUE_EVENT,
  MUSIC_PLAYER_RESUME_EVENT,
  MUSIC_PLAYER_STOP_EVENT,
  MUSIC_PLAYER_STATE_EVENT,
  MUSIC_PLAYER_STATE_REQUEST_EVENT,
  MUSIC_PLAYER_TOGGLE_EVENT,
  MUSIC_PLAYER_VOLUME_EVENT,
  notifyPersistentMusicEnded,
  playPersistentMusic,
  type PersistentMusicQueue,
  type PersistentMusicTrack,
} from "@/lib/music-player-events";
import { ThirdPartyEmbedPlaceholder } from "@/components/third-party-embed-placeholder";
import { recordMusicListeningAction } from "@/lib/music-listening-profile";
import { VIDEO_PLAYER_PLAY_EVENT } from "@/lib/video-player-events";

type YouTubePlayer = {
  destroy: () => void;
  getPlayerState: () => number;
  pauseVideo: () => void;
  playVideo: () => void;
  setVolume?: (volume: number) => void;
};
type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: { events: Record<string, (event: { data?: number; target: YouTubePlayer }) => void> },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number; PAUSED: number; PLAYING: number };
};

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

function loadYouTubeApi() {
  const playerWindow = window as typeof window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
  if (playerWindow.YT?.Player) return Promise.resolve(playerWindow.YT);
  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previous = playerWindow.onYouTubeIframeAPIReady;
      playerWindow.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (playerWindow.YT) resolve(playerWindow.YT);
      };
      const existing = document.getElementById("hub-youtube-iframe-api");
      if (existing) return;
      const script = document.createElement("script");
      script.id = "hub-youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.addEventListener("error", () => reject(new Error("YouTube player API failed to load")), { once: true });
      document.body.append(script);
    });
  }
  return youtubeApiPromise;
}

function youtubeEmbedUrl(track: PersistentMusicTrack, authorizedEmbedUrl: string) {
  const url = new URL(authorizedEmbedUrl);
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("origin", window.location.origin);
  url.searchParams.set("widget_referrer", window.location.origin);
  if (track.autoplay !== false) url.searchParams.set("autoplay", "1");
  return url.toString();
}

function YouTubeMiniPlayer({ onError, onPlayingChange, track, volume }: { onError: () => void; onPlayingChange: (playing: boolean) => void; track: PersistentMusicTrack; volume: number }) {
  const videoId = track.embedUrl ? new URL(track.embedUrl).pathname.split("/").filter(Boolean).at(-1) ?? "" : "";
  const permission = useYouTubeEmbedPermission(videoId);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let player: YouTubePlayer | null = null;
    let cancelled = false;
    void loadYouTubeApi().then((api) => {
      if (cancelled) return;
      player = new api.Player(frame, {
        events: {
          onReady: (event) => {
            event.target.setVolume?.(volumeRef.current);
            if (track.autoplay !== false) event.target.playVideo();
          },
          onStateChange: (event) => {
            if (event.data === api.PlayerState.PLAYING) onPlayingChange(true);
            if (event.data === api.PlayerState.PAUSED) onPlayingChange(false);
            if (event.data === api.PlayerState.ENDED) {
              onPlayingChange(false);
              notifyPersistentMusicEnded(track);
            }
          },
          onError,
        },
      });
      playerRef.current = player;
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      player?.destroy();
      playerRef.current = null;
    };
  }, [onError, onPlayingChange, permission.status, track]);

  useEffect(() => {
    playerRef.current?.setVolume?.(volume);
  }, [volume]);

  useEffect(() => {
    const toggle = () => {
      void loadYouTubeApi().then((api) => {
        const player = playerRef.current;
        if (!player) return;
        if (player.getPlayerState() === api.PlayerState.PLAYING) player.pauseVideo();
        else player.playVideo();
      }).catch(() => undefined);
    };
    const resume = () => playerRef.current?.playVideo();
    const pause = () => playerRef.current?.pauseVideo();
    window.addEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
    window.addEventListener(MUSIC_PLAYER_RESUME_EVENT, resume);
    window.addEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
      window.removeEventListener(MUSIC_PLAYER_RESUME_EVENT, resume);
      window.removeEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
    };
  }, []);

  if (permission.status !== "allowed") {
    return (
      <YouTubeEmbedConsentPrompt
        message={permission.message}
        onAccept={permission.accept}
        sourceUrl={track.externalUrl ?? `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
        status={permission.status}
      />
    );
  }

  return (
    <iframe
      ref={frameRef}
      src={youtubeEmbedUrl(track, permission.embedUrl)}
      title={`${track.title}のYouTubeプレイヤー`}
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="origin"
    />
  );
}

/* YouTube 以外の外部プレーヤー。押されるまで iframe を作らず、提供元へ何も送らない（2026-10-14）。 */
export function ThirdPartyMusicEmbed({ track, embedUrl }: { track: PersistentMusicTrack; embedUrl: string }) {
  const [loaded, setLoaded] = useState(false);
  if (!loaded) {
    return (
      <ThirdPartyEmbedPlaceholder
        providerLabel={track.providerLabel}
        sourceUrl={track.externalUrl ?? embedUrl}
        onLoad={() => setLoaded(true)}
      />
    );
  }
  return (
    <iframe
      src={embedUrl}
      title={`${track.title}の${track.providerLabel}プレイヤー`}
      allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}

function HubAudioMiniPlayer({ onError, onPlayingChange, track, volume }: { onError: () => void; onPlayingChange: (playing: boolean) => void; track: PersistentMusicTrack; volume: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const resumeKey = `music.player.resume.${track.id}`;

  useEffect(() => {
    if (track.autoplay === false) return;
    void audioRef.current?.play().catch(() => undefined);
  }, [track]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    const toggle = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) void audio.play().catch(() => undefined);
      else audio.pause();
    };
    const pause = () => audioRef.current?.pause();
    window.addEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
    window.addEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
      window.removeEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
    };
  }, []);

  return (
    <audio
      ref={audioRef}
      controls
      autoPlay={track.autoplay !== false}
      preload="metadata"
      src={track.audioUrl}
      onLoadedMetadata={(event) => {
        try {
          const saved = Number(window.localStorage.getItem(resumeKey) ?? "0");
          if (Number.isFinite(saved) && saved > 3 && saved < event.currentTarget.duration - 10) event.currentTarget.currentTime = saved;
        } catch { /* resume is optional */ }
      }}
      onTimeUpdate={(event) => {
        const seconds = Math.floor(event.currentTarget.currentTime);
        if (seconds > 0 && seconds % 5 === 0) try { window.localStorage.setItem(resumeKey, String(seconds)); } catch { /* resume is optional */ }
      }}
      onPlay={() => onPlayingChange(true)}
      onPause={() => onPlayingChange(false)}
      onEnded={() => { try { window.localStorage.removeItem(resumeKey); } catch { /* resume is optional */ } notifyPersistentMusicEnded(track); }}
      onError={onError}
    />
  );
}

function MiniPlayerArtwork({ track }: { track: PersistentMusicTrack }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [track.artworkUrl]);
  return track.artworkUrl && !failed
    ? <img src={track.artworkUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />
    : <span aria-hidden="true">♫</span>;
}

export function PersistentMusicPlayer() {
  const router = useRouter();
  const [track, setTrack] = useState<PersistentMusicTrack | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [queue, setQueue] = useState<PersistentMusicTrack[]>([]);
  const [queueOpen, setQueueOpen] = useState(false);
  const [repeatMode, setRepeatMode] = useState<"off" | "all" | "one">("all");
  const [shuffle, setShuffle] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [playbackError, setPlaybackError] = useState("");
  const trackRef = useRef<PersistentMusicTrack | null>(null);
  const queueRef = useRef<PersistentMusicTrack[]>([]);
  const collapsedRef = useRef(false);
  const repeatModeRef = useRef<"off" | "all" | "one">("all");
  const autoPlayRef = useRef(true);
  const playerSessionKey = "music.player.session.v1";

  const clearPlayer = useCallback(() => {
    trackRef.current = null;
    queueRef.current = [];
    setTrack(null);
    setPlaying(false);
    setQueue([]);
    setQueueOpen(false);
    setPlaybackError("");
  }, []);

  const updateVolume = useCallback((next: number) => {
    setVolume(next);
    try { window.localStorage.setItem("music.player.volume", String(next)); } catch { /* optional preference */ }
  }, []);

  const toggleCollapsed = () => {
    if (!collapsed && track?.provider === "youtube") {
      window.dispatchEvent(new Event(MUSIC_PLAYER_PAUSE_EVENT));
      setPlaying(false);
    }
    setCollapsed((current) => {
      collapsedRef.current = !current;
      return !current;
    });
  };

  const openAndPlayYouTube = () => {
    collapsedRef.current = false;
    setCollapsed(false);
    window.dispatchEvent(new Event(MUSIC_PLAYER_RESUME_EVENT));
  };

  useEffect(() => {
    const raw = window.localStorage.getItem("music.player.volume");
    if (raw === null) return;
    const stored = Number(raw);
    if (Number.isFinite(stored) && stored >= 0 && stored <= 100) setVolume(stored);
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(playerSessionKey) ?? "null") as {
        track?: PersistentMusicTrack;
        queue?: PersistentMusicTrack[];
        collapsed?: boolean;
      } | null;
      if (!saved?.track?.id) return;
      const restored = { ...saved.track, autoplay: false, keepCollapsed: true };
      trackRef.current = restored;
      queueRef.current = Array.isArray(saved.queue) ? saved.queue : [restored];
      collapsedRef.current = true;
      setTrack(restored);
      setQueue(queueRef.current);
      setCollapsed(saved.collapsed ?? true);
      setPlaying(false);
    } catch { /* optional session restoration */ }
  }, []);

  useEffect(() => {
    try {
      if (!track) window.localStorage.removeItem(playerSessionKey);
      else window.localStorage.setItem(playerSessionKey, JSON.stringify({ track, queue, collapsed }));
    } catch { /* optional session persistence */ }
  }, [track, queue, collapsed]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    if (!track) {
      navigator.mediaSession.metadata = null;
      return;
    }
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.providerLabel,
      artwork: track.artworkUrl ? [{ src: track.artworkUrl }] : [],
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => window.dispatchEvent(new Event(MUSIC_PLAYER_RESUME_EVENT)));
    navigator.mediaSession.setActionHandler("pause", () => window.dispatchEvent(new Event(MUSIC_PLAYER_PAUSE_EVENT)));
    navigator.mediaSession.setActionHandler("nexttrack", () => window.dispatchEvent(new Event(MUSIC_PLAYER_NEXT_EVENT)));
    navigator.mediaSession.setActionHandler("previoustrack", () => window.dispatchEvent(new Event(MUSIC_PLAYER_PREVIOUS_EVENT)));
    return () => {
      for (const action of ["play", "pause", "nexttrack", "previoustrack"] as MediaSessionAction[]) {
        navigator.mediaSession.setActionHandler(action, null);
      }
    };
  }, [track, playing]);

  useEffect(() => {
    const storedRepeat = window.localStorage.getItem("music.player.repeat");
    const storedShuffle = window.localStorage.getItem("music.player.shuffle");
    const storedAutoPlay = window.localStorage.getItem("music.player.autoplay");
    if (storedRepeat === "off" || storedRepeat === "all" || storedRepeat === "one") {
      repeatModeRef.current = storedRepeat;
      setRepeatMode(storedRepeat);
    }
    if (storedShuffle === "true") setShuffle(true);
    if (storedAutoPlay === "false") {
      autoPlayRef.current = false;
      setAutoPlay(false);
    }
  }, []);

  useEffect(() => {
    const changeVolume = (event: Event) => {
      const next = Number((event as CustomEvent<number>).detail);
      if (Number.isFinite(next)) updateVolume(Math.min(100, Math.max(0, next)));
    };
    window.addEventListener(MUSIC_PLAYER_VOLUME_EVENT, changeVolume);
    return () => window.removeEventListener(MUSIC_PLAYER_VOLUME_EVENT, changeVolume);
  }, [updateVolume]);

  useEffect(() => {
    const publishState = () => window.dispatchEvent(new CustomEvent(MUSIC_PLAYER_STATE_EVENT, {
      detail: { track, playing, volume, queue },
    }));
    window.addEventListener(MUSIC_PLAYER_STATE_REQUEST_EVENT, publishState);
    publishState();
    return () => window.removeEventListener(MUSIC_PLAYER_STATE_REQUEST_EVENT, publishState);
  }, [track, playing, volume, queue]);

  useEffect(() => {
    const play = (event: Event) => {
      const next = (event as CustomEvent<PersistentMusicTrack>).detail;
      if (!next?.id) return;
      trackRef.current = next;
      setTrack(next);
      setPlaying(next.autoplay !== false);
      setPlaybackError("");
      collapsedRef.current = Boolean(next.keepCollapsed);
      setCollapsed(Boolean(next.keepCollapsed));
      recordMusicListeningAction("play", next);
    };
    const configureQueue = (event: Event) => {
      const next = (event as CustomEvent<PersistentMusicQueue>).detail;
      const tracks = Array.isArray(next?.tracks) ? next.tracks : [];
      queueRef.current = tracks;
      setQueue(tracks);
    };
    const enqueueNext = (event: Event) => {
      const next = (event as CustomEvent<PersistentMusicTrack>).detail;
      if (!next?.id) return;
      const currentId = trackRef.current?.id;
      const current = queueRef.current.filter((item) => item.id !== next.id);
      const currentIndex = current.findIndex((item) => item.id === currentId);
      const insertAt = currentIndex >= 0 ? currentIndex + 1 : 0;
      const updated = [...current.slice(0, insertAt), next, ...current.slice(insertAt)];
      queueRef.current = updated;
      setQueue(updated);
    };
    const stop = () => clearPlayer();
    window.addEventListener(MUSIC_PLAYER_PLAY_EVENT, play);
    window.addEventListener(MUSIC_PLAYER_QUEUE_EVENT, configureQueue);
    window.addEventListener(MUSIC_PLAYER_ENQUEUE_NEXT_EVENT, enqueueNext);
    window.addEventListener(MUSIC_PLAYER_STOP_EVENT, stop);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_PLAY_EVENT, play);
      window.removeEventListener(MUSIC_PLAYER_QUEUE_EVENT, configureQueue);
      window.removeEventListener(MUSIC_PLAYER_ENQUEUE_NEXT_EVENT, enqueueNext);
      window.removeEventListener(MUSIC_PLAYER_STOP_EVENT, stop);
    };
  }, [clearPlayer]);

  useEffect(() => {
    window.addEventListener(VIDEO_PLAYER_PLAY_EVENT, clearPlayer);
    return () => window.removeEventListener(VIDEO_PLAYER_PLAY_EVENT, clearPlayer);
  }, [clearPlayer]);

  const moveQueue = useCallback((direction: -1 | 1, skipped = false, ended = false) => {
    const currentTrack = trackRef.current;
    const currentQueue = queueRef.current;
    if (!currentTrack || !currentQueue.length) return;
    const currentIndex = currentQueue.findIndex((item) => item.id === currentTrack.id);
    if (ended && !autoPlayRef.current) {
      setPlaying(false);
      return;
    }
    if (ended && repeatModeRef.current === "one") {
      playPersistentMusic({ ...currentTrack, autoplay: true, keepCollapsed: collapsedRef.current });
      return;
    }
    const proposedIndex = currentIndex < 0 ? (direction === 1 ? 0 : currentQueue.length - 1) : currentIndex + direction;
    if (repeatModeRef.current === "off" && (proposedIndex < 0 || proposedIndex >= currentQueue.length)) {
      setPlaying(false);
      return;
    }
    const nextIndex = (proposedIndex + currentQueue.length) % currentQueue.length;
    const next = currentQueue[nextIndex];
    if (skipped) recordMusicListeningAction("skip", currentTrack);
    const keepCollapsed = collapsedRef.current;
    playPersistentMusic({
      ...next,
      autoplay: !(keepCollapsed && next.provider === "youtube"),
      keepCollapsed,
    });
  }, []);

  useEffect(() => {
    const ended = () => moveQueue(1, false, true);
    const next = () => moveQueue(1, true);
    const previous = () => moveQueue(-1);
    window.addEventListener(MUSIC_PLAYER_ENDED_EVENT, ended);
    window.addEventListener(MUSIC_PLAYER_NEXT_EVENT, next);
    window.addEventListener(MUSIC_PLAYER_PREVIOUS_EVENT, previous);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_ENDED_EVENT, ended);
      window.removeEventListener(MUSIC_PLAYER_NEXT_EVENT, next);
      window.removeEventListener(MUSIC_PLAYER_PREVIOUS_EVENT, previous);
    };
  }, [moveQueue]);

  useEffect(() => {
    if (!track || track.provider !== "youtube") return;
    const pauseWhenHidden = () => {
      if (!document.hidden) return;
      window.dispatchEvent(new Event(MUSIC_PLAYER_PAUSE_EVENT));
      setPlaying(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [track]);

  useEffect(() => {
    if (!track) return;
    const keepPlaybackDuringHubNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest<HTMLAnchorElement>("a[href]");
      if (!anchor || anchor.download || (anchor.target && anchor.target !== "_self")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/music/api/") || url.pathname.startsWith("/vault/api/")) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) return;
      event.preventDefault();
      router.push(`${url.pathname}${url.search}${url.hash}`);
    };
    document.addEventListener("click", keepPlaybackDuringHubNavigation, true);
    return () => document.removeEventListener("click", keepPlaybackDuringHubNavigation, true);
  }, [router, track]);

  const changeRepeatMode = () => {
    const next = repeatMode === "all" ? "one" : repeatMode === "one" ? "off" : "all";
    repeatModeRef.current = next;
    setRepeatMode(next);
    window.localStorage.setItem("music.player.repeat", next);
  };

  const toggleAutoPlay = () => {
    const next = !autoPlay;
    autoPlayRef.current = next;
    setAutoPlay(next);
    window.localStorage.setItem("music.player.autoplay", String(next));
  };

  const toggleShuffle = () => {
    const nextEnabled = !shuffle;
    setShuffle(nextEnabled);
    window.localStorage.setItem("music.player.shuffle", String(nextEnabled));
    if (!nextEnabled || !trackRef.current) return;
    const current = trackRef.current;
    const remaining = queueRef.current.filter((item) => item.id !== current.id);
    for (let index = remaining.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [remaining[index], remaining[target]] = [remaining[target], remaining[index]];
    }
    const updated = [current, ...remaining];
    queueRef.current = updated;
    setQueue(updated);
  };

  const moveQueueItem = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= queue.length) return;
    const updated = [...queue];
    [updated[index], updated[target]] = [updated[target], updated[index]];
    queueRef.current = updated;
    setQueue(updated);
  };

  const removeQueueItem = (id: string) => {
    if (trackRef.current?.id === id) return;
    const updated = queue.filter((item) => item.id !== id);
    queueRef.current = updated;
    setQueue(updated);
  };

  const handlePlaybackError = useCallback(() => {
    const failed = trackRef.current;
    if (!failed) return;
    setPlaybackError("この曲を再生できなかったため、次の曲へ移動します。");
    try {
      const stored = JSON.parse(window.localStorage.getItem("music.player.unavailable") ?? "[]") as unknown;
      const ids = Array.isArray(stored) ? stored.filter((item): item is string => typeof item === "string") : [];
      window.localStorage.setItem("music.player.unavailable", JSON.stringify([...new Set([...ids, failed.id])].slice(-300)));
    } catch { /* optional health cache */ }
    window.setTimeout(() => moveQueue(1, true), 900);
  }, [moveQueue]);

  if (!track) return null;
  const queueIndex = queue.findIndex((item) => item.id === track.id);
  const hasPrevious = queueIndex >= 0 && queue.length > 0;
  const hasNext = queueIndex >= 0 && queue.length > 0;

  return (
    <aside className={`hub-music-mini-player${collapsed ? " is-collapsed" : ""}`} aria-label="ミニプレーヤー">
      <header>
        <button
          type="button"
          className="hub-music-mini-player__summary"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "曲情報とプレーヤーを開く" : "プレーヤーを小さくする"}
        >
          <MiniPlayerArtwork track={track} />
          <span><strong>{track.title}</strong><b>{track.artist}</b></span>
        </button>
        <button type="button" className="hub-music-mini-player__close" onClick={clearPlayer} aria-label="再生を停止して閉じる">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </header>
      <div className="hub-music-mini-player__body">
        {track.provider === "hub" && track.audioUrl ? (
          <HubAudioMiniPlayer key={track.id} track={track} onError={handlePlaybackError} onPlayingChange={setPlaying} volume={volume} />
        ) : track.provider === "youtube" && track.embedUrl ? (
          <div className="music-player-frame music-player-frame--youtube"><YouTubeMiniPlayer key={track.id} track={track} onError={handlePlaybackError} onPlayingChange={setPlaying} volume={volume} /></div>
        ) : track.embedUrl ? (
          <div className={`music-player-frame music-player-frame--${track.provider}`}>
            <ThirdPartyMusicEmbed key={track.id} track={track} embedUrl={track.embedUrl} />
          </div>
        ) : null}
        {track.provider === "youtube" ? (
          <div className="hub-music-mini-player__controls hub-music-mini-player__controls--youtube" aria-label="YouTubeキュー操作">
            <button type="button" disabled={!hasPrevious} onClick={() => window.dispatchEvent(new Event(MUSIC_PLAYER_PREVIOUS_EVENT))} aria-label="前の曲">|‹</button>
            <button type="button" className="is-primary" onClick={collapsed ? openAndPlayYouTube : () => window.dispatchEvent(new Event(MUSIC_PLAYER_TOGGLE_EVENT))} aria-label={collapsed ? "再生してプレーヤーを開く" : playing ? "一時停止" : "再生"}>{playing && !collapsed ? "Ⅱ" : "▶"}</button>
            <button type="button" disabled={!hasNext} onClick={() => window.dispatchEvent(new Event(MUSIC_PLAYER_NEXT_EVENT))} aria-label="次の曲">›|</button>
            <label>
              <span aria-hidden="true">{volume === 0 ? "🔇" : "🔊"}</span>
              <input type="range" min={0} max={100} step={1} value={volume} onChange={(event) => updateVolume(Number(event.currentTarget.value))} aria-label="音量" />
              <output>{volume}%</output>
            </label>
          </div>
        ) : (
          <div className="hub-music-mini-player__controls" aria-label="再生操作">
            <button type="button" disabled={!hasPrevious} onClick={() => window.dispatchEvent(new Event(MUSIC_PLAYER_PREVIOUS_EVENT))} aria-label="前の曲">|‹</button>
            <button type="button" className="is-primary" onClick={() => window.dispatchEvent(new Event(MUSIC_PLAYER_TOGGLE_EVENT))} aria-label={playing ? "一時停止" : "再生"}>{playing ? "Ⅱ" : "▶"}</button>
            <button type="button" disabled={!hasNext} onClick={() => window.dispatchEvent(new Event(MUSIC_PLAYER_NEXT_EVENT))} aria-label="次の曲">›|</button>
            <small>{playing ? "再生中" : "一時停止"}</small>
            <label>
              <span aria-hidden="true">{volume === 0 ? "🔇" : "🔊"}</span>
              <input type="range" min={0} max={100} step={1} value={volume} onChange={(event) => updateVolume(Number(event.currentTarget.value))} aria-label="音量" />
              <output>{volume}%</output>
            </label>
          </div>
        )}
        {playbackError ? <p className="hub-music-mini-player__error" role="status">{playbackError}</p> : null}
      </div>
    </aside>
  );
}
