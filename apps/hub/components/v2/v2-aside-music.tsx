"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Icon } from "@/components/v2/v2-icons";
import { V2Skeleton } from "@/components/v2/v2-skeleton";
import { isHubOriginalWork, musicDisplayTitle, type MusicWork } from "@/lib/music-catalog";
import {
  MUSIC_PLAYER_NEXT_EVENT,
  MUSIC_PLAYER_PREVIOUS_EVENT,
  MUSIC_PLAYER_PROGRESS_EVENT,
  MUSIC_PLAYER_STATE_EVENT,
  MUSIC_PLAYER_STATE_REQUEST_EVENT,
  MUSIC_PLAYER_TOGGLE_EVENT,
  playPersistentMusic,
  type PersistentMusicPlayerState,
  type PersistentMusicProgress,
  type PersistentMusicTrack,
} from "@/lib/music-player-events";
import { musicOriginLabel, playableTrack } from "@/lib/v2-music";

/*
 * 右列の「音楽」タブ。音を鳴らすのは根のレイアウトにある常駐プレーヤー（V2MusicPlayer）で、
 * ここは指図（lib/music-player-events.ts）を出して状態を読むだけの操作盤。
 * だからタブを切り替えても、列を畳んでも、画面を移っても再生は途切れない。
 *   - Hub のオリジナルを先に並べ、YouTube Music は不足を埋める分だけ「YouTube Music」の札付きで出す
 *   - YouTube は同意の確認をプレーヤー側が持つ（押すまで読み込まない）。ここでは何も読み込まない
 *   - 購入の操作は置かない
 */

export const ASIDE_MUSIC_ORIGINALS = 8;
export const ASIDE_MUSIC_EXTERNAL = 4;

const EMPTY_STATE: PersistentMusicPlayerState = { track: null, playing: false, volume: 80, queue: [] };

/* オリジナルを先に、足りない分だけ YouTube Music を。どちらも再生できるものだけ。 */
export function selectAsideMusicWorks(works: readonly MusicWork[]): MusicWork[] {
  const playable = works.filter((work) => playableTrack(work, false) !== null);
  const originals = playable.filter((work) => isHubOriginalWork(work)).slice(0, ASIDE_MUSIC_ORIGINALS);
  const externals = playable.filter((work) => !isHubOriginalWork(work)).slice(0, ASIDE_MUSIC_EXTERNAL);
  return [...originals, ...externals];
}

/* 続きの曲。いまの曲より後ろだけ。 */
export function upcomingTracks(state: PersistentMusicPlayerState, limit = 5): PersistentMusicTrack[] {
  const at = state.queue.findIndex((item) => item.id === state.track?.id);
  return (at >= 0 ? state.queue.slice(at + 1) : state.queue).slice(0, limit);
}

export function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

let catalogue: { at: number; works: MusicWork[] } | null = null;
const CATALOGUE_MS = 5 * 60 * 1000;

/** テスト用。端末内の一覧の記憶を捨てる。 */
export function resetAsideMusicCatalogue() { catalogue = null; }

function useCatalogue() {
  const [works, setWorks] = useState<MusicWork[] | null>(catalogue && Date.now() - catalogue.at < CATALOGUE_MS ? catalogue.works : null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (works && attempt === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/music?limit=40", { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { works?: MusicWork[] };
        if (cancelled) return;
        catalogue = { at: Date.now(), works: payload.works ?? [] };
        setWorks(catalogue.works);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);
  return { works, failed, retry: () => { setFailed(false); setAttempt((value) => value + 1); } };
}

function usePlayerState() {
  const [state, setState] = useState<PersistentMusicPlayerState>(EMPTY_STATE);
  const [progress, setProgress] = useState<PersistentMusicProgress | null>(null);
  useEffect(() => {
    const onState = (event: Event) => setState((event as CustomEvent<PersistentMusicPlayerState>).detail ?? EMPTY_STATE);
    const onProgress = (event: Event) => setProgress((event as CustomEvent<PersistentMusicProgress>).detail ?? null);
    window.addEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
    window.addEventListener(MUSIC_PLAYER_PROGRESS_EVENT, onProgress);
    window.dispatchEvent(new Event(MUSIC_PLAYER_STATE_REQUEST_EVENT));
    return () => {
      window.removeEventListener(MUSIC_PLAYER_STATE_EVENT, onState);
      window.removeEventListener(MUSIC_PLAYER_PROGRESS_EVENT, onProgress);
    };
  }, []);
  const current = state.track && progress?.trackId === state.track.id ? progress : null;
  return { state, progress: current };
}

export function AsideMusic({ japanese }: { japanese: boolean }) {
  const { state, progress } = usePlayerState();
  const { works, failed, retry } = useCatalogue();
  const list = useMemo(() => selectAsideMusicWorks(works ?? []), [works]);
  const next = upcomingTracks(state);
  const track = state.track;
  const send = (name: string) => window.dispatchEvent(new Event(name));
  const ratio = progress ? Math.min(1, Math.max(0, progress.position / progress.duration)) : 0;

  return (
    <div className="v2-aside-music">
      <section className="v2-now" aria-label={japanese ? "再生中" : "Now playing"}>
        {track ? (
          <>
            <div className="v2-now__art" aria-hidden="true">
              {track.artworkUrl ? <img src={track.artworkUrl} alt="" width={64} height={64} loading="lazy" decoding="async" /> : <V2Icon name="play" />}
            </div>
            <div className="v2-now__body">
              <p className="v2-now__title">{musicDisplayTitle(track.title)}</p>
              <p className="v2-now__artist">{track.artist}{track.provider !== "hub" ? " · YouTube Music" : ""}</p>
            </div>
            <div className="v2-now__controls">
              <V2Button icon="chevron-left" label={japanese ? "前の曲" : "Previous"} onClick={() => send(MUSIC_PLAYER_PREVIOUS_EVENT)} />
              <V2Button icon={state.playing ? "pause" : "play"} label={state.playing ? (japanese ? "一時停止" : "Pause") : (japanese ? "再生" : "Play")} onClick={() => send(MUSIC_PLAYER_TOGGLE_EVENT)} />
              <V2Button icon="chevron-right" label={japanese ? "次の曲" : "Next"} onClick={() => send(MUSIC_PLAYER_NEXT_EVENT)} />
            </div>
            <div className="v2-now__progress" role="progressbar" aria-label={japanese ? "再生位置" : "Playback position"}
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
              <span style={{ width: `${ratio * 100}%` }} />
            </div>
            <p className="v2-now__time" aria-hidden="true">
              <span>{formatClock(progress?.position ?? 0)}</span>
              <span>{progress ? formatClock(progress.duration) : "--:--"}</span>
            </p>
          </>
        ) : (
          <p className="v2-note v2-now__empty">{japanese ? "曲を選ぶと、ここに再生中の曲が出ます。画面を移っても鳴り続けます。" : "Pick a track to see it here. Playback continues as you browse."}</p>
        )}
      </section>

      {next.length ? (
        <section aria-label={japanese ? "続きの曲" : "Up next"}>
          <h3 className="v2-aside__heading">{japanese ? "続きの曲" : "Up next"}</h3>
          <ol className="v2-aside__list">
            {next.map((item) => (
              <li key={item.id}>
                <button type="button" className="v2-aside__item v2-aside__item--button" onClick={() => playPersistentMusic({ ...item, autoplay: true })}>
                  <span className="v2-aside__item-name">{musicDisplayTitle(item.title)}</span>
                  <span className="v2-aside__item-body">{item.artist}{item.provider !== "hub" ? " · YouTube Music" : ""}</span>
                </button>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-label={"Hub Music"}>
        <h3 className="v2-aside__heading">{list.some((work) => isHubOriginalWork(work)) ? ("Hub Music") : (japanese ? "曲" : "Music")}</h3>
        {!works && !failed ? <V2Skeleton kind="lines" count={4} japanese={japanese} /> : null}
        {failed ? (
          <p className="v2-error" role="alert">
            {japanese ? "読み込めませんでした。" : "Could not load."}{" "}
            <button type="button" className="v2-card__link" onClick={retry}>{japanese ? "再試行" : "Retry"}</button>
          </p>
        ) : null}
        {works && !list.length ? <p className="v2-note">{japanese ? "まだありません。" : "Nothing yet."}</p> : null}
        {list.length ? (
          <ul className="v2-aside__list">
            {list.map((work) => {
              const origin = musicOriginLabel(work, japanese);
              const play = () => {
                const item = playableTrack(work, true);
                if (item) playPersistentMusic(item);
              };
              const text = <><span className="v2-aside__item-name">{musicDisplayTitle(work.title)}</span><span className="v2-aside__item-body">{work.artist}{origin.kind === "external" ? ` · ${origin.text}` : ""}</span></>;
              return (
                <li key={work.id}>
                  <div className="v2-aside__item v2-aside__item--row">
                    <button type="button" className="v2-aside__item-text" onClick={play}>{text}</button>
                    <V2Button icon="play" label={japanese ? `${musicDisplayTitle(work.title)} を再生` : `Play ${musicDisplayTitle(work.title)}`} onClick={play} />
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
        <p className="v2-aside__more"><Link href="/v2/music">{japanese ? "音楽をすべて見る" : "All music"}</Link></p>
      </section>
    </div>
  );
}
