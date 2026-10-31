"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { PLAYER_OWNER, V2PlayerFrame } from "@/components/v2/v2-player-shell";
import { claimPlayback, onPlaybackClaimed } from "@/lib/media-playback";
import { checkYouTubeEmbedVisible } from "@/lib/youtube-embed-visibility";
import { V2Icon } from "@/components/v2/v2-icons";
import { useYouTubeEmbedPermission, YouTubeEmbedConsentPrompt } from "@/components/youtube-embed-consent";
import {
  MUSIC_PLAYER_ENDED_EVENT,
  MUSIC_PLAYER_ENQUEUE_NEXT_EVENT,
  MUSIC_PLAYER_NEXT_EVENT,
  MUSIC_PLAYER_PAUSE_EVENT,
  MUSIC_PLAYER_PLAY_EVENT,
  MUSIC_PLAYER_PREVIOUS_EVENT,
  MUSIC_PLAYER_PROGRESS_EVENT,
  MUSIC_PLAYER_QUEUE_EVENT,
  MUSIC_PLAYER_RESUME_EVENT,
  MUSIC_PLAYER_STATE_EVENT,
  MUSIC_PLAYER_STATE_REQUEST_EVENT,
  MUSIC_PLAYER_STOP_EVENT,
  MUSIC_PLAYER_TOGGLE_EVENT,
  MUSIC_PLAYER_VOLUME_EVENT,
  playPersistentMusic,
  type PersistentMusicPlayerState,
  type PersistentMusicProgress,
  type PersistentMusicQueue,
  type PersistentMusicTrack,
} from "@/lib/music-player-events";
import { loadYouTubeApi, youtubeEmbedSrc, youtubeVideoId, youtubeWatchUrl, type YouTubePlayer } from "@/lib/youtube-iframe-api";

/*
 * v2 の音楽プレーヤー（2026-09-03、旦那様「音楽再生のuiつくってyoutubeの規約守りながら」）。
 * 画面の右下に居座り、画面を移っても鳴り続ける（根のレイアウトに置くので消えない）。
 *
 * **YouTube の規約で形が決まる**（lib/youtube-iframe-api.ts に全文の要約）。
 *   - 公式の埋め込みプレーヤーだけ。音声の取り出しも保存もしない
 *   - 絵は 356×200（200×200以上）で**常に見えている**。畳むときは**止める**
 *   - プレーヤーの上に操作も文字も**重ねない**。操作は絵の下、待ち行列はさらに下
 *   - 出所（YouTube）と、**YouTube で見る**の道を必ず出す
 *   - 自動再生は「利用者が再生を押した」ときだけ。ページを離れて隠れたら止める
 * Hub に置いた音（provider: "hub"）にはこの縛りが無いので、絵は出さず細い帯にする。
 *
 * 再生の指図は既存と同じ道（lib/music-player-events.ts）。棚や一覧はそのまま使える。
 */

type RepeatMode = "off" | "all" | "one";

/* 再生位置の指定（Hub の音だけ。YouTube は読むだけ）。player 内だけで使う。 */
const MUSIC_PLAYER_SEEK_EVENT = "music:player-seek";

const VOLUME_KEY = "music.player.volume";
const REPEAT_KEY = "music.player.repeat";

function playerClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/* 再生位置。読むだけ（YouTube の規約上、絵の上には置かず、操作の行の上に出す）。 */
function V2PlayerProgress({ trackId, seekable }: { trackId: string; seekable: boolean }) {
  const [progress, setProgress] = useState<PersistentMusicProgress | null>(null);
  useEffect(() => {
    setProgress(null);
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<PersistentMusicProgress>).detail;
      if (detail?.trackId === trackId) setProgress(detail);
    };
    window.addEventListener(MUSIC_PLAYER_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(MUSIC_PLAYER_PROGRESS_EVENT, onProgress);
  }, [trackId]);
  if (!progress || !(progress.duration > 0)) return null;
  const ratio = Math.min(1, Math.max(0, progress.position / progress.duration));
  if (seekable) {
    return (
      <div className="v2-player__progress">
        <input
          type="range"
          className="v2-player__seek"
          aria-label="再生位置"
          min={0}
          max={Math.floor(progress.duration)}
          step={1}
          value={Math.floor(progress.position)}
          aria-valuetext={`${playerClock(progress.position)} / ${playerClock(progress.duration)}`}
          onChange={(event) => {
            const position = Number(event.currentTarget.value);
            setProgress({ ...progress, position });
            window.dispatchEvent(new CustomEvent<number>(MUSIC_PLAYER_SEEK_EVENT, { detail: position }));
          }}
        />
        <p aria-hidden="true"><span>{playerClock(progress.position)}</span><span>{playerClock(progress.duration)}</span></p>
      </div>
    );
  }
  return (
    <div className="v2-player__progress">
      <div role="progressbar" aria-label="再生位置" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
        <span style={{ width: `${ratio * 100}%` }} />
      </div>
      <p aria-hidden="true"><span>{playerClock(progress.position)}</span><span>{playerClock(progress.duration)}</span></p>
    </div>
  );
}

export function V2MusicPlayer() {
  const [track, setTrack] = useState<PersistentMusicTrack | null>(null);
  const [queue, setQueue] = useState<PersistentMusicTrack[]>([]);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(80);
  const [repeat, setRepeat] = useState<RepeatMode>("all");
  const [queueOpen, setQueueOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const trackRef = useRef<PersistentMusicTrack | null>(null);
  const queueRef = useRef<PersistentMusicTrack[]>([]);
  const repeatRef = useRef<RepeatMode>("all");
  trackRef.current = track;
  queueRef.current = queue;
  repeatRef.current = repeat;

  /* 覚えている音量と繰り返し。読めない端末では既定のまま。 */
  useEffect(() => {
    try {
      const storedVolume = Number(window.localStorage.getItem(VOLUME_KEY));
      if (Number.isFinite(storedVolume) && storedVolume >= 0 && storedVolume <= 100) setVolume(storedVolume);
      const storedRepeat = window.localStorage.getItem(REPEAT_KEY);
      if (storedRepeat === "off" || storedRepeat === "all" || storedRepeat === "one") setRepeat(storedRepeat);
    } catch {
      /* 読めなければ既定 */
    }
  }, []);

  /* 鳴らすのは1つだけ。鳴り始めたら名乗り、ほかが名乗ったら止める（lib/media-playback.ts）。 */
  useEffect(() => { if (playing) claimPlayback(PLAYER_OWNER.music); }, [playing, track?.id]);
  useEffect(() => onPlaybackClaimed(PLAYER_OWNER.music, () => window.dispatchEvent(new Event(MUSIC_PLAYER_PAUSE_EVENT))), []);
  const resume = useCallback(() => window.dispatchEvent(new Event(MUSIC_PLAYER_RESUME_EVENT)), []);
  const close = useCallback(() => { setTrack(null); setPlaying(false); setQueueOpen(false); }, []);

  /* いま何を鳴らしているかを知らせる。棚や一覧の「再生中」の印はこれを見ている。 */
  useEffect(() => {
    const announce = () => window.dispatchEvent(new CustomEvent<PersistentMusicPlayerState>(MUSIC_PLAYER_STATE_EVENT, {
      detail: { track, playing, volume, queue },
    }));
    announce();
    window.addEventListener(MUSIC_PLAYER_STATE_REQUEST_EVENT, announce);
    return () => window.removeEventListener(MUSIC_PLAYER_STATE_REQUEST_EVENT, announce);
  }, [track, playing, volume, queue]);

  /* 再生・停止・待ち行列の指図を受ける。 */
  useEffect(() => {
    const onPlay = (event: Event) => {
      const next = (event as CustomEvent<PersistentMusicTrack>).detail;
      if (!next) return;
      setTrack(next);
      setMessage(null);
      setQueue((current) => current.some((item) => item.id === next.id) ? current : [next, ...current]);
    };
    const onQueue = (event: Event) => {
      const detail = (event as CustomEvent<PersistentMusicQueue>).detail;
      if (!detail) return;
      setQueue(detail.tracks);
    };
    const onEnqueue = (event: Event) => {
      const next = (event as CustomEvent<PersistentMusicTrack>).detail;
      if (!next) return;
      setQueue((current) => {
        const rest = current.filter((item) => item.id !== next.id);
        const at = Math.max(0, rest.findIndex((item) => item.id === trackRef.current?.id));
        return [...rest.slice(0, at + 1), next, ...rest.slice(at + 1)];
      });
    };
    const onStop = () => { setTrack(null); setPlaying(false); setQueueOpen(false); };
    const onVolume = (event: Event) => {
      const next = (event as CustomEvent<number>).detail;
      if (typeof next === "number") setVolume(Math.max(0, Math.min(100, next)));
    };
    window.addEventListener(MUSIC_PLAYER_PLAY_EVENT, onPlay);
    window.addEventListener(MUSIC_PLAYER_QUEUE_EVENT, onQueue);
    window.addEventListener(MUSIC_PLAYER_ENQUEUE_NEXT_EVENT, onEnqueue);
    window.addEventListener(MUSIC_PLAYER_STOP_EVENT, onStop);
    window.addEventListener(MUSIC_PLAYER_VOLUME_EVENT, onVolume);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_PLAY_EVENT, onPlay);
      window.removeEventListener(MUSIC_PLAYER_QUEUE_EVENT, onQueue);
      window.removeEventListener(MUSIC_PLAYER_ENQUEUE_NEXT_EVENT, onEnqueue);
      window.removeEventListener(MUSIC_PLAYER_STOP_EVENT, onStop);
      window.removeEventListener(MUSIC_PLAYER_VOLUME_EVENT, onVolume);
    };
  }, []);

  /* 次・前へ。繰り返しの設定で端の扱いが変わる。 */
  const move = useCallback((direction: 1 | -1, byHand: boolean) => {
    const current = trackRef.current;
    const list = queueRef.current;
    if (!current || !list.length) return;
    if (!byHand && repeatRef.current === "one") {
      playPersistentMusic({ ...current, autoplay: true });
      return;
    }
    const index = list.findIndex((item) => item.id === current.id);
    const proposed = index < 0 ? 0 : index + direction;
    if (repeatRef.current === "off" && (proposed < 0 || proposed >= list.length)) {
      setPlaying(false);
      return;
    }
    const next = list[(proposed + list.length) % list.length];
    if (next) playPersistentMusic({ ...next, autoplay: true });
  }, []);

  useEffect(() => {
    const ended = () => move(1, false);
    const next = () => move(1, true);
    const previous = () => move(-1, true);
    window.addEventListener(MUSIC_PLAYER_ENDED_EVENT, ended);
    window.addEventListener(MUSIC_PLAYER_NEXT_EVENT, next);
    window.addEventListener(MUSIC_PLAYER_PREVIOUS_EVENT, previous);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_ENDED_EVENT, ended);
      window.removeEventListener(MUSIC_PLAYER_NEXT_EVENT, next);
      window.removeEventListener(MUSIC_PLAYER_PREVIOUS_EVENT, previous);
    };
  }, [move]);

  const changeVolume = (next: number) => {
    setVolume(next);
    try {
      window.localStorage.setItem(VOLUME_KEY, String(next));
    } catch {
      /* 覚えられなくても、その場では効く */
    }
  };

  const changeRepeat = () => {
    const next: RepeatMode = repeat === "all" ? "one" : repeat === "one" ? "off" : "all";
    setRepeat(next);
    try {
      window.localStorage.setItem(REPEAT_KEY, next);
    } catch {
      /* 覚えられなくても、その場では効く */
    }
  };

  const skipBroken = useCallback(() => {
    setMessage("この曲を再生できませんでした。次の曲へ移ります。");
    window.setTimeout(() => move(1, true), 900);
  }, [move]);

  const showBlocked = useCallback((hidden: boolean) => {
    setMessage((current) => hidden ? "プレーヤーが見える状態でないため、YouTube を一時停止しました。" : current === "プレーヤーが見える状態でないため、YouTube を一時停止しました。" ? null : current);
  }, []);

  if (!track) return null;

  const youtube = track.provider === "youtube" && Boolean(track.embedUrl);
  const index = queue.findIndex((item) => item.id === track.id);
  const repeatLabel = repeat === "all" ? "繰り返し: 全曲" : repeat === "one" ? "繰り返し: 1曲" : "繰り返し: しない";

  return (
    <V2PlayerFrame
      kind="music"
      title={track.title}
      subtitle={track.artist}
      closeLabel="再生を止めて閉じる"
      onClose={close}
      resume={resume}
    >
      {/*
        * 絵。**ここに何も重ねない。** 操作も文字もこの下に置く（YouTube の規約）。
        * Hub の音には絵が無いので、この枠ごと出さない。
        */}
      {youtube ? (
        <V2YouTubeStage track={track} volume={volume} onPlayingChange={setPlaying} onError={skipBroken} onBlocked={showBlocked} />
      ) : track.audioUrl ? (
        <V2HubAudioStage track={track} volume={volume} onPlayingChange={setPlaying} onError={skipBroken} />
      ) : null}

      <V2PlayerProgress trackId={track.id} seekable={!youtube && Boolean(track.audioUrl)} />

      <div className="v2-player__controls">
        <V2Button icon="chevron-left" label="前の曲" disabled={queue.length < 2} onClick={() => move(-1, true)} />
        <V2Button
          icon={playing ? "pause" : "play"}
          variant="primary"
          label={playing ? "一時停止" : "再生"}
          onClick={() => window.dispatchEvent(new Event(playing ? MUSIC_PLAYER_PAUSE_EVENT : MUSIC_PLAYER_RESUME_EVENT))}
        />
        <V2Button icon="chevron-right" label="次の曲" disabled={queue.length < 2} onClick={() => move(1, true)} />
        <V2Button icon="repeat" label={repeatLabel} pressed={repeat !== "off"} onClick={changeRepeat} />
        <label className="v2-player__volume">
          <span className="v2-sr">音量</span>
          <V2Icon name={volume === 0 ? "volume-off" : "volume"} />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            aria-label="音量"
            onChange={(event) => changeVolume(Number(event.currentTarget.value))}
          />
        </label>
        <V2Button
          icon="list"
          label={queueOpen ? "続きの曲を閉じる" : `続きの曲（${queue.length}）`}
          pressed={queueOpen}
          expanded={queueOpen}
          onClick={() => setQueueOpen((current) => !current)}
        />
      </div>

      {/* 出所と、YouTube へ戻る道。規約で必ず出す。 */}
      <p className="v2-player__source">
        <b className="v2-player__origin">{youtube ? "YouTube Music" : track.providerLabel}</b>
        {youtube ? (
          <a href={youtubeWatchUrl(youtubeVideoId(track.embedUrl))} target="_blank" rel="noopener noreferrer nofollow ugc">YouTubeで見る</a>
        ) : null}
        {track.externalUrl && !youtube ? <a href={track.externalUrl} target="_blank" rel="noopener noreferrer nofollow ugc">配信元で開く</a> : null}
        {repeat === "off" ? null : <span>{repeatLabel}</span>}
      </p>

      {message ? <p className="v2-player__error" role="status">{message}</p> : null}

      {queueOpen ? (
        <ol className="v2-player__queue" aria-label="続きの曲">
          {queue.map((item, position) => (
            <li key={item.id} className={item.id === track.id ? "is-current" : undefined}>
              <button type="button" onClick={() => playPersistentMusic({ ...item, autoplay: true })}>
                <span className="v2-player__queue-no">{position + 1}</span>
                {item.artworkUrl ? <span className="v2-player__queue-art"><img src={item.artworkUrl} alt="" loading="lazy" referrerPolicy="no-referrer" /></span> : null}
                <span className="v2-player__queue-body">
                  <strong>{item.title}</strong>
                  <small>{item.artist}</small>
                </span>
                {item.id === track.id ? <span className="v2-badge">{playing ? "再生中" : "一時停止"}</span> : null}
              </button>
            </li>
          ))}
          {index >= 0 && queue.length > 1 ? null : <li className="v2-player__queue-empty">続きの曲はありません。</li>}
        </ol>
      ) : null}
    </V2PlayerFrame>
  );
}

/*
 * YouTube の場。356×200 の枠に公式プレーヤーを出す。
 * 同意が済むまで iframe を作らない（同意の欄も絵の場所に出す。重ねない）。
 */
function V2YouTubeStage({ track, volume, onPlayingChange, onError, onBlocked }: {
  track: PersistentMusicTrack;
  volume: number;
  onPlayingChange: (playing: boolean) => void;
  onError: () => void;
  onBlocked?: (hidden: boolean) => void;
}) {
  const videoId = youtubeVideoId(track.embedUrl);
  const permission = useYouTubeEmbedPermission(videoId);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const volumeRef = useRef(volume);
  volumeRef.current = volume;

  /* 見えているときだけ再生する。見えない・200×200 未満・覆われているなら、隠して鳴らさず止める。 */
  const playGuarded = () => {
    const player = playerRef.current;
    if (!player) return;
    const state = checkYouTubeEmbedVisible(frameRef.current);
    if (state.visible) { onBlocked?.(false); player.playVideo(); return; }
    player.pauseVideo();
    onPlayingChange(false);
    onBlocked?.(true);
  };
  const playGuardedRef = useRef(playGuarded);
  playGuardedRef.current = playGuarded;

  useEffect(() => {
    if (permission.status !== "allowed") return;
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
            if (track.autoplay !== false) playGuardedRef.current();
          },
          onStateChange: (event) => {
            if (event.data === api.PlayerState.PLAYING) onPlayingChange(true);
            if (event.data === api.PlayerState.PAUSED) onPlayingChange(false);
            if (event.data === api.PlayerState.ENDED) {
              onPlayingChange(false);
              window.dispatchEvent(new CustomEvent<PersistentMusicTrack>(MUSIC_PLAYER_ENDED_EVENT, { detail: track }));
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
  }, [permission.status, track, onPlayingChange, onError]);

  useEffect(() => {
    playerRef.current?.setVolume?.(volume);
  }, [volume]);

  /* 進み具合は1秒ごとに読むだけ（右列の再生カード用）。何も保存しない。 */
  useEffect(() => {
    const timer = window.setInterval(() => {
      const player = playerRef.current;
      if (!player || player.getPlayerState() !== 1) return;
      announceProgress(track.id, player.getCurrentTime?.() ?? 0, player.getDuration?.() ?? 0);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [track.id]);

  useEffect(() => {
    const pause = () => { playerRef.current?.pauseVideo(); onPlayingChange(false); };
    const resume = () => playGuardedRef.current();
    const toggle = () => {
      const player = playerRef.current;
      if (!player) return;
      if (player.getPlayerState() === 1) { player.pauseVideo(); onPlayingChange(false); } else playGuardedRef.current();
    };
    window.addEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
    window.addEventListener(MUSIC_PLAYER_RESUME_EVENT, resume);
    window.addEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
      window.removeEventListener(MUSIC_PLAYER_RESUME_EVENT, resume);
      window.removeEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
    };
  }, [onPlayingChange]);

  /* 再生中に隠れた・縮んだ・覆われたら止める（見張りは0.5秒ごとと、寸法・位置が変わったとき）。 */
  useEffect(() => {
    const guard = () => {
      const player = playerRef.current;
      if (!player || player.getPlayerState() !== 1) return;
      if (checkYouTubeEmbedVisible(frameRef.current).visible) return;
      player.pauseVideo();
      onPlayingChange(false);
      onBlocked?.(true);
    };
    const timer = window.setInterval(guard, 500);
    const frame = frameRef.current;
    const sizes = typeof ResizeObserver === "undefined" || !frame ? null : new ResizeObserver(guard);
    if (frame) sizes?.observe(frame);
    const seen = typeof IntersectionObserver === "undefined" || !frame ? null : new IntersectionObserver(guard, { threshold: [0, 0.5, 1] });
    if (frame) seen?.observe(frame);
    window.addEventListener("resize", guard);
    window.addEventListener("scroll", guard, true);
    return () => {
      window.clearInterval(timer);
      sizes?.disconnect();
      seen?.disconnect();
      window.removeEventListener("resize", guard);
      window.removeEventListener("scroll", guard, true);
    };
  }, [permission.status, onPlayingChange, onBlocked]);

  /* 隠れたら止める。音だけの再生は規約で禁じられている。 */
  useEffect(() => {
    const pauseWhenHidden = () => {
      if (!document.hidden) return;
      playerRef.current?.pauseVideo();
      onPlayingChange(false);
    };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, [onPlayingChange]);

  if (permission.status !== "allowed") {
    return (
      <div className="v2-player__stage v2-player__stage--consent">
        <YouTubeEmbedConsentPrompt
          message={permission.message}
          status={permission.status}
          onAccept={permission.accept}
          sourceUrl={youtubeWatchUrl(videoId)}
        />
      </div>
    );
  }

  return (
    <div className="v2-player__stage">
      <iframe
        key={track.id}
        ref={frameRef}
        className="v2-player__frame"
        src={youtubeEmbedSrc(permission.embedUrl, track.autoplay !== false)}
        title={`${track.title}のYouTubeプレーヤー`}
        width={356}
        height={200}
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        referrerPolicy="strict-origin-when-cross-origin"
      />
    </div>
  );
}

function announceProgress(trackId: string, position: number, duration: number) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0) return;
  window.dispatchEvent(new CustomEvent<PersistentMusicProgress>(MUSIC_PLAYER_PROGRESS_EVENT, { detail: { trackId, position, duration } }));
}

/* Hub に置いた音。YouTube の縛りは無いので、素の audio でよい。 */
function V2HubAudioStage({ track, volume, onPlayingChange, onError }: {
  track: PersistentMusicTrack;
  volume: number;
  onPlayingChange: (playing: boolean) => void;
  onError: () => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (audio) audio.volume = Math.max(0, Math.min(1, volume / 100));
  }, [volume]);

  useEffect(() => {
    const pause = () => audioRef.current?.pause();
    const resume = () => void audioRef.current?.play().catch(() => undefined);
    const toggle = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (audio.paused) void audio.play().catch(() => undefined); else audio.pause();
    };
    window.addEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
    window.addEventListener(MUSIC_PLAYER_RESUME_EVENT, resume);
    const seek = (event: Event) => {
      const position = (event as CustomEvent<number>).detail;
      const audio = audioRef.current;
      if (audio && typeof position === "number" && Number.isFinite(position)) audio.currentTime = position;
    };
    window.addEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
    window.addEventListener(MUSIC_PLAYER_SEEK_EVENT, seek);
    return () => {
      window.removeEventListener(MUSIC_PLAYER_PAUSE_EVENT, pause);
      window.removeEventListener(MUSIC_PLAYER_RESUME_EVENT, resume);
      window.removeEventListener(MUSIC_PLAYER_TOGGLE_EVENT, toggle);
      window.removeEventListener(MUSIC_PLAYER_SEEK_EVENT, seek);
    };
  }, []);

  /* 標準の操作盤は隠し、アプリ側の操作（再生位置・音量）だけを見せる。audio 要素そのものは残す。 */
  return (
    <div className="v2-player__hub">
      <div className="v2-player__cover" aria-hidden="true">{track.artworkUrl ? <img src={track.artworkUrl} alt="" referrerPolicy="no-referrer" /> : <span>♫</span>}</div>
    <audio
      ref={audioRef}
      className="v2-player__audio v2-player__audio-hidden"
      key={track.id}
      src={track.audioUrl}
      autoPlay={track.autoplay !== false}
      onPlay={() => onPlayingChange(true)}
      onPause={() => onPlayingChange(false)}
      onTimeUpdate={(event) => announceProgress(track.id, event.currentTarget.currentTime, event.currentTarget.duration)}
      onEnded={() => {
        onPlayingChange(false);
        window.dispatchEvent(new CustomEvent<PersistentMusicTrack>(MUSIC_PLAYER_ENDED_EVENT, { detail: track }));
      }}
      onError={onError}
    />
    </div>
  );
}
