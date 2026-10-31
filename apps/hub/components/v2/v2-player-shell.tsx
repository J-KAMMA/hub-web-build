"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { V2FloatingPanel } from "@/components/v2/v2-floating-panel";
import { V2Icon } from "@/components/v2/v2-icons";
import { claimPlayback, MEDIA_PLAYBACK_CLAIM_EVENT } from "@/lib/media-playback";
import { MUSIC_PLAYER_PLAY_EVENT } from "@/lib/music-player-events";
import { VIDEO_PLAYER_PLAY_EVENT } from "@/lib/video-player-events";

/*
 * 音楽と Hub動画で共有する1つの小窓（2026-10-18、所有者承認）。
 * 盤（V2FloatingPanel）は1枚だけ。中身は音楽か動画のどちらかを見せ、もう一方は
 * 「一時停止中」の1行に畳む。畳んだ側は、止まっているので隠してよい
 * （YouTube の埋め込みは鳴っている間だけ 200×200 以上で見えていなければならない）。
 * 鳴らすのは1つだけ：片方が始まると、もう片方は lib/media-playback.ts の合図で止まる。
 * 画面を移っても鳴り続けるのは、根のレイアウト（MusicPlayerSurface）に置くから。
 */

export type V2PlayerKind = "music" | "video";

/* 鳴らす場所の名前。lib/media-playback.ts の claimPlayback に渡す。 */
export const PLAYER_OWNER: Record<V2PlayerKind, string> = { music: "music", video: "video-mini" };

type FrameMeta = {
  title: string;
  subtitle?: string;
  closeLabel: string;
  onClose: () => void;
  className?: string;
  /* 畳んだ行の「続きを再生」。無ければ見せるだけ（埋め込みの中の再生ボタンを押す）。 */
  resume?: () => void;
};

type ShellValue = {
  register: (kind: V2PlayerKind, meta: FrameMeta | null) => void;
  slot: (kind: V2PlayerKind) => HTMLElement | null;
};

const ShellContext = createContext<ShellValue | null>(null);

const LABEL: Record<V2PlayerKind, string> = { music: "音楽", video: "動画" };

export function V2PlayerShell({ children }: { children: ReactNode }) {
  const [metas, setMetas] = useState<Partial<Record<V2PlayerKind, FrameMeta>>>({});
  const [active, setActive] = useState<V2PlayerKind>("music");
  const [slots, setSlots] = useState<Partial<Record<V2PlayerKind, HTMLElement | null>>>({});

  const register = useCallback((kind: V2PlayerKind, meta: FrameMeta | null) => {
    setMetas((current) => {
      if (!meta) {
        if (!current[kind]) return current;
        const next = { ...current };
        delete next[kind];
        return next;
      }
      return { ...current, [kind]: meta };
    });
  }, []);

  /* 新しく始めた側を前に出し、もう一方を止める。鳴り始めた側（合図）も前に出す。 */
  useEffect(() => {
    const toMusic = () => { setActive("music"); claimPlayback(PLAYER_OWNER.music); };
    const toVideo = () => { setActive("video"); claimPlayback(PLAYER_OWNER.video); };
    const onClaim = (event: Event) => {
      const owner = (event as CustomEvent<string>).detail;
      if (owner === PLAYER_OWNER.music) setActive("music");
      else if (owner === PLAYER_OWNER.video) setActive("video");
    };
    window.addEventListener(MUSIC_PLAYER_PLAY_EVENT, toMusic);
    window.addEventListener(VIDEO_PLAYER_PLAY_EVENT, toVideo);
    window.addEventListener(MEDIA_PLAYBACK_CLAIM_EVENT, onClaim);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_PLAY_EVENT, toMusic);
      window.removeEventListener(VIDEO_PLAYER_PLAY_EVENT, toVideo);
      window.removeEventListener(MEDIA_PLAYBACK_CLAIM_EVENT, onClaim);
    };
  }, []);

  const value = useMemo<ShellValue>(() => ({ register, slot: (kind) => slots[kind] ?? null }), [register, slots]);
  const musicRef = useCallback((node: HTMLDivElement | null) => setSlots((current) => current.music === node ? current : { ...current, music: node }), []);
  const videoRef = useCallback((node: HTMLDivElement | null) => setSlots((current) => current.video === node ? current : { ...current, video: node }), []);

  /* 前に出す側。登録が片方だけならそちら。 */
  const shown: V2PlayerKind | null = metas[active] ? active : metas.music ? "music" : metas.video ? "video" : null;
  const other: V2PlayerKind | null = shown === "music" && metas.video ? "video" : shown === "video" && metas.music ? "music" : null;
  const meta = shown ? metas[shown] : undefined;

  const bringBack = (kind: V2PlayerKind) => {
    setActive(kind);
    const resume = metas[kind]?.resume;
    /* 見えるようになってから鳴らす（YouTube は見えていないと鳴らさない）。 */
    if (resume) window.requestAnimationFrame(() => window.requestAnimationFrame(resume));
  };

  return (
    <ShellContext.Provider value={value}>
      {children}
      {meta && shown ? (
        <V2FloatingPanel
          label={shown === "music" ? "音楽プレーヤー" : "動画プレーヤー"}
          positionKey="hub.v2.player-position"
          title={meta.title}
          subtitle={meta.subtitle}
          closeLabel={meta.closeLabel}
          className={meta.className}
          onClose={meta.onClose}
        >
          <div ref={musicRef} className="v2-player__slot" hidden={shown !== "music"} />
          <div ref={videoRef} className="v2-player__slot" hidden={shown !== "video"} />
          {other ? (
            <button type="button" className="v2-player__paused" onClick={() => bringBack(other)}>
              <V2Icon name="play" />
              <span className="v2-player__paused-text">
                <small>{LABEL[other]}・一時停止中</small>
                <strong>{metas[other]?.title}</strong>
              </span>
              <span className="v2-player__paused-action">切り替え</span>
            </button>
          ) : null}
        </V2FloatingPanel>
      ) : null}
    </ShellContext.Provider>
  );
}

/*
 * 各プレーヤーの外枠。小窓の中に置かれていれば共有の盤へ差し込み、
 * 置かれていなければ（試験や単独の表示）自分の盤を出す。
 */
export function V2PlayerFrame({ kind, children, ...meta }: FrameMeta & { kind: V2PlayerKind; children: ReactNode }) {
  const shell = useContext(ShellContext);
  const { title, subtitle, closeLabel, onClose, className, resume } = meta;
  useEffect(() => {
    if (!shell) return;
    shell.register(kind, { title, subtitle, closeLabel, onClose, className, resume });
  }, [shell, kind, title, subtitle, closeLabel, onClose, className, resume]);
  useEffect(() => {
    if (!shell) return;
    return () => shell.register(kind, null);
  }, [shell, kind]);
  if (!shell) {
    return (
      <V2FloatingPanel
        label={kind === "music" ? "音楽プレーヤー" : "動画プレーヤー"}
        positionKey={kind === "music" ? "hub.v2.player-position" : "hub.v2.video-position"}
        title={title}
        subtitle={subtitle}
        closeLabel={closeLabel}
        className={className}
        onClose={onClose}
      >
        {children}
      </V2FloatingPanel>
    );
  }
  const target = shell.slot(kind);
  return target ? createPortal(children, target) : null;
}
