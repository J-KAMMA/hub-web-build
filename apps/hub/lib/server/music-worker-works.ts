import { canonicalizeMusicWork, type MusicWork } from "@/lib/music-catalog";

/*
 * Music Worker（apps/music）が公開した原盤の一覧を、Hub の曲（MusicWork、id は
 * `music:<uuid>`）として読む。公開・クリーン済みだけを Worker が返す。
 * Hub は音声を中継しない（再生は /music/api/tracks/<id>/audio をブラウザが直接取る）。
 */

const ORIGINAL_TRACK_PREFIX = "music:";
const MUSIC_CATALOG_TIMEOUT_MS = 8_000;

type WorkerTrack = {
  id: string;
  title: string;
  artist: string;
  description: string;
  album?: string;
  artworkUrl?: string;
  publishedAt: string;
};

function workerWorkId(trackId: string) {
  return trackId.startsWith(ORIGINAL_TRACK_PREFIX) ? trackId : `${ORIGINAL_TRACK_PREFIX}${trackId}`;
}

function isWorkerTrack(value: unknown): value is WorkerTrack {
  if (!value || typeof value !== "object") return false;
  const track = value as Partial<WorkerTrack>;
  return typeof track.id === "string"
    && Boolean(track.id)
    && typeof track.title === "string"
    && typeof track.artist === "string"
    && typeof track.description === "string"
    && typeof track.publishedAt === "string";
}

export function workerTrackAsMusicWork(track: WorkerTrack): MusicWork {
  const publishedYear = new Date(track.publishedAt).getUTCFullYear();
  return canonicalizeMusicWork({
    id: workerWorkId(track.id),
    title: track.title,
    artist: track.artist,
    album: track.album,
    description: track.description,
    genre: "Hub Music",
    year: Number.isFinite(publishedYear) ? publishedYear : 0,
    accent: "",
    symbol: "",
    artworkUrl: track.artworkUrl,
    source: "community",
    createdAt: track.publishedAt,
    services: [],
  });
}

export async function listWorkerMusicWorks(requestUrl: URL, options: { query?: string; limit?: number; timeoutMs?: number } = {}): Promise<MusicWork[]> {
  const url = new URL("/music/api/tracks", requestUrl);
  const query = (options.query ?? "").trim().slice(0, 100);
  if (query) url.searchParams.set("q", query);
  if (options.limit) url.searchParams.set("limit", String(Math.max(1, Math.min(200, Math.trunc(options.limit)))));
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs ?? MUSIC_CATALOG_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`music_catalog_http_${response.status}`);
  const result = await response.json() as unknown;
  if (
    !result
    || typeof result !== "object"
    || !Array.isArray((result as { tracks?: unknown }).tracks)
    || !(result as { tracks: unknown[] }).tracks.every(isWorkerTrack)
  ) {
    throw new Error("invalid_music_catalog");
  }
  return (result as { tracks: WorkerTrack[] }).tracks.map(workerTrackAsMusicWork);
}

/** 失敗しても画面は外部の曲だけで出す（空配列）。 */
export async function listHubOriginalWorks(origin: string, options: { query?: string; limit?: number } = {}): Promise<MusicWork[]> {
  try {
    return await listWorkerMusicWorks(new URL(origin), { limit: 100, ...options });
  } catch {
    return [];
  }
}
