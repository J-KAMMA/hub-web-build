/*
 * Browser side of Hub's self-made videos (docs/hub-video/PLAN.md sections 1.6, 3.1, 5).
 *
 * Pure of React so the upload and playback flows can be tested with a fake fetch:
 *
 *   upload   POST /api/videos/native  -> upload ticket
 *            POST {ticket.path}       -> upload secret (the Video Worker, straight from the browser)
 *            PUT  {path}/main/parts/N -> the file in parts, each retried
 *            POST {path}/complete     -> queued for the scan and the encode
 *            GET  /api/videos/native/{id} until ready (Hub reads the Worker's state for us)
 *   publish  POST /api/videos/native/{id}/publish
 *   play     POST /api/videos/native/{id}/play -> play ticket
 *            POST {play.path}         -> HLS playlist with token URLs, valid for about 15 minutes
 *
 * Hub never sees the video bytes, a playback token or the upload secret. Nothing here is stored
 * in the browser.
 */

export type NativeVideoVisibility = "public" | "unlisted" | "followers" | "gated";
export type NativeVideoState = "upload_issued" | "processing" | "ready" | "published" | "unpublished" | "rejected" | "failed" | "deleted";

export type NativeVideo = {
  id: string;
  title: string;
  description: string;
  visibility: NativeVideoVisibility;
  kind: "normal" | "short";
  license: string;
  ageRestricted: boolean;
  commentsEnabled: boolean;
  tags?: string[];
  state: NativeVideoState;
  failure: string | null;
  held: boolean;
  reviewStatus?: "none" | "pending" | "approved" | "rejected";
  source: "desktop" | "web";
  maxHeight: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  shortEligible: boolean;
  storedBytes: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};

export type NativeVideoQuota = {
  planCode: string;
  minutesCap: number;
  minutesUsed: number;
  minutesRemaining: number;
  webMinutesRemaining: number;
  maxMinutesPerVideo: number;
  openUploads: number;
  maxOpenUploads: number;
  maxHeight: number;
};

export class NativeVideoClientError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = "NativeVideoClientError";
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const MESSAGES: Record<string, string> = {
  authentication_required: "ログインが必要です。",
  account_link_required: "動画のアップロードには共通アカウントとの連携が必要です。",
  minutes_cap_reached: "30日間のアップロード時間の上限に達しています。",
  transcode_cap_reached: "変換が必要なアップロードの30日間の上限に達しています。",
  too_many_uploads: "処理中のアップロードが多すぎます。終わるまで待ってください。",
  video_too_long: "動画は60分までです。",
  file_too_large: "ファイルが大きすぎます。",
  storage_quota_exceeded: "保存容量の上限を超えます。",
  videos_unavailable: "動画の機能は準備中です。",
  upload_token_invalid: "アップロードの許可が切れました。最初からやり直してください。",
  upload_expired: "アップロードの許可が切れました。最初からやり直してください。",
  upload_too_large: "ファイルが大きすぎます。",
  not_found: "動画が見つかりません。",
  locked: "閲覧条件を満たしていません。",
  age_restricted: "この動画は年齢制限があります。成人向け表示を有効にしてください。",
  gate_unavailable: "閲覧条件を確認できませんでした。",
  gate_required: "ゲート付きの動画には、先にゲートを付けてください。",
  not_ready: "動画の処理が終わっていません。",
  copyright_hold: "著作権の確認中のため、公開できません。",
  duration_mismatch: "申告した長さと実際の長さが大きく違うため、受け付けられませんでした。",
};

export function nativeVideoMessage(code: string, fallback: string): string {
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code]! : fallback;
}

async function failure(response: Response, fallback: string): Promise<NativeVideoClientError> {
  const body = (await response.json().catch(() => null)) as { error?: unknown; code?: unknown } | null;
  const code = typeof body?.code === "string" ? body.code : typeof body?.error === "string" && /^[a-z_]+$/u.test(body.error) ? body.error : `http_${response.status}`;
  const message = typeof body?.error === "string" && !/^[a-z_]+$/u.test(body.error) ? body.error : nativeVideoMessage(code, fallback);
  return new NativeVideoClientError(code, message, response.status);
}

const JSON_HEADERS = { "content-type": "application/json" };

async function hubJson<T>(fetchImpl: FetchLike, path: string, init: RequestInit, fallback: string): Promise<T> {
  let response: Response;
  try {
    response = await fetchImpl(path, { credentials: "same-origin", ...init });
  } catch {
    throw new NativeVideoClientError("network", "通信できませんでした。");
  }
  if (!response.ok) throw await failure(response, fallback);
  return (await response.json()) as T;
}

/* ------------------------------------------------------------------ lists and edits */

export async function listNativeVideos(fetchImpl: FetchLike = fetch): Promise<{ videos: NativeVideo[]; quota: NativeVideoQuota | null }> {
  const body = await hubJson<{ videos?: NativeVideo[]; quota?: NativeVideoQuota | null }>(fetchImpl, "/api/videos/native", { cache: "no-store" }, "動画の一覧を読み込めませんでした。");
  return { videos: Array.isArray(body.videos) ? body.videos : [], quota: body.quota ?? null };
}

export async function getNativeVideo(id: string, fetchImpl: FetchLike = fetch): Promise<NativeVideo> {
  const body = await hubJson<{ video: NativeVideo }>(fetchImpl, `/api/videos/native/${encodeURIComponent(id)}`, { cache: "no-store" }, "状態を確かめられませんでした。");
  return body.video;
}

export async function updateNativeVideo(
  id: string,
  patch: { title?: string; description?: string; visibility?: NativeVideoVisibility; ageRestricted?: boolean; commentsEnabled?: boolean; tags?: string[] },
  fetchImpl: FetchLike = fetch,
): Promise<NativeVideo> {
  const body = await hubJson<{ video: NativeVideo }>(
    fetchImpl,
    `/api/videos/native/${encodeURIComponent(id)}`,
    { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) },
    "変更を保存できませんでした。",
  );
  return body.video;
}

export async function publishNativeVideo(id: string, fetchImpl: FetchLike = fetch): Promise<NativeVideo> {
  const body = await hubJson<{ video: NativeVideo }>(fetchImpl, `/api/videos/native/${encodeURIComponent(id)}/publish`, { method: "POST" }, "公開できませんでした。");
  return body.video;
}

export async function unpublishNativeVideo(id: string, fetchImpl: FetchLike = fetch): Promise<void> {
  await hubJson<unknown>(fetchImpl, `/api/videos/native/${encodeURIComponent(id)}/unpublish`, { method: "POST" }, "非公開にできませんでした。");
}

export async function deleteNativeVideo(id: string, fetchImpl: FetchLike = fetch): Promise<void> {
  await hubJson<unknown>(fetchImpl, `/api/videos/native/${encodeURIComponent(id)}`, { method: "DELETE" }, "削除できませんでした。");
}

/* ------------------------------------------------------------------ small helpers */

/** The picker's ids (cc-by-4.0) to the ids the video service stores (cc-by). */
export function videoLicenseId(pickerId: string): string {
  if (pickerId === "arr") return "arr";
  if (pickerId === "cc0-1.0") return "cc0";
  return pickerId.replace(/-[0-9.]+$/u, "");
}

/** The stored id (cc-by) back to the picker's id (cc-by-4.0); unknown ids come back unchanged. */
export function pickerLicenseId(storedId: string): string {
  if (storedId === "cc0") return "cc0-1.0";
  if (storedId.startsWith("cc-")) return `${storedId}-4.0`;
  return storedId;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function formatClock(totalSeconds: number): string {
  const total = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** The minutes a file will be charged: a started minute counts (Hub rounds up). */
export function declaredMinutes(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / 60));
}

/** The length in seconds from the file's own metadata, or null when the browser cannot read it. */
export function readVideoDurationSeconds(file: Blob, timeoutMs = 15_000): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = document.createElement("video");
    let settled = false;
    const finish = (value: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      probe.removeAttribute("src");
      probe.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = window.setTimeout(() => finish(null), timeoutMs);
    probe.preload = "metadata";
    probe.muted = true;
    probe.onloadedmetadata = () => finish(Number.isFinite(probe.duration) && probe.duration > 0 ? probe.duration : null);
    probe.onerror = () => finish(null);
    probe.src = url;
  });
}

/* ------------------------------------------------------------------ upload */

export type NativeUploadInput = {
  file: Blob;
  title: string;
  description: string;
  visibility: NativeVideoVisibility;
  /** A video-service license id, see videoLicenseId. */
  license: string;
  ageRestricted: boolean;
  commentsEnabled: boolean;
  durationSeconds: number;
  kind?: "normal" | "short";
};

type UploadTicket = { videoId: string; assetId: string; ticket: string; header: string; path: string; expiresAt: string; maxBytes: number };

/** One open upload. The secret lives only in this object, in memory. */
export type NativeUploadSession = {
  videoId: string;
  path: string;
  tokenHeader: string;
  token: string;
  partSizeBytes: number;
  partCount: number;
  totalBytes: number;
  /** The next part to send: a failed upload resumes here. */
  nextPart: number;
};

export type PutPart = (
  url: string,
  headers: Record<string, string>,
  body: Blob,
  onProgress: (sentBytes: number) => void,
) => Promise<{ status: number }>;

export type UploadProgress = {
  stage: "starting" | "uploading" | "finishing";
  sentBytes: number;
  totalBytes: number;
  part: number;
  partCount: number;
  /** Set while a part is being sent again (1-based attempt number after the first). */
  retry: number;
};

export type UploadDeps = {
  fetch?: FetchLike;
  putPart?: PutPart;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
};

/** PUT with progress. XMLHttpRequest is the only browser API that reports upload progress. */
export const xhrPutPart: PutPart = (url, headers, body, onProgress) =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url);
    for (const [name, value] of Object.entries(headers)) request.setRequestHeader(name, value);
    request.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(event.loaded); };
    request.onload = () => resolve({ status: request.status });
    request.onerror = () => reject(new Error("network"));
    request.ontimeout = () => reject(new Error("network"));
    request.onabort = () => reject(new Error("aborted"));
    request.send(body);
  });

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

/** Steps 1 and 2: Hub issues the ticket, then the Video Worker opens the multipart upload. */
export async function startNativeUpload(input: NativeUploadInput, deps: UploadDeps = {}): Promise<NativeUploadSession> {
  const fetchImpl = deps.fetch ?? fetch;
  const issued = await hubJson<{ upload: UploadTicket }>(
    fetchImpl,
    "/api/videos/native",
    {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        visibility: input.visibility,
        source: "web",
        sizeBytes: input.file.size,
        durationSeconds: input.durationSeconds,
        kind: input.kind ?? "normal",
        license: input.license,
        ageRestricted: input.ageRestricted,
        commentsEnabled: input.commentsEnabled,
      }),
    },
    "アップロードを始められませんでした。",
  );
  const ticket = issued.upload;
  let response: Response;
  try {
    response = await fetchImpl(ticket.path, {
      method: "POST",
      headers: { ...JSON_HEADERS, [ticket.header]: ticket.ticket },
      body: JSON.stringify({ source: "web", files: [{ variant: "main", bytes: input.file.size }] }),
    });
  } catch {
    throw new NativeVideoClientError("network", "通信できませんでした。");
  }
  if (!response.ok) throw await failure(response, "アップロードを始められませんでした。");
  const started = (await response.json()) as {
    upload?: { token?: string; header?: string; partSizeBytes?: number; files?: { variant: string; partCount: number }[] };
  };
  const upload = started.upload;
  const main = upload?.files?.find((file) => file.variant === "main");
  if (!upload?.token || !upload.header || !upload.partSizeBytes || !main) {
    throw new NativeVideoClientError("bad_response", "アップロードの応答が正しくありません。");
  }
  return {
    videoId: ticket.videoId,
    path: ticket.path,
    tokenHeader: upload.header,
    token: upload.token,
    partSizeBytes: upload.partSizeBytes,
    partCount: main.partCount,
    totalBytes: input.file.size,
    nextPart: 1,
  };
}

/**
 * Step 3 and 4: send the parts from `session.nextPart`, each retried a few times with a growing
 * pause (a part the Worker already stored is simply replaced), then close the upload. On a
 * failure `session.nextPart` points at the part that failed, so calling this again resumes.
 */
export async function sendNativeUpload(
  session: NativeUploadSession,
  file: Blob,
  onProgress: (progress: UploadProgress) => void,
  deps: UploadDeps = {},
): Promise<void> {
  const fetchImpl = deps.fetch ?? fetch;
  const putPart = deps.putPart ?? xhrPutPart;
  const sleep = deps.sleep ?? defaultSleep;
  const attempts = deps.maxAttempts ?? 4;

  while (session.nextPart <= session.partCount) {
    const part = session.nextPart;
    const start = (part - 1) * session.partSizeBytes;
    const body = file.slice(start, Math.min(file.size, start + session.partSizeBytes));
    let lastError: NativeVideoClientError | null = null;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (attempt > 0) await sleep(500 * 2 ** (attempt - 1));
      const report = (sent: number) =>
        onProgress({ stage: "uploading", sentBytes: Math.min(session.totalBytes, start + sent), totalBytes: session.totalBytes, part, partCount: session.partCount, retry: attempt });
      report(0);
      try {
        const result = await putPart(`${session.path}/main/parts/${part}`, { [session.tokenHeader]: session.token }, body, report);
        if (result.status >= 200 && result.status < 300) {
          lastError = null;
          break;
        }
        lastError = new NativeVideoClientError(`http_${result.status}`, nativeVideoMessage(result.status === 401 ? "upload_token_invalid" : result.status === 410 ? "upload_expired" : "", "送信できませんでした。"), result.status);
        if (!RETRYABLE.has(result.status)) throw lastError;
      } catch (error) {
        if (error instanceof NativeVideoClientError && !RETRYABLE.has(error.status)) throw error;
        lastError = error instanceof NativeVideoClientError ? error : new NativeVideoClientError("network", "通信できませんでした。");
      }
    }
    if (lastError) throw lastError;
    session.nextPart = part + 1;
    onProgress({ stage: "uploading", sentBytes: Math.min(session.totalBytes, start + body.size), totalBytes: session.totalBytes, part, partCount: session.partCount, retry: 0 });
  }

  onProgress({ stage: "finishing", sentBytes: session.totalBytes, totalBytes: session.totalBytes, part: session.partCount, partCount: session.partCount, retry: 0 });
  let response: Response;
  try {
    response = await fetchImpl(`${session.path}/complete`, { method: "POST", headers: { [session.tokenHeader]: session.token } });
  } catch {
    throw new NativeVideoClientError("network", "通信できませんでした。");
  }
  if (!response.ok) throw await failure(response, "アップロードを完了できませんでした。");
}

/** Poll Hub (which asks the Video Worker) until the video leaves upload/processing. */
export async function waitForNativeVideo(
  id: string,
  onState: (video: NativeVideo) => void,
  options: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void>; intervalMs?: number; maxMs?: number; signal?: { aborted: boolean } } = {},
): Promise<NativeVideo> {
  const sleep = options.sleep ?? defaultSleep;
  const interval = options.intervalMs ?? 4000;
  const limit = Math.ceil((options.maxMs ?? 45 * 60_000) / interval);
  let last: NativeVideo | null = null;
  for (let tick = 0; tick < limit; tick += 1) {
    if (options.signal?.aborted) break;
    try {
      last = await getNativeVideo(id, options.fetch);
      onState(last);
      if (last.state !== "upload_issued" && last.state !== "processing") return last;
    } catch (error) {
      if (error instanceof NativeVideoClientError && error.status === 404) throw error;
      // A single failed poll is not a failed video; keep asking.
    }
    await sleep(interval);
  }
  if (last) return last;
  throw new NativeVideoClientError("timeout", "処理の状態を確かめられませんでした。");
}

/* ------------------------------------------------------------------ playback */

export const PLAY_REFRESH_MS = 15 * 60 * 1000;

type PlayTicket = { ticket: string; header: string; method: "POST"; path: string; expiresAt: string };

/** Resolve every URI line of a playlist against its own URL, so it can be served from a blob: URL. */
export function absolutizePlaylist(playlist: string, base: string): string {
  return playlist
    .split(/\r?\n/u)
    .map((line) => {
      const text = line.trim();
      if (!text) return "";
      if (text.startsWith("#")) {
        return text.replace(/URI="([^"]+)"/u, (_whole, uri: string) => `URI="${new URL(uri, base).toString()}"`);
      }
      return new URL(text, base).toString();
    })
    .join("\n");
}

/** Hub's answer, then the Video Worker's playlist, as an absolute-URL playlist text. */
export async function fetchNativePlaylist(videoId: string, fetchImpl: FetchLike = fetch, origin = typeof window === "undefined" ? "http://localhost" : window.location.origin, preview = false): Promise<string> {
  const issued = await hubJson<{ play: PlayTicket }>(fetchImpl, `/api/videos/native/${encodeURIComponent(videoId)}/${preview ? "preview" : "play"}`, { method: "POST" }, "再生を始められませんでした。");
  const play = issued.play;
  let response: Response;
  try {
    response = await fetchImpl(play.path, { method: play.method, headers: { [play.header]: play.ticket }, cache: "no-store" });
  } catch {
    throw new NativeVideoClientError("network", "通信できませんでした。");
  }
  if (!response.ok) throw await failure(response, "再生を始められませんでした。");
  const text = await response.text();
  if (!text.startsWith("#EXTM3U")) throw new NativeVideoClientError("bad_response", "再生の応答が正しくありません。");
  return absolutizePlaylist(text, new URL(play.path, origin).toString());
}

type HlsInstance = {
  loadSource(url: string): void;
  attachMedia(element: HTMLVideoElement): void;
  destroy(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  startLoad?(position?: number): void;
  recoverMediaError?(): void;
};
type HlsConstructor = {
  new (config?: Record<string, unknown>): HlsInstance;
  isSupported(): boolean;
  Events: { ERROR: string };
};

let hlsPromise: Promise<HlsConstructor | null> | null = null;

/** hls.js, vendored under /vendor/hls (Apache-2.0), loaded only when a Hub video is opened. */
export function loadHls(): Promise<HlsConstructor | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const existing = (window as unknown as { Hls?: HlsConstructor }).Hls;
  if (existing) return Promise.resolve(existing);
  hlsPromise ??= new Promise<HlsConstructor | null>((resolve) => {
    const script = document.createElement("script");
    script.src = "/vendor/hls/hls.min.js";
    script.async = true;
    script.onload = () => resolve((window as unknown as { Hls?: HlsConstructor }).Hls ?? null);
    script.onerror = () => { hlsPromise = null; resolve(null); };
    document.head.append(script);
  });
  return hlsPromise;
}

export type NativePlayback = { destroy(): void };

export type PlaybackHandlers = {
  onError: (error: NativeVideoClientError) => void;
  onPlaylistRefreshed?: () => void;
};

/**
 * Attach a Hub video to a <video>. A new play ticket and playlist are fetched every 15 minutes
 * (the playlist's segment token expires), and playback resumes where it was.
 */
export async function attachNativePlayback(
  video: HTMLVideoElement,
  videoId: string,
  handlers: PlaybackHandlers,
  deps: { fetch?: FetchLike; loadHls?: () => Promise<HlsConstructor | null>; refreshMs?: number; preview?: boolean } = {},
): Promise<NativePlayback> {
  const fetchImpl = deps.fetch ?? fetch;
  const refreshMs = deps.refreshMs ?? PLAY_REFRESH_MS;
  let destroyed = false;
  let blobUrl: string | null = null;
  let hls: HlsInstance | null = null;
  let timer: number | undefined;
  const makeBlob = async () => {
    const playlist = await fetchNativePlaylist(videoId, fetchImpl, undefined, deps.preview === true);
    const url = URL.createObjectURL(new Blob([playlist], { type: "application/vnd.apple.mpegurl" }));
    const previous = blobUrl;
    blobUrl = url;
    if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 60_000);
    return url;
  };

  const first = await makeBlob();
  if (destroyed) return { destroy() {} };

  // hls.js wherever Media Source Extensions exist (it behaves the same in every browser); the browser's own
  // HLS only where it does not (iPhone Safari). Either way the player gets the same playlist.
  const Hls = await (deps.loadHls ?? loadHls)();
  if (destroyed) return { destroy() {} };
  if (Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true, lowLatencyMode: false });
    hls.on(Hls.Events.ERROR, (...args: unknown[]) => {
      const data = args[1] as { fatal?: boolean; type?: string } | undefined;
      if (!data?.fatal) return;
      if (data.type === "mediaError") hls?.recoverMediaError?.();
      else handlers.onError(new NativeVideoClientError("playback", "再生中にエラーが起きました。"));
    });
    hls.loadSource(first);
    hls.attachMedia(video);
  } else if (video.canPlayType("application/vnd.apple.mpegurl") !== "") {
    video.src = first;
  } else {
    throw new NativeVideoClientError("unsupported", "このブラウザでは動画を再生できません。");
  }

  const refresh = async () => {
    if (destroyed) return;
    try {
      const resume = video.currentTime;
      const wasPlaying = !video.paused && !video.ended;
      const url = await makeBlob();
      if (destroyed) return;
      if (hls) {
        hls.loadSource(url);
        hls.startLoad?.(resume);
      } else {
        video.src = url;
      }
      const restore = () => {
        video.currentTime = resume;
        if (wasPlaying) void video.play().catch(() => undefined);
      };
      video.addEventListener("loadedmetadata", restore, { once: true });
      handlers.onPlaylistRefreshed?.();
    } catch (error) {
      if (!destroyed) handlers.onError(error instanceof NativeVideoClientError ? error : new NativeVideoClientError("network", "通信できませんでした。"));
      return;
    }
    timer = window.setTimeout(() => void refresh(), refreshMs);
  };
  timer = window.setTimeout(() => void refresh(), refreshMs);

  return {
    destroy() {
      destroyed = true;
      window.clearTimeout(timer);
      hls?.destroy();
      hls = null;
      video.removeAttribute("src");
      video.load();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
      blobUrl = null;
    },
  };
}
