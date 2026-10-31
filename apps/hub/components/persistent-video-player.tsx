"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CrossProviderVideoPlayer } from "@/components/cross-provider-video-player";
import {
  MUSIC_PLAYER_PLAY_EVENT,
  MUSIC_PLAYER_STOP_EVENT,
} from "@/lib/music-player-events";
import { rememberVideo } from "@/lib/video-personalization";
import { isVerticalVideo } from "@/lib/video-display-format";
import {
  type PersistentVideoTrack,
  VIDEO_PLAYER_PLAY_EVENT,
  VIDEO_PLAYER_STOP_EVENT,
} from "@/lib/video-player-events";

export function PersistentVideoPlayer() {
  const [video, setVideo] = useState<PersistentVideoTrack | null>(null);
  const [message, setMessage] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(100);
  const [history, setHistory] = useState<PersistentVideoTrack[]>([]);
  const close = useCallback(() => {
    setVideo(null);
    setMessage("");
    setCollapsed(false);
  }, []);
  useEffect(() => {
    const play = (event: Event) => {
      const next = (event as CustomEvent<PersistentVideoTrack>).detail;
      if (!next?.id) return;
      window.dispatchEvent(new Event(MUSIC_PLAYER_STOP_EVENT));
      setMessage("");
      setCollapsed(false);
      setPlaying(true);
      setHistory([]);
      setVideo(next);
    };
    window.addEventListener(VIDEO_PLAYER_PLAY_EVENT, play);
    window.addEventListener(VIDEO_PLAYER_STOP_EVENT, close);
    window.addEventListener(MUSIC_PLAYER_PLAY_EVENT, close);
    return () => {
      window.removeEventListener(VIDEO_PLAYER_PLAY_EVENT, play);
      window.removeEventListener(VIDEO_PLAYER_STOP_EVENT, close);
      window.removeEventListener(MUSIC_PLAYER_PLAY_EVENT, close);
    };
  }, [close]);
  const recordStarted = useCallback(() => {
    if (!video) return;
    setPlaying(true);
    setMessage("");
    rememberVideo(window.localStorage, video.id);
    void fetch(`/api/videos/${encodeURIComponent(video.id)}/view`, {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => undefined);
  }, [video]);
  const sendPlayerCommand = useCallback(
    (command: "play" | "pause", nextVolume?: number) => {
      const frame = document.querySelector<HTMLIFrameElement>(
        ".hub-video-mini-player iframe",
      );
      if (!frame?.contentWindow || !video) return;
      if (video.provider === "youtube") {
        frame.contentWindow.postMessage(
          JSON.stringify({
            event: "command",
            func: nextVolume === undefined ? `${command}Video` : "setVolume",
            args: nextVolume === undefined ? [] : [nextVolume],
          }),
          "*",
        );
      } else if (video.provider === "tiktok") {
        frame.contentWindow.postMessage(
          {
            type:
              nextVolume === undefined
                ? command
                : nextVolume === 0
                  ? "mute"
                  : "unMute",
            "x-tiktok-player": true,
          },
          "https://www.tiktok.com",
        );
      }
    },
    [video],
  );
  const togglePlayback = useCallback(() => {
    const nextPlaying = !playing;
    sendPlayerCommand(nextPlaying ? "play" : "pause");
    setPlaying(nextPlaying);
  }, [playing, sendPlayerCommand]);
  const updateVolume = useCallback(
    (nextVolume: number) => {
      setVolume(nextVolume);
      sendPlayerCommand("play", nextVolume);
    },
    [sendPlayerCommand],
  );
  const advance = useCallback(() => {
    setVideo((current) => {
      if (!current) return current;
      const [next, ...remaining] = current?.queue ?? [];
      if (!next) {
        setPlaying(false);
        setMessage("再生が終了しました。");
        return current;
      }
      setMessage("次の動画を再生しています。");
      setPlaying(true);
      setCollapsed(false);
      const { queue: _queue, ...playedVideo } = current;
      setHistory((items) => [...items, playedVideo]);
      return { ...next, queue: remaining };
    });
  }, []);
  const previous = useCallback(() => {
    const prior = history.at(-1);
    if (!prior || !video) return;
    setHistory((items) => items.slice(0, -1));
    setMessage("");
    setPlaying(true);
    const { queue: _queue, ...currentVideo } = video;
    setVideo({
      ...prior,
      queue: [currentVideo, ...(video.queue ?? [])],
    });
  }, [history, video]);
  if (!video) return null;
  const short = isVerticalVideo(video);
  return (
    <aside
      className={`hub-music-mini-player hub-video-mini-player${collapsed ? " is-collapsed" : ""}`}
      aria-label="動画ミニプレイヤー"
    >
      <header>
        <button
          type="button"
          className="hub-music-mini-player__summary"
          onClick={() => setCollapsed((current) => !current)}
          aria-expanded={!collapsed}
          aria-label={
            collapsed ? "動画プレイヤーを開く" : "動画プレイヤーを小さくする"
          }
        >
          <span aria-hidden="true">▶</span>
          <span>
            <strong>{video.title}</strong>
            <b>{video.channel}</b>
            <small>{short ? "ショート" : "動画"}</small>
          </span>
        </button>
        <button
          type="button"
          className="hub-music-mini-player__close"
          onClick={close}
          aria-label="動画を停止して閉じる"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </header>
      <div className="hub-music-mini-player__body">
        {collapsed ? (
          <div
            className="hub-video-mini-player__compact-controls"
            aria-label="動画の再生操作"
          >
            <button
              type="button"
              onClick={() => setCollapsed(false)}
              aria-label="動画を再生してプレイヤーを開く"
            >
              <span aria-hidden="true">▶</span>
            </button>
          </div>
        ) : (
          <>
            <CrossProviderVideoPlayer
              key={video.provider}
              authenticated={video.authenticated}
              video={video}
              autoplay
              requireMostlyVisible={false}
              onStarted={recordStarted}
              onEnded={advance}
              onAutoplayBlocked={() =>
                setMessage("プレイヤー内の再生ボタンを押してください。")
              }
              onPlaybackError={() =>
                setMessage("埋め込みを再生できません。配信元サイトで確認してください。")
              }
            />
            <div
              className="hub-music-mini-player__controls hub-music-mini-player__controls--youtube"
              aria-label="動画の再生操作"
            >
              <button type="button" disabled={!history.length} onClick={previous} aria-label="前の動画">|‹</button>
              <button type="button" className="is-primary" onClick={togglePlayback} aria-label={playing ? "一時停止" : "再生"}>
                {playing ? "Ⅱ" : "▶"}
              </button>
              <button type="button" disabled={!video.queue?.length} onClick={advance} aria-label="次の動画">›|</button>
              <label>
                <span aria-hidden="true">{volume === 0 ? "🔇" : "🔊"}</span>
                <input type="range" min={0} max={100} step={1} value={volume} onChange={(event) => updateVolume(Number(event.currentTarget.value))} aria-label="音量" />
                <output>{volume}%</output>
              </label>
            </div>
            {message ? (
              <div className="video-mini-player__status" role="status">
                {message}
              </div>
            ) : null}
          </>
        )}
      </div>
    </aside>
  );
}
