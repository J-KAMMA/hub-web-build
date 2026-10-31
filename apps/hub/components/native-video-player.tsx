"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { claimPlayback, onPlaybackClaimed, takeHandoffPosition } from "@/lib/media-playback";
import { attachNativePlayback, NativeVideoClientError, type NativePlayback } from "@/lib/native-video-client";

import "./native-video.css";

/*
 * Player for a Hub self-made video ("Hub動画"). It lives in the same player area as the embeds
 * (.video-unified-player__frame) and plays the HLS stream from the Video Worker with hls.js.
 * Hub issues a play ticket after its own visibility, follow, token-gate and age checks; this
 * component only shows what the checks answer. A new ticket and playlist are fetched every
 * 15 minutes without interrupting playback.
 */

export function NativeVideoPlayer({ videoId, title, onStarted, owner = "hub-video-page", autoplay = false, onLeave, compact = false, preview = false }: {
  videoId: string;
  title: string;
  onStarted?: () => void;
  /* 鳴らす場所の名前（lib/media-playback.ts）。視聴画面と小窓で別にする。 */
  owner?: string;
  autoplay?: boolean;
  /* 画面から外れるとき、そのときの位置（秒）と鳴っていたかを渡す。小窓への受け渡しに使う。 */
  onLeave?: (seconds: number, playing: boolean) => void;
  compact?: boolean;
  /* 作成者本人の下見（審査待ち・非公開の動画）。 */
  preview?: boolean;
}) {
  const element = useRef<HTMLVideoElement | null>(null);
  const [problem, setProblem] = useState<NativeVideoClientError | null>(null);
  const [loading, setLoading] = useState(true);
  const [vertical, setVertical] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const started = useRef(false);
  const onLeaveRef = useRef(onLeave);
  onLeaveRef.current = onLeave;
  const autoplayRef = useRef(autoplay);
  autoplayRef.current = autoplay;

  /* ほかの音楽・動画が鳴り始めたら一時停止する。 */
  useEffect(() => onPlaybackClaimed(owner, () => element.current?.pause()), [owner]);

  /* 画面から外れるとき、位置と鳴っていたかを知らせる。要素が外れるので音はそこで止まる。 */
  useLayoutEffect(() => {
    const video = element.current;
    return () => {
      if (video) onLeaveRef.current?.(video.currentTime, !video.paused && !video.ended);
    };
  }, [videoId]);

  useEffect(() => {
    const video = element.current;
    if (!video) return;
    let cancelled = false;
    let playback: NativePlayback | null = null;
    started.current = false;
    setProblem(null);
    setLoading(true);
    attachNativePlayback(video, videoId, { onError: (error) => { if (!cancelled) setProblem(error); } }, { preview })
      .then((attached) => {
        if (cancelled) attached.destroy();
        else {
          playback = attached;
          setLoading(false);
          /* 小窓（または視聴画面）から受け取った位置があれば、そこから続ける。 */
          const resumeAt = takeHandoffPosition(videoId);
          if (resumeAt > 0) {
            try { video.currentTime = resumeAt; } catch { /* 位置を決められなくても頭から鳴らす */ }
          }
          if (resumeAt > 0 || autoplayRef.current) void video.play().catch(() => undefined);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setProblem(error instanceof NativeVideoClientError ? error : new NativeVideoClientError("unavailable", "再生を始められませんでした。"));
        setLoading(false);
      });
    return () => {
      cancelled = true;
      playback?.destroy();
    };
  }, [videoId, attempt, preview]);

  const handlePlay = useCallback(() => {
    claimPlayback(owner);
    if (started.current) return;
    started.current = true;
    onStarted?.();
  }, [onStarted, owner]);

  const needsLogin = problem?.code === "authentication_required";

  return (
    <div className={`video-detail-player native-video${compact ? " native-video--compact" : ""}`} data-native-video-state={problem ? "error" : loading ? "loading" : "ready"}>
      <div className={`video-unified-player__frame native-video__frame${vertical ? " video-unified-player__frame--vertical" : ""}`}>
        <video
          ref={element}
          className="native-video__element"
          controls
          playsInline
          preload="metadata"
          aria-label={title}
          onPlay={handlePlay}
          onLoadedMetadata={(event) => {
            const { videoWidth, videoHeight } = event.currentTarget;
            setVertical(videoHeight > videoWidth);
          }}
        />
        {compact ? null : <span className="native-video__badge">Hub動画</span>}
        {loading && !problem ? <p className="native-video__overlay" role="status">読み込み中…</p> : null}
        {problem ? (
          <div className="native-video__overlay native-video__overlay--problem" role="alert">
            <p>{problem.message}</p>
            {needsLogin ? (
              <a className="native-video__action" href="/v2/auth">ログイン</a>
            ) : problem.code === "locked" || problem.code === "age_restricted" || problem.code === "not_found" ? null : (
              <button className="native-video__action" type="button" onClick={() => setAttempt((value) => value + 1)}>もう一度試す</button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
