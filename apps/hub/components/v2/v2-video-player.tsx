"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

import { CrossProviderVideoPlayer } from "@/components/cross-provider-video-player";
import { NativeVideoPlayer } from "@/components/native-video-player";
import { PLAYER_OWNER, V2PlayerFrame } from "@/components/v2/v2-player-shell";
import { rememberHandoffPosition } from "@/lib/media-playback";
import { isVerticalVideo } from "@/lib/video-display-format";
import { rememberVideo } from "@/lib/video-personalization";
import { VIDEO_PLAYER_PLAY_EVENT, VIDEO_PLAYER_STOP_EVENT, type PersistentVideoTrack } from "@/lib/video-player-events";

/*
 * v2 の動画の小窓（2026-09-03、旦那様「動画側も」）。
 * 2026-10-18（所有者承認）：音楽と同じ1枚の盤（V2PlayerShell）に入る。鳴らすのは1つだけで、
 * 片方が始まるともう片方は一時停止して、盤の下の1行に畳まれる。
 *
 * Hub動画（provider: "hub"）は、視聴画面で再生中に画面を離れると、同じ位置からここで続く。
 * 視聴画面へ戻ると、ここで止めた位置から視聴画面で続く（位置は lib/media-playback.ts が画面の間だけ持つ）。
 *
 * **配信元の規約はそのまま**（YouTube は lib/youtube-iframe-api.ts に要約）。
 *   - 埋め込みは既存の CrossProviderVideoPlayer に任せる。同意の欄も自動再生の決まりもそこにある
 *   - 絵の上に何も重ねない。絵は 356×200 以上（縦型は横 202px 以上）
 *   - 音だけにしない。閉じると再生も止まる
 *
 * 動画の詳細（/v2/videos/[id]）を開くと VideoDetailPlayer が VIDEO_PLAYER_STOP_EVENT を出すので、
 * 盤と詳細で二重に鳴ることはない。
 */

export function V2VideoPlayer() {
  const [video, setVideo] = useState<PersistentVideoTrack | null>(null);
  const [message, setMessage] = useState("");
  /* 視聴画面に戻るために閉じたとき（×ではなく）だけ、位置を視聴画面へ渡す。 */
  const handingBack = useRef(false);

  const close = useCallback(() => { setVideo(null); setMessage(""); }, []);

  useEffect(() => {
    const play = (event: Event) => {
      const next = (event as CustomEvent<PersistentVideoTrack>).detail;
      if (!next?.id) return;
      handingBack.current = false;
      setMessage("");
      setVideo(next);
      try {
        rememberVideo(window.localStorage, next.id);
      } catch {
        /* 覚えられなくても再生はする */
      }
    };
    const stop = () => { handingBack.current = true; close(); };
    window.addEventListener(VIDEO_PLAYER_PLAY_EVENT, play);
    window.addEventListener(VIDEO_PLAYER_STOP_EVENT, stop);
    return () => {
      window.removeEventListener(VIDEO_PLAYER_PLAY_EVENT, play);
      window.removeEventListener(VIDEO_PLAYER_STOP_EVENT, stop);
    };
  }, [close]);

  const recordStarted = useCallback(() => {
    if (!video || video.provider === "hub") return;
    setMessage("");
    void fetch(`/api/videos/${encodeURIComponent(video.id)}/view`, { method: "POST", credentials: "same-origin" }).catch(() => undefined);
  }, [video]);

  /*
   * 渡す関数は**毎回同じ物**にする。無名の関数を渡すと、描画のたびに別物と見なされ、
   * CrossProviderVideoPlayer が YouTube のプレーヤーを作り直す（destroy が iframe を
   * DOM から外すので、絵が消えたまま戻らない）。画面を移ると必ず起きた（2026-09-03）。
   */
  const onEnded = useCallback(() => setMessage("再生が終わりました。"), []);
  const onAutoplayBlocked = useCallback(() => setMessage("プレーヤーの中の再生ボタンを押してください。"), []);
  const onPlaybackError = useCallback(() => setMessage("埋め込みで再生できません。配信元で確かめてください。"), []);
  const videoId = video?.id ?? "";
  const onLeave = useCallback((seconds: number) => {
    if (handingBack.current) rememberHandoffPosition(videoId, seconds);
    handingBack.current = false;
  }, [videoId]);
  /* 畳んだ行から戻すとき、Hub動画はそのまま続ける。埋め込みは中の再生ボタンで続ける。 */
  const resume = useCallback(() => {
    void document.querySelector<HTMLVideoElement>(".v2-player--video .native-video__element")?.play().catch(() => undefined);
  }, []);

  if (!video) return null;
  const vertical = isVerticalVideo(video);
  const hub = video.provider === "hub";

  return (
    <V2PlayerFrame
      kind="video"
      title={video.title}
      subtitle={video.channel}
      closeLabel="動画を止めて閉じる"
      className="v2-player--video"
      onClose={close}
      resume={hub ? resume : undefined}
    >
      {/* 絵。ここに何も重ねない（配信元の規約）。 */}
      <div className={vertical ? "v2-player__stage v2-player__stage--tall" : "v2-player__stage"}>
        {hub ? (
          <NativeVideoPlayer key={video.id} videoId={video.id} title={video.title} owner={PLAYER_OWNER.video} autoplay compact onLeave={onLeave} />
        ) : (
          <CrossProviderVideoPlayer
            key={`${video.id}:${video.provider}`}
            authenticated={video.authenticated}
            video={video}
            autoplay
            requireMostlyVisible={false}
            playbackOwner={PLAYER_OWNER.video}
            onStarted={recordStarted}
            onEnded={onEnded}
            onAutoplayBlocked={onAutoplayBlocked}
            onPlaybackError={onPlaybackError}
          />
        )}
      </div>

      <p className="v2-player__source">
        <b className="v2-player__origin">{hub ? "Hub動画" : video.provider === "youtube" ? "YouTube" : video.channel}</b>
        <Link href={`/v2/videos/${encodeURIComponent(video.id)}`} prefetch={false}>動画のページへ</Link>
      </p>

      {message ? <p className="v2-player__error" role="status">{message}</p> : null}
    </V2PlayerFrame>
  );
}
