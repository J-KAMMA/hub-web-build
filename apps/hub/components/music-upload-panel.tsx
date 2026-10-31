"use client";

import { settingsSectionHref } from "@/lib/settings-section-href";
import { useHubUiSurface } from "@/lib/use-hub-ui-surface";

import React, { ChangeEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { playPersistentMusic } from "@/lib/music-player-events";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";
import { V2State } from "@/components/v2/v2-state";
import { V2ContentLicense } from "@/components/v2/v2-content-license";
import { V2ContentLicensePicker } from "@/components/v2/v2-content-license-picker";
import { normalizeTagList } from "@jkamma/content-tags";
import { V2ContentDownloadSetting } from "@/components/v2/v2-content-download";
import { V2TagInput } from "@/components/v2/v2-tag-input";
import { suggestedContentDownloadPolicy, type ContentDownloadPolicy } from "@/lib/content-download-policy";
import { isContentLicenseId, type ContentLicenseId } from "@/lib/content-license";

type UploadRecord = {
  id: string;
  title: string;
  artist: string;
  description: string;
  album: string;
  credits: string;
  lyrics: string;
  artworkUrl: string;
  artworkScanStatus?: "none" | "pending" | "clean" | "rejected";
  byteSize: number;
  publicationStatus: "draft" | "published";
  scanStatus: "pending" | "clean" | "rejected";
  createdAt: string;
  scannedAt?: string | null;
  publishedAt?: string | null;
  durationSeconds?: number | null;
  scanReason?: string | null;
  qualityJson?: string | null;
  scheduledPublishAt?: string | null;
  unpublishedAt?: string | null;
  versionNumber?: number;
  license?: string;
  downloadPolicy?: string;
  tags?: string[];
};

export type PublicTrack = {
  id: string;
  title: string;
  artist: string;
  description: string;
  album?: string;
  credits?: string;
  lyrics?: string;
  artworkUrl?: string;
  byteSize?: number;
  publishedAt: string;
  license?: string;
};

/* 楽曲のライセンス。公開前に選び、保存すると Music の license 欄に入る。既定は全権利留保。 */
function MusicLicenseForm({ item, locked, onSave }: { item: UploadRecord; locked: boolean; onSave: (license: ContentLicenseId) => void }) {
  const saved: ContentLicenseId = isContentLicenseId(item.license) ? item.license : "arr";
  const [value, setValue] = useState<ContentLicenseId>(saved);
  return <details className="music-upload-edit"><summary>ライセンス</summary>
    <form onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
      <V2ContentLicensePicker value={value} onChange={setValue} disabled={locked} editing />
      <button type="submit" disabled={locked || value === saved}>ライセンスを保存</button>
    </form>
  </details>;
}

/* 楽曲のダウンロード許可（2026-10-17）。Music には購入もゲートも無いので「させない」「誰でも」の2つ。CCなら「誰でも」を勧める。 */
/* タグ欄。FormData の "tags" に空白区切りで載る（PATCH の形は従来どおり）。候補は Hub と Music Worker から。 */
function MusicTagField({ initial }: { initial: string[] }) {
  const [tags, setTags] = useState<string[]>(() => normalizeTagList(initial).map((tag) => tag.display));
  return <V2TagInput name="tags" value={tags} onChange={setTags} sources={["hub", "music"]} />;
}

function MusicDownloadForm({ item, locked, onSave }: { item: UploadRecord; locked: boolean; onSave: (policy: ContentDownloadPolicy) => void }) {
  const saved: ContentDownloadPolicy = item.downloadPolicy === "anyone" ? "anyone" : "none";
  const [value, setValue] = useState<ContentDownloadPolicy>(saved === "none" ? suggestedContentDownloadPolicy(item.license) : saved);
  return <details className="music-upload-edit"><summary>ダウンロード</summary>
    <form onSubmit={(event) => { event.preventDefault(); onSave(value); }}>
      <V2ContentDownloadSetting value={value} onChange={setValue} license={item.license} target="music" disabled={locked} />
      <button type="submit" disabled={locked || value === saved}>ダウンロードの設定を保存</button>
    </form>
  </details>;
}

type PublicTrackCatalogState =
  | { status: "loading"; tracks: PublicTrack[] }
  | { status: "ready"; tracks: PublicTrack[] }
  | { status: "empty"; tracks: [] }
  | { status: "error"; tracks: PublicTrack[] };

type ApiError = { error?: string };
type CreatorUsage = { uploadCount: number; totalBytes: number; publishedCount: number; pendingCount: number; maxUploads: number; maxBytes: number; storagePlan: "free" | "premium"; baseBytes: number; addonBytes: number; canUpgrade: boolean; canPurchaseAdditional: boolean };
type AccountStorage = { plan: "free" | "premium"; usedBytes: number; limitBytes: number; addonBytes: number; canUpgrade: boolean; trackingReady: boolean };
type TrackMetric = { metricDay: string; playStarts: number; completions: number; favorites: number; playlistAdds: number };
type TrackReport = { id: string; reason: string; details: string; status: string; createdAt: string };
type CreatorNotification = { id: string; uploadId?: string | null; type: string; message: string; createdAt: string; readAt?: string | null };

const MUSIC_API = "/music/api";
const MUSIC_CATALOG_TIMEOUT_MS = 10_000;
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MULTIPART_THRESHOLD_BYTES = 16 * 1024 * 1024;
export const TRACKS_CHANGED_EVENT = "music:tracks-changed";
export const PLAY_ORIGINAL_EVENT = "music:play-original";
export const STOP_ORIGINAL_EVENT = "music:stop-original";
const ACCEPTED_AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/flac"]);
const DRAFT_KEY = "music.upload.draft";

function encodedHeader(value: string) {
  return encodeURIComponent(value.trim());
}

async function fileSha256(file: File) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function audioDuration(file: File) {
  return new Promise<number>((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = () => { const value = audio.duration; URL.revokeObjectURL(url); Number.isFinite(value) && value > 0 ? resolve(value) : reject(new Error("音源の再生時間を確認できませんでした。")); };
    audio.onerror = () => { URL.revokeObjectURL(url); reject(new Error("音源ファイルを読み込めませんでした。")); };
    audio.src = url;
  });
}

function recordOriginalEvent(trackId: string, type: "play_start" | "complete" | "favorite" | "playlist_add") {
  void fetch(`${MUSIC_API}/tracks/${encodeURIComponent(trackId)}/events`, {
    method: "POST", credentials: "same-origin", keepalive: true,
    headers: { "content-type": "application/json" }, body: JSON.stringify({ type }),
  }).catch(() => undefined);
}

function statusLabel(upload: UploadRecord) {
  if (upload.publicationStatus === "published") return "公開中";
  if (upload.scanStatus === "clean") return "検査済み・公開待ち";
  if (upload.scanStatus === "rejected") return "検査で拒否";
  return "隔離検査中";
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  return `${(value / 1024 / 1024).toFixed(value >= 10 * 1024 * 1024 ? 1 : 2)} MB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatQuality(value: string) {
  try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
}

function formatPlaybackTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const minutes = Math.floor(value / 60);
  return `${minutes}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
}

function isPublicTrack(value: unknown): value is PublicTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<PublicTrack>;
  return typeof track.id === "string"
    && Boolean(track.id)
    && typeof track.title === "string"
    && typeof track.artist === "string"
    && typeof track.description === "string"
    && typeof track.publishedAt === "string";
}

function uploadErrorMessage(error: string | undefined, status: number) {
  if (error === "unauthenticated" || status === 401) return "Account認証を確認できませんでした。もう一度ログインしてください。";
  if (error === "creator_quota_exceeded" || status === 429) return "アップロード上限に達しました。不要な下書きを削除してください。";
  if (error === "duplicate_upload" || status === 409) return "同じ音源はすでにアップロードされています。";
  if (error === "content_hash_required" || error === "invalid_duration") return "音源の検証情報を作成できませんでした。ファイルを選び直してください。";
  if (error === "upload_too_large" || status === 413) return "音源ファイルは100MB以内にしてください。";
  if (error === "unsupported_media_type" || status === 415) return "MP3・M4A・WAV・FLAC形式の音源を選択してください。";
  if (error === "rights_attestation_required") return "音源を公開する権利の確認が必要です。";
  if (error === "scanner_unavailable" || status === 503) return "安全検査を開始できませんでした。時間をおいてもう一度お試しください。";
  return "アップロードを完了できませんでした。";
}

async function getMusicAssertion() {
  const requestAssertion = () => fetch("/account/api/v1/assertions/music", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
  let response = await requestAssertion();
  let result = await response.json().catch(() => ({})) as { assertion?: string; error?: string };
  if (response.status === 403 && result.error === "music_link_required") {
    const link = await fetch("/account/api/v1/links/music", { method: "POST", credentials: "same-origin", headers: { accept: "application/json" } });
    if (!link.ok) {
      const detail = await link.json().catch(() => ({})) as ApiError;
      throw new Error(detail.error === "recent_authentication_required" ? "Musicを連携するにはAccountへ再ログインしてください。" : "MusicをAccountに連携できませんでした。");
    }
    response = await requestAssertion();
    result = await response.json().catch(() => ({})) as { assertion?: string; error?: string };
  }
  if (!response.ok || !result.assertion) throw new Error(response.status === 401 ? "音楽をアップロードするにはAccountへのログインが必要です。" : "Music用の認証を取得できませんでした。");
  return result.assertion;
}

function uploadAudio(
  file: File,
  headers: Record<string, string>,
  onProgress: (progress: number) => void,
  onRequest: (request: XMLHttpRequest | null) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    onRequest(request);
    request.open("POST", `${MUSIC_API}/uploads`);
    request.withCredentials = true;
    request.responseType = "json";
    Object.entries(headers).forEach(([name, value]) => request.setRequestHeader(name, value));
    request.upload.addEventListener("progress", (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    });
    request.addEventListener("load", () => {
      onRequest(null);
      const result = request.response && typeof request.response === "object" ? request.response as ApiError : {};
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }
      reject(new Error(uploadErrorMessage(result.error, request.status)));
    });
    request.addEventListener("error", () => {
      onRequest(null);
      reject(new Error("Musicサービスへ接続できませんでした。"));
    });
    request.addEventListener("abort", () => {
      onRequest(null);
      reject(new Error("アップロードを中止しました。"));
    });
    request.send(file);
  });
}

async function uploadAudioMultipart(
  file: File,
  metadata: Record<string, unknown>,
  onProgress: (progress: number) => void,
) {
  const assertion = await getMusicAssertion();
  const create = await fetch(`${MUSIC_API}/multipart`, {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` },
    body: JSON.stringify(metadata),
  });
  const created = await create.json().catch(() => ({})) as { session?: { id: string; partSize: number; partCount: number }; error?: string };
  if (!create.ok || !created.session) {
    if (created.error === "multipart_unavailable") throw new Error("multipart_unavailable");
    throw new Error(uploadErrorMessage(created.error, create.status));
  }
  const { id, partSize, partCount } = created.session;
  try {
    for (let index = 0; index < partCount; index += 1) {
      const part = file.slice(index * partSize, Math.min(file.size, (index + 1) * partSize), file.type);
      const partAssertion = await getMusicAssertion();
      const response = await fetch(`${MUSIC_API}/multipart/${encodeURIComponent(id)}/parts/${index + 1}`, {
        method: "PUT", credentials: "same-origin", body: part,
        headers: { "content-type": "application/octet-stream", authorization: `Bearer ${partAssertion}` },
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({})) as ApiError;
        throw new Error(uploadErrorMessage(detail.error, response.status));
      }
      onProgress(Math.min(99, Math.round(((index + 1) / partCount) * 95)));
    }
    const completeAssertion = await getMusicAssertion();
    const complete = await fetch(`${MUSIC_API}/multipart/${encodeURIComponent(id)}/complete`, {
      method: "POST", credentials: "same-origin", headers: { authorization: `Bearer ${completeAssertion}` },
    });
    if (!complete.ok) {
      const detail = await complete.json().catch(() => ({})) as ApiError;
      throw new Error(uploadErrorMessage(detail.error, complete.status));
    }
    onProgress(100);
  } catch (error) {
    void getMusicAssertion().then((token) => fetch(`${MUSIC_API}/multipart/${encodeURIComponent(id)}`, {
      method: "DELETE", credentials: "same-origin", headers: { authorization: `Bearer ${token}` },
    })).catch(() => undefined);
    throw error;
  }
}

export function MusicOriginalTracks({
  delegatePlayback = false,
  emptyStateVisible = false,
  externalActive = false,
  favoriteBusy = false,
  onEnded,
  onNext,
  onPrevious,
  onSelectTrack,
  onToggleSaved,
  onTracksLoaded,
  query = "",
  savedTrackIds = [],
  selectedTrackId = "",
}: {
  delegatePlayback?: boolean;
  emptyStateVisible?: boolean;
  externalActive?: boolean;
  favoriteBusy?: boolean;
  onEnded?: () => void;
  onNext?: () => void;
  onPrevious?: () => void;
  onSelectTrack?: (trackId: string) => void;
  onToggleSaved?: (trackId: string) => void;
  onTracksLoaded?: (tracks: PublicTrack[]) => void;
  query?: string;
  savedTrackIds?: string[];
  selectedTrackId?: string;
} = {}) {
  const [catalogState, setCatalogState] = useState<PublicTrackCatalogState>({
    status: "loading",
    tracks: [],
  });
  const [activeTrackId, setActiveTrackId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [playerMessage, setPlayerMessage] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackLoadSequenceRef = useRef(0);
  const activeTrackLoadRef = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);
  const tracks = catalogState.tracks;
  const activeIndex = tracks.findIndex((track) => track.id === activeTrackId);
  const activeTrack = activeIndex >= 0 ? tracks[activeIndex] : tracks[0];
  const normalizedQuery = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  const visibleTracks = normalizedQuery
    ? tracks.filter((track) => [track.title, track.artist, track.album, track.description]
      .some((value) => value?.normalize("NFKC").toLocaleLowerCase("ja").includes(normalizedQuery)))
    : tracks;

  const loadTracks = useCallback(async () => {
    activeTrackLoadRef.current?.controller.abort();
    const requestId = trackLoadSequenceRef.current + 1;
    trackLoadSequenceRef.current = requestId;
    const controller = new AbortController();
    activeTrackLoadRef.current = { id: requestId, controller };
    const ownsRequest = () => activeTrackLoadRef.current?.id === requestId;
    setCatalogState((current) => ({
      status: "loading",
      tracks: current.tracks,
    }));
    try {
      const response = await fetch(`${MUSIC_API}/tracks`, {
        credentials: "same-origin",
        headers: { accept: "application/json" },
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(MUSIC_CATALOG_TIMEOUT_MS),
        ]),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const result = await response.json() as unknown;
      if (
        !result
        || typeof result !== "object"
        || !Array.isArray((result as { tracks?: unknown }).tracks)
        || !(result as { tracks: unknown[] }).tracks.every(isPublicTrack)
      ) {
        throw new Error("invalid_music_catalog");
      }
      if (!ownsRequest()) return;
      const next = [...new Map(
        (result as { tracks: PublicTrack[] }).tracks.map((track) => [
          track.id,
          track,
        ]),
      ).values()];
      setCatalogState(next.length
        ? { status: "ready", tracks: next }
        : { status: "empty", tracks: [] });
      onTracksLoaded?.(next);
      setActiveTrackId((current) =>
        next.some((track) => track.id === current)
          ? current
          : next[0]?.id ?? "");
    } catch (error: unknown) {
      if (!ownsRequest()) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      setCatalogState((current) => ({
        status: "error",
        tracks: current.tracks,
      }));
    } finally {
      if (ownsRequest()) activeTrackLoadRef.current = null;
    }
  }, [onTracksLoaded]);

  useEffect(() => {
    const reload = () => { void loadTracks(); };
    const playRequestedTrack = (event: Event) => {
      const trackId = (event as CustomEvent<{ trackId?: string }>).detail?.trackId;
      if (!trackId) return;
      setActiveTrackId(trackId);
      setPlaying(true);
    };
    const stopRequestedTrack = () => {
      audioRef.current?.pause();
      setPlaying(false);
    };
    reload();
    window.addEventListener(TRACKS_CHANGED_EVENT, reload);
    window.addEventListener(PLAY_ORIGINAL_EVENT, playRequestedTrack);
    window.addEventListener(STOP_ORIGINAL_EVENT, stopRequestedTrack);
    return () => {
      activeTrackLoadRef.current?.controller.abort();
      activeTrackLoadRef.current = null;
      window.removeEventListener(TRACKS_CHANGED_EVENT, reload);
      window.removeEventListener(PLAY_ORIGINAL_EVENT, playRequestedTrack);
      window.removeEventListener(STOP_ORIGINAL_EVENT, stopRequestedTrack);
    };
  }, [loadTracks]);

  useEffect(() => {
    const normalizedTrackId = selectedTrackId.startsWith("music:")
      ? selectedTrackId.slice("music:".length)
      : selectedTrackId;
    if (
      normalizedTrackId
      && tracks.some((track) => track.id === normalizedTrackId)
    ) {
      setActiveTrackId(normalizedTrackId);
    }
  }, [selectedTrackId, tracks]);

  useEffect(() => {
    if (!externalActive) return;
    audioRef.current?.pause();
    setPlaying(false);
  }, [externalActive]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeTrack) return;
    setCurrentTime(0);
    setDuration(0);
    if (!playing) return;
    void audio.play().then(() => setPlayerMessage("")).catch(() => {
      setPlaying(false);
      setPlayerMessage("ブラウザが自動再生を止めました。再生ボタンを押してください。");
    });
  }, [activeTrack?.id, playing]);

  useEffect(() => {
    if (!activeTrack || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: activeTrack.title,
      artist: activeTrack.artist,
      album: "Hub Music",
    });
    navigator.mediaSession.setActionHandler("play", () => setPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      setActiveTrackId(tracks[Math.max(0, activeIndex - 1)]?.id ?? activeTrack.id);
      setPlaying(true);
    });
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      setActiveTrackId(tracks[Math.min(tracks.length - 1, activeIndex + 1)]?.id ?? activeTrack.id);
      setPlaying(true);
    });
    return () => {
      navigator.mediaSession.setActionHandler("play", null);
      navigator.mediaSession.setActionHandler("pause", null);
      navigator.mediaSession.setActionHandler("previoustrack", null);
      navigator.mediaSession.setActionHandler("nexttrack", null);
    };
  }, [activeIndex, activeTrack, tracks]);

  const chooseTrack = (trackId: string) => {
    onSelectTrack?.(trackId);
    if (delegatePlayback) return;
    if (trackId === activeTrack?.id) {
      setPlaying((current) => !current);
      return;
    }
    setActiveTrackId(trackId);
    setPlaying(true);
  };

  const previousTrack = () => {
    if (onPrevious) {
      onPrevious();
      return;
    }
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }
    const previous = tracks[Math.max(0, activeIndex - 1)];
    if (previous) setActiveTrackId(previous.id);
    setPlaying(true);
  };

  const nextTrack = () => {
    if (onNext) {
      onNext();
      return;
    }
    const next = tracks[activeIndex + 1];
    if (!next) {
      setPlaying(false);
      setPlayerMessage("再生キューの最後まで再生しました。");
      return;
    }
    setActiveTrackId(next.id);
    setPlaying(true);
  };

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
      setPlaying(false);
      return;
    }
    setPlaying(true);
  };

  if (catalogState.status === "loading" && !tracks.length) {
    return <section className="music-originals" aria-labelledby="music-originals-title">
      <header><h2 id="music-originals-title">曲</h2></header>
      <V2State kind="loading" className="music-original-empty" rows={3} title="公開中の曲を読み込んでいます" />
    </section>;
  }
  if (catalogState.status === "error" && !tracks.length) {
    return <section className="music-originals" aria-labelledby="music-originals-title">
      <header><h2 id="music-originals-title">曲</h2></header>
      <V2State kind="error" className="music-original-empty" title="公開中の曲を読み込めませんでした" note="通信状態を確認して、もう一度お試しください。" action={{ label: "再試行", onClick: () => void loadTracks() }} />
    </section>;
  }
  if (!tracks.length) return <section className="music-originals" aria-labelledby="music-originals-title" hidden={!emptyStateVisible}>
    <header><h2 id="music-originals-title">曲</h2><span>0曲</span></header>
    <p className="music-original-empty">公開中の曲はありません。</p>
  </section>;
  return <section className="music-originals" aria-labelledby="music-originals-title">
    <header><h2 id="music-originals-title">曲</h2><span>{tracks.length}曲</span></header>
    {catalogState.status === "loading"
      ? <p className="music-original-empty" role="status">曲一覧を更新しています…</p>
      : null}
    {catalogState.status === "error"
      ? <UiStatePanel
        className="music-original-empty"
        state="error"
        title="曲一覧を更新できませんでした"
        description="表示中の曲はそのまま再生できます。"
        action={<UiButton type="button" onClick={() => void loadTracks()}>再試行</UiButton>}
      />
      : null}
    <div className="music-original-player">
      <div className="music-original-now">
        <span aria-hidden="true">{playing ? "♫" : "♪"}</span>
        <div><small>NOW PLAYING</small><strong>{activeTrack.title}</strong><b>{activeTrack.artist}</b></div>
      </div>
      <audio
        ref={audioRef}
        preload="metadata"
        src={`${MUSIC_API}/tracks/${encodeURIComponent(activeTrack.id)}/audio`}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration)}
        onDurationChange={(event) => setDuration(event.currentTarget.duration)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => { setPlaying(true); recordOriginalEvent(activeTrack.id, "play_start"); }}
        onPause={() => setPlaying(false)}
        onEnded={() => { recordOriginalEvent(activeTrack.id, "complete"); (onEnded ?? nextTrack)(); }}
        onError={() => { setPlaying(false); setPlayerMessage("音源を読み込めませんでした。時間をおいて再試行してください。"); }}
      />
      <div className="music-original-timeline">
        <span>{formatPlaybackTime(currentTime)}</span>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          aria-label="再生位置"
          onChange={(event) => {
            const nextTime = Number(event.currentTarget.value);
            if (audioRef.current) audioRef.current.currentTime = nextTime;
            setCurrentTime(nextTime);
          }}
        />
        <span>{formatPlaybackTime(duration)}</span>
      </div>
      <div className="music-original-controls">
        <button type="button" onClick={previousTrack} aria-label="前の曲">‹</button>
        <button type="button" className="is-primary" onClick={togglePlayback} aria-label={playing ? "一時停止" : "再生"}>{playing ? "Ⅱ" : "▶"}</button>
        <button type="button" onClick={nextTrack} aria-label="次の曲">›</button>
        <label><span>音量</span><input type="range" min={0} max={1} step={0.05} value={volume} onChange={(event) => setVolume(Number(event.currentTarget.value))} /></label>
      </div>
      {playerMessage ? <p role="status">{playerMessage}</p> : null}
      <V2ContentLicense license={isContentLicenseId(activeTrack.license) ? activeTrack.license : "arr"} authorName={activeTrack.artist} japanese />
    </div>
    {visibleTracks.length ? <ol className="music-original-queue">{visibleTracks.map((track, index) => <li key={track.id} className={track.id === activeTrack.id ? "is-active" : ""}>
      <button type="button" onClick={() => chooseTrack(track.id)} aria-pressed={track.id === activeTrack.id && playing}>
        <span>{track.id === activeTrack.id && playing ? "▶" : String(index + 1).padStart(2, "0")}</span>
        <strong>{track.title}</strong>
        <small>{track.artist}{track.byteSize ? ` · ${formatBytes(track.byteSize)}` : ""}</small>
        <span className="music-track-play-label">{track.id === activeTrack.id && playing ? "一時停止" : "▶ 再生"}</span>
      </button>
      {onToggleSaved ? <button type="button" className="music-original-save" disabled={favoriteBusy} aria-busy={favoriteBusy || undefined} onClick={() => onToggleSaved(track.id)} aria-label={savedTrackIds.includes(track.id) ? `${track.title}のお気に入りを解除` : `${track.title}をお気に入りに追加`} aria-pressed={savedTrackIds.includes(track.id)}>{savedTrackIds.includes(track.id) ? "♥" : "♡"}</button> : null}
    </li>)}</ol> : <p className="music-original-empty">検索条件に一致する曲はありません。</p>}
    <details className="music-original-report"><summary>この曲を報告</summary><form onSubmit={(event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      void fetch(`${MUSIC_API}/tracks/${encodeURIComponent(activeTrack.id)}/reports`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: String(data.get("reason") ?? ""), details: String(data.get("details") ?? "") }) })
        .then((response) => { if (!response.ok) throw new Error(); form.reset(); setPlayerMessage("報告を受け付けました。"); })
        .catch(() => setPlayerMessage("報告を送信できませんでした。"));
    }}><label><span>理由</span><select name="reason" required><option value="">選択</option><option value="権利侵害">権利侵害</option><option value="不適切な内容">不適切な内容</option><option value="誤情報">作品情報の誤り</option><option value="その他">その他</option></select></label><label><span>詳細</span><textarea name="details" maxLength={1000} /></label><button type="submit">報告する</button></form></details>
  </section>;
}

export function MusicUploadPanel({ inline = false }: { inline?: boolean } = {}) {
  /* 読み手が居る面。v2 から描かれたら容量の節も v2 へ（2026-09-05）。 */
  const surface = useHubUiSurface();
  const [authenticated, setAuthenticated] = useState(false);
  const [sessionChecking, setSessionChecking] = useState(true);
  const [uploads, setUploads] = useState<UploadRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [usage, setUsage] = useState<CreatorUsage | null>(null);
  const [accountStorage, setAccountStorage] = useState<AccountStorage | null>(null);
  const [metrics, setMetrics] = useState<Record<string, TrackMetric[]>>({});
  const [reports, setReports] = useState<Record<string, TrackReport[]>>({});
  const [notifications, setNotifications] = useState<CreatorNotification[]>([]);
  const uploadRequestRef = useRef<XMLHttpRequest | null>(null);
  const uploadFormRef = useRef<HTMLFormElement | null>(null);

  const refreshUploads = useCallback(async () => {
    const assertion = await getMusicAssertion();
    const headers = { accept: "application/json", authorization: `Bearer ${assertion}` };
    const [response, summaryResponse, storageResponse] = await Promise.all([
      fetch(`${MUSIC_API}/uploads`, { credentials: "same-origin", headers }),
      Promise.resolve(fetch(`${MUSIC_API}/creator/summary`, { credentials: "same-origin", headers })).catch(() => null),
      Promise.resolve(fetch("/account/api/v1/storage", { credentials: "same-origin", headers: { accept: "application/json" } })).catch(() => null),
    ]);
    if (!response.ok) throw new Error(response.status === 401 ? "音楽アップロードセッションが切れました。" : "アップロード一覧を取得できませんでした。");
    const result = await response.json() as { uploads?: UploadRecord[] };
    setUploads(result.uploads ?? []);
    if (summaryResponse?.ok) setUsage((await summaryResponse.json() as { usage: CreatorUsage }).usage);
    if (storageResponse?.ok) {
      const storage = await storageResponse.json() as AccountStorage;
      setAccountStorage(storage.trackingReady ? storage : null);
    }
  }, []);

  const clearSelectedFile = useCallback(() => {
    setSelectedFile(null);
    setPreviewUrl((current) => {
      if (current) URL.revokeObjectURL(current);
      return "";
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void refreshUploads()
      .then(async () => {
        if (cancelled) return;
        setAuthenticated(true);
      })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Account認証を確認できませんでした。"); })
      .finally(() => { if (!cancelled) setSessionChecking(false); });
    return () => { cancelled = true; };
  }, [refreshUploads]);

  useEffect(() => {
    if (!authenticated || !uploads.some((upload) => upload.scanStatus === "pending")) return;
    const timer = window.setInterval(() => {
      void refreshUploads().catch((error) => {
        if (error instanceof Error && error.message.includes("セッション")) setAuthenticated(false);
      });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [authenticated, refreshUploads, uploads]);

  useEffect(() => () => {
    uploadRequestRef.current?.abort();
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  useEffect(() => {
    const form = uploadFormRef.current;
    if (!authenticated || !form) return;
    try {
      const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Record<string, string>;
      for (const [key, value] of Object.entries(saved)) {
        const field = form.elements.namedItem(key);
        if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) field.value = value;
      }
    } catch { /* Ignore an invalid local draft. */ }
  }, [authenticated]);

  const saveDraft = (form: HTMLFormElement) => {
    const data = new FormData(form);
    const draft = Object.fromEntries(["title", "artist", "album", "artworkUrl", "description", "credits", "lyrics"].map((key) => [key, String(data.get(key) ?? "")]));
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  };

  const connectAccount = async () => {
    setBusy(true);
    setMessage("");
    try {
      await refreshUploads();
      setAuthenticated(true);
      setMessage("AccountとMusicを安全に連携しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Musicサービスへ接続できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0] ?? null;
    clearSelectedFile();
    if (!file) return;
    setSelectedFile(file);
    if (ACCEPTED_AUDIO_TYPES.has(file.type)) setPreviewUrl(URL.createObjectURL(file));
  };

  const upload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get("audio");
    if (!(file instanceof File) || file.size === 0) {
      setMessage("音源ファイルを選択してください。");
      setBusy(false);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES || !ACCEPTED_AUDIO_TYPES.has(file.type)) {
      setMessage("MP3・M4A・WAV・FLACの音源を100MB以内で選択してください。");
      setBusy(false);
      return;
    }
    setUploadProgress(0);
    try {
      const [contentHash, durationSeconds] = await Promise.all([fileSha256(file), audioDuration(file)]);
      const metadata = {
        title: String(data.get("title") ?? "").trim(), artist: String(data.get("artist") ?? "").trim(),
        description: String(data.get("description") ?? "").trim(), album: String(data.get("album") ?? "").trim(),
        credits: String(data.get("credits") ?? "").trim(), lyrics: String(data.get("lyrics") ?? "").trim(),
        artworkUrl: String(data.get("artworkUrl") ?? "").trim(), mediaType: file.type, byteSize: file.size,
        contentHash, durationSeconds, rightsAttested: true,
      };
      if (file.size >= MULTIPART_THRESHOLD_BYTES) {
        try {
          await uploadAudioMultipart(file, metadata, setUploadProgress);
        } catch (error) {
          if (!(error instanceof Error) || error.message !== "multipart_unavailable") throw error;
          const assertion = await getMusicAssertion();
          await uploadAudio(file, {
            authorization: `Bearer ${assertion}`, "content-type": file.type,
            "x-music-title": encodedHeader(metadata.title as string), "x-music-artist": encodedHeader(metadata.artist as string),
            "x-music-description": encodedHeader(metadata.description as string), "x-music-album": encodedHeader(metadata.album as string),
            "x-music-credits": encodedHeader(metadata.credits as string), "x-music-lyrics": encodedHeader(metadata.lyrics as string),
            "x-music-artwork-url": encodedHeader(metadata.artworkUrl as string), "x-music-rights-attested": "true",
            "x-music-sha256": contentHash, "x-music-duration-seconds": String(durationSeconds),
          }, setUploadProgress, (request) => { uploadRequestRef.current = request; });
        }
      } else {
        const assertion = await getMusicAssertion();
        await uploadAudio(file, {
        authorization: `Bearer ${assertion}`,
        "content-type": file.type,
        "x-music-title": encodedHeader(String(data.get("title") ?? "")),
        "x-music-artist": encodedHeader(String(data.get("artist") ?? "")),
        "x-music-description": encodedHeader(String(data.get("description") ?? "")),
        "x-music-album": encodedHeader(String(data.get("album") ?? "")),
        "x-music-credits": encodedHeader(String(data.get("credits") ?? "")),
        "x-music-lyrics": encodedHeader(String(data.get("lyrics") ?? "")),
        "x-music-artwork-url": encodedHeader(String(data.get("artworkUrl") ?? "")),
        "x-music-rights-attested": "true",
        "x-music-sha256": contentHash,
        "x-music-duration-seconds": String(durationSeconds),
        }, setUploadProgress, (request) => { uploadRequestRef.current = request; });
      }
      form.reset();
      localStorage.removeItem(DRAFT_KEY);
      clearSelectedFile();
      await refreshUploads();
      setMessage("音源を隔離領域へ送信しました。安全検査が終わると公開ボタンが有効になります。");
    } catch (error) {
      const detail = error instanceof Error ? error.message : "アップロードに失敗しました。";
      if (detail.includes("セッション")) setAuthenticated(false);
      setMessage(detail);
    } finally {
      uploadRequestRef.current = null;
      setUploadProgress(null);
      setBusy(false);
    }
  };

  const mutateUpload = async (uploadId: string, action: "publish" | "unpublish" | "delete") => {
    setBusy(true);
    setMessage("");
    try {
      const assertion = await getMusicAssertion();
      const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}${action === "publish" ? "/publish" : action === "unpublish" ? "/unpublish" : ""}`, {
        method: action === "delete" ? "DELETE" : "POST",
        credentials: "same-origin",
        headers: { authorization: `Bearer ${assertion}` },
      });
      const result = response.ok ? {} : await response.json() as ApiError;
      if (!response.ok) throw new Error(result.error === "track_not_clean" || result.error === "scan_not_clean" ? "安全検査が完了するまで公開できません。" : "操作を完了できませんでした。");
      await refreshUploads();
      if (action !== "delete") window.dispatchEvent(new Event(TRACKS_CHANGED_EVENT));
      setMessage(action === "publish" ? "楽曲を公開しました。" : action === "unpublish" ? "楽曲を非公開にしました。" : "音源を削除しました。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Musicサービスへ接続できませんでした。");
    } finally {
      setBusy(false);
    }
  };

  const saveLicense = async (uploadId: string, license: ContentLicenseId) => {
    setBusy(true); setMessage("");
    try {
      const assertion = await getMusicAssertion();
      const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}/license`, { method: "PUT", credentials: "same-origin",
        headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` }, body: JSON.stringify({ license }) });
      if (!response.ok) throw new Error("ライセンスを保存できませんでした。");
      await refreshUploads(); window.dispatchEvent(new Event(TRACKS_CHANGED_EVENT)); setMessage("ライセンスを保存しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "ライセンスを保存できませんでした。"); }
    finally { setBusy(false); }
  };

  const saveDownloadPolicy = async (uploadId: string, downloadPolicy: ContentDownloadPolicy) => {
    setBusy(true); setMessage("");
    try {
      const assertion = await getMusicAssertion();
      const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}/download-policy`, { method: "PUT", credentials: "same-origin",
        headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` }, body: JSON.stringify({ downloadPolicy }) });
      if (!response.ok) throw new Error("ダウンロードの設定を保存できませんでした。");
      await refreshUploads(); setMessage("ダウンロードの設定を保存しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "ダウンロードの設定を保存できませんでした。"); }
    finally { setBusy(false); }
  };

  const updateMetadata = async (event: FormEvent<HTMLFormElement>, uploadId: string) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const data = new FormData(event.currentTarget);
    const payload: Record<string, string> = Object.fromEntries(["title", "artist", "description", "album", "credits", "lyrics", "artworkUrl"].map((key) => [key, String(data.get(key) ?? "")]));
    payload.tags = String(data.get("tags") ?? "");
    try {
      const assertion = await getMusicAssertion();
      const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}`, { method: "PATCH", credentials: "same-origin",
        headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` }, body: JSON.stringify(payload) });
      const result = response.ok ? {} : await response.json() as ApiError;
      if (!response.ok) throw new Error(result.error === "invalid_artwork_url" ? "ジャケット画像URLはhttps://で入力してください。" : result.error === "invalid_tags" ? "タグの形式が正しくありません。" : "作品情報を更新できませんでした。");
      await refreshUploads(); window.dispatchEvent(new Event(TRACKS_CHANGED_EVENT)); setMessage("作品情報を保存しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "作品情報を更新できませんでした。"); }
    finally { setBusy(false); }
  };

  const uploadArtwork = async (event: ChangeEvent<HTMLInputElement>, uploadId: string) => {
    const input = event.currentTarget;
    const file = input.files?.[0]; if (!file) return;
    setBusy(true); setMessage("");
    try {
      const assertion = await getMusicAssertion();
      const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}/artwork`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": file.type, "content-length": String(file.size), authorization: `Bearer ${assertion}` }, body: file });
      const result = response.ok ? {} : await response.json() as ApiError;
      if (!response.ok) throw new Error(result.error === "artwork_too_large" ? "ジャケット画像は10MB以内にしてください。" : "ジャケット画像を送信できませんでした。");
      await refreshUploads(); setMessage("ジャケット画像を隔離領域へ送り、安全検査を開始しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "ジャケット画像を送信できませんでした。"); }
    finally { input.value = ""; setBusy(false); }
  };

  const loadMetrics = async (uploadId: string) => {
    const assertion = await getMusicAssertion();
    const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}/stats`, { credentials: "same-origin", headers: { authorization: `Bearer ${assertion}` } });
    if (!response.ok) throw new Error("統計を取得できませんでした。");
    const result = await response.json() as { metrics?: TrackMetric[] };
    setMetrics((current) => ({ ...current, [uploadId]: result.metrics ?? [] }));
  };

  const loadReports = async (uploadId: string) => {
    const assertion = await getMusicAssertion();
    const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}/reports`, { credentials: "same-origin", headers: { authorization: `Bearer ${assertion}` } });
    if (!response.ok) throw new Error("通報を取得できませんでした。");
    const result = await response.json() as { reports?: TrackReport[] };
    setReports((current) => ({ ...current, [uploadId]: result.reports ?? [] }));
  };

  const schedulePublish = async (event: FormEvent<HTMLFormElement>, uploadId: string) => {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const assertion = await getMusicAssertion();
      const publishAt = String(new FormData(event.currentTarget).get("publishAt") ?? "");
      const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}/schedule`, { method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` }, body: JSON.stringify({ publishAt: new Date(publishAt).toISOString() }) });
      if (!response.ok) throw new Error("公開日時を設定できませんでした。5分後から1年以内を指定してください。");
      await refreshUploads(); setMessage("公開予約を設定しました。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "公開予約を設定できませんでした。"); } finally { setBusy(false); }
  };

  const loadNotifications = async () => {
    const assertion = await getMusicAssertion();
    const response = await fetch(`${MUSIC_API}/creator/notifications`, { credentials: "same-origin", headers: { authorization: `Bearer ${assertion}` } });
    if (!response.ok) throw new Error("通知を取得できませんでした。");
    setNotifications(((await response.json()) as { notifications?: CreatorNotification[] }).notifications ?? []);
  };

  const resolveReport = async (uploadId: string, reportId: string, status: "reviewed" | "actioned" | "dismissed") => {
    const assertion = await getMusicAssertion();
    const response = await fetch(`${MUSIC_API}/uploads/${encodeURIComponent(uploadId)}/reports`, { method: "PATCH", credentials: "same-origin",
      headers: { "content-type": "application/json", authorization: `Bearer ${assertion}` }, body: JSON.stringify({ reportId, status }) });
    if (!response.ok) throw new Error("通報状態を更新できませんでした。");
    await loadReports(uploadId);
  };

  const logout = async () => {
    setBusy(true);
    try {
      await fetch("/account/api/v1/links/music", { method: "DELETE", credentials: "same-origin" });
    } finally {
      clearSelectedFile();
      setAuthenticated(false);
      setUploads([]);
      setBusy(false);
      setMessage("");
    }
  };

  const locked = busy || uploadProgress !== null;
  const needsSignIn = /ログイン/.test(message);

  return <details id="music-upload-panel" className={inline ? "music-upload music-add-panel music-add-panel--inline" : "music-upload music-add-panel music-add-modal"} open={inline ? true : undefined} onClick={inline ? undefined : (event) => { if (event.target === event.currentTarget) event.currentTarget.open = false; }} onKeyDown={inline ? undefined : (event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
    <summary>
      <div><small>音源ファイル</small><h2>音楽としてアップロード</h2><span>自分が権利を持つ音源をMusic専用サービスへ登録</span></div>
      <b aria-hidden="true">＋</b>
    </summary>
    <div className="music-add-panel__body">
    {sessionChecking ? <p className="music-upload-checking" role="status">Account認証を確認しています…</p> : !authenticated ? <div className="music-upload-login">
      <div><b>{message && !needsSignIn ? "Musicに接続できません" : "Accountでログイン"}</b></div>
      <button type="button" onClick={() => void connectAccount()} disabled={busy}>{busy ? "確認中…" : message && !needsSignIn ? "再試行" : "Accountで続ける"}</button>
    </div> : <>
      {usage ? <div className="music-upload-usage" role="status"><b>{(accountStorage?.plan ?? usage.storagePlan) === "premium" ? "プレミアム共通ストレージ" : "無料共通ストレージ"} · {usage.uploadCount}/{usage.maxUploads}曲</b><span>{formatBytes(accountStorage?.usedBytes ?? usage.totalBytes)} / {formatBytes(accountStorage?.limitBytes ?? usage.maxBytes)}{(accountStorage?.addonBytes ?? usage.addonBytes) > 0 ? `（追加 ${formatBytes(accountStorage?.addonBytes ?? usage.addonBytes)}）` : ""}</span><progress max={accountStorage?.limitBytes ?? usage.maxBytes} value={accountStorage?.usedBytes ?? usage.totalBytes} /><small>画像・音楽・動画・Vaultで共有</small><span><a href={settingsSectionHref(surface, "storage")}>{(accountStorage?.canUpgrade ?? usage.canUpgrade) ? "容量プランを確認" : "プランを確認"}</a></span></div> : null}
      <details className="music-upload-edit" onToggle={(event) => { if (event.currentTarget.open) void loadNotifications().catch((error) => setMessage(error instanceof Error ? error.message : "通知を取得できませんでした。")); }}><summary>Music通知</summary>
        {notifications.length ? <ul>{notifications.map((notice) => <li key={notice.id}><b>{notice.message}</b><small>{formatDate(notice.createdAt)}</small></li>)}</ul> : <p>新しい通知はありません。</p>}
      </details>
      <form ref={uploadFormRef} className="music-upload-form" onSubmit={upload} onInput={(event) => saveDraft(event.currentTarget)}>
        <label><span>曲名</span><input name="title" required maxLength={120} disabled={locked} /></label>
        <label><span>アーティスト名</span><input name="artist" required maxLength={120} disabled={locked} /></label>
        <label><span>アルバム・シングル名</span><input name="album" maxLength={160} disabled={locked} /></label>
        <label><span>ジャケット画像URL</span><input name="artworkUrl" type="url" inputMode="url" placeholder="https://…" maxLength={1000} disabled={locked} /></label>
        <label className="music-upload-description"><span>説明</span><textarea name="description" maxLength={1000} disabled={locked} /></label>
        <label className="music-upload-description"><span>クレジット</span><textarea name="credits" maxLength={2000} disabled={locked} /></label>
        <label className="music-upload-description"><span>歌詞（任意）</span><textarea name="lyrics" maxLength={12000} disabled={locked} /></label>
        <label className="music-upload-file"><span>音源ファイル</span><input name="audio" type="file" accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/flac,.mp3,.m4a,.wav,.flac" required disabled={locked} onChange={chooseFile} /><small>MP3・M4A・WAV・FLAC、最大100MB</small></label>
        {selectedFile ? <div className="music-upload-preview">
          <div><strong>{selectedFile.name}</strong><span>{formatBytes(selectedFile.size)}</span></div>
          {previewUrl ? <audio controls preload="metadata" src={previewUrl} aria-label={`${selectedFile.name}の送信前プレビュー`} /> : null}
        </div> : null}
        <label className="music-upload-rights"><input name="rights" type="checkbox" required disabled={locked} /><span>この音源を公開する権利を持ち、第三者の権利を侵害していないことを確認します。</span></label>
        {uploadProgress !== null ? <div className="music-upload-progress" role="status" aria-live="polite">
          <progress max={100} value={uploadProgress} />
          <b>{uploadProgress < 100 ? `アップロード ${uploadProgress}%` : "隔離領域へ保存中…"}</b>
        </div> : null}
        <div className="music-upload-actions">
          <button type="submit" disabled={locked}>{uploadProgress !== null ? "送信中…" : "隔離領域へアップロード"}</button>
          {uploadProgress !== null ? <button type="button" className="is-danger" onClick={() => uploadRequestRef.current?.abort()}>中止</button> : null}
          <button type="button" className="is-secondary" onClick={logout} disabled={locked}>Music連携を解除</button>
        </div>
      </form>
      {uploads.length ? <div className="music-upload-list">
        <header><h3>アップロードした音楽</h3><button type="button" className="is-secondary" onClick={() => void refreshUploads().catch((error) => setMessage(error instanceof Error ? error.message : "更新できませんでした。"))} disabled={locked}>状態を更新</button></header>
        {uploads.map((item) => <article key={item.id}>
          <div><strong>{item.title}</strong><span>{item.artist} · {formatBytes(item.byteSize)} · {formatDate(item.createdAt)}</span></div><b data-status={item.scanStatus} data-publication={item.publicationStatus}>{statusLabel(item)}</b>
          <div>
            {item.publicationStatus === "published" ? <button type="button" className="is-secondary" onClick={() => playPersistentMusic({
              id: `music:${item.id}`,
              title: item.title,
              artist: item.artist,
              provider: "hub",
              providerLabel: "Hub Music",
              audioUrl: `${MUSIC_API}/tracks/${encodeURIComponent(item.id)}/audio`,
              autoplay: true,
            })}>プレイヤーで再生</button> : null}
            {item.publicationStatus === "published" ? <button type="button" className="is-secondary" onClick={() => mutateUpload(item.id, "unpublish")} disabled={locked}>非公開にする</button> : null}
            {item.scanStatus === "clean" && item.publicationStatus !== "published" ? <button type="button" onClick={() => mutateUpload(item.id, "publish")} disabled={locked}>公開する</button> : null}
            {item.publicationStatus !== "published" ? <button type="button" className="is-danger" onClick={() => mutateUpload(item.id, "delete")} disabled={locked}>削除</button> : null}
          </div>
          {item.scanStatus === "clean" && item.publicationStatus !== "published" ? <form className="music-upload-schedule" onSubmit={(event) => schedulePublish(event, item.id)}><label><span>公開予約</span><input name="publishAt" type="datetime-local" required disabled={locked} /></label><button type="submit" disabled={locked}>予約する</button>{item.scheduledPublishAt ? <small>予約：{formatDate(item.scheduledPublishAt)}</small> : null}</form> : null}
          <MusicLicenseForm key={`${item.id}:${item.license ?? "arr"}`} item={item} locked={locked} onSave={(license) => void saveLicense(item.id, license)} />
          <MusicDownloadForm key={`${item.id}:dl:${item.downloadPolicy ?? "none"}`} item={item} locked={locked} onSave={(policy) => void saveDownloadPolicy(item.id, policy)} />
          {item.qualityJson ? <details className="music-upload-edit"><summary>音源品質</summary><pre>{formatQuality(item.qualityJson)}</pre></details> : null}
          <details className="music-upload-edit"><summary>作品情報を編集</summary><form onSubmit={(event) => updateMetadata(event, item.id)}>
            <label><span>曲名</span><input name="title" defaultValue={item.title} required maxLength={120} /></label>
            <label><span>アーティスト</span><input name="artist" defaultValue={item.artist} required maxLength={120} /></label>
            <label><span>アルバム・シングル</span><input name="album" defaultValue={item.album} maxLength={160} /></label>
            <label><span>ジャケット画像URL</span><input name="artworkUrl" type="url" defaultValue={item.artworkUrl} maxLength={1000} /></label>
            <label><span>説明</span><textarea name="description" defaultValue={item.description} maxLength={1000} /></label>
            <label><span>クレジット</span><textarea name="credits" defaultValue={item.credits} maxLength={2000} /></label>
            <MusicTagField initial={item.tags ?? []} />
            <label><span>歌詞</span><textarea name="lyrics" defaultValue={item.lyrics} maxLength={12000} /></label>
            <button type="submit" disabled={locked}>下書きを保存</button>
          </form></details>
          {item.publicationStatus === "published" ? <details className="music-upload-edit" onToggle={(event) => { if (event.currentTarget.open && !metrics[item.id]) void loadMetrics(item.id).catch((error) => setMessage(error instanceof Error ? error.message : "統計を取得できませんでした。")); }}><summary>再生統計</summary>
            {metrics[item.id]?.length ? <ul>{metrics[item.id].map((metric) => <li key={metric.metricDay}>{metric.metricDay}：再生 {metric.playStarts}／完聴 {metric.completions}／お気に入り {metric.favorites}／プレイリスト {metric.playlistAdds}</li>)}</ul> : <p>集計データはまだありません。</p>}
          </details> : null}
          {item.publicationStatus === "published" ? <details className="music-upload-edit" onToggle={(event) => { if (event.currentTarget.open && !reports[item.id]) void loadReports(item.id).catch((error) => setMessage(error instanceof Error ? error.message : "通報を取得できませんでした。")); }}><summary>通報管理</summary>
            {reports[item.id]?.length ? <ul>{reports[item.id].map((report) => <li key={report.id}><b>{report.reason}</b><span>{report.details}</span><small>{report.status}・{formatDate(report.createdAt)}</small>{report.status === "open" ? <div><button type="button" onClick={() => void resolveReport(item.id, report.id, "reviewed")}>確認済み</button><button type="button" onClick={() => void resolveReport(item.id, report.id, "actioned")}>対応済み</button><button type="button" onClick={() => void resolveReport(item.id, report.id, "dismissed")}>却下</button></div> : null}</li>)}</ul> : <p>通報はありません。</p>}
          </details> : null}
          <label className="music-upload-artwork"><span>ジャケット画像（JPEG・PNG・WebP、10MBまで）</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={(event) => void uploadArtwork(event, item.id)} /><small>{item.artworkScanStatus === "clean" ? "検査済み" : item.artworkScanStatus === "pending" ? "検査中" : item.artworkScanStatus === "rejected" ? "不合格" : "未登録"}</small></label>
        </article>)}
      </div> : <p className="music-upload-none">アップロードした音楽はまだありません。</p>}
    </>}
    {message && (authenticated || sessionChecking) ? <p className="music-upload-message" role="status">{message}</p> : null}
      <footer>音源は隔離・安全検査後に公開できます。</footer>
    </div>
  </details>;
}
