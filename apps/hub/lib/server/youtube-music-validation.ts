import { getYouTubeDataApiKey } from "@/lib/server/youtube-api-key";
import { readMetadataText } from "./bounded-metadata-reader";
import { isRedirectResponse } from "@/lib/redirect-guard";

const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const MAX_RESPONSE_BYTES = 131072;
const MIN_FULL_TRACK_SECONDS = 60;
export const MAX_MUSIC_TRACK_SECONDS = 15 * 60;
const NON_MUSIC_TITLE_PATTERN = /(?:\b(?:podcast|interview|reaction|review|gameplay|trailer|tutorial|news|commentary)\b|ポッドキャスト|インタビュー|リアクション|レビュー|ゲーム実況|実況プレイ|予告編|ニュース|解説動画|雑談)/iu;

type YouTubeVideoPayload = {
  items?: Array<{
    id?: unknown;
    snippet?: {
      title?: unknown;
      categoryId?: unknown;
      liveBroadcastContent?: unknown;
    };
    contentDetails?: {
      duration?: unknown;
    };
    status?: {
      privacyStatus?: unknown;
      embeddable?: unknown;
      madeForKids?: unknown;
    };
  }>;
};

type ValidationOptions = {
  apiKey?: string;
  fetcher?: typeof fetch;
};

export class YouTubeMusicRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "YouTubeMusicRejectedError";
  }
}

export class YouTubeMusicValidationUnavailableError extends Error {
  constructor(message = "YouTubeの音楽判定を現在利用できません。時間をおいて再度お試しください。") {
    super(message);
    this.name = "YouTubeMusicValidationUnavailableError";
  }
}

// Watch URLs whose ?v= parameter this accepts. Without this the host went unchecked and any
// origin carrying a well-formed ?v= was treated as a YouTube URL, so the stored source_url
// could point anywhere while the API check silently validated the extracted id instead.
const YOUTUBE_WATCH_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"]);

function videoIdFromUrl(sourceUrl: string): string {
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || !YOUTUBE_WATCH_HOSTS.has(url.hostname)) {
    throw new YouTubeMusicRejectedError("YouTubeの動画URLが正しくありません。");
  }
  const id = url.searchParams.get("v");
  if (!id || !/^[A-Za-z0-9_-]{11}$/u.test(id)) {
    throw new YouTubeMusicRejectedError("YouTubeの動画URLが正しくありません。");
  }
  return id;
}

export function parseYouTubeDurationSeconds(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/u.exec(value);
  if (!match) return null;
  const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
  return Number(days) * 86_400 + Number(hours) * 3_600 + Number(minutes) * 60 + Number(seconds);
}

async function readJson(response: Response): Promise<YouTubeVideoPayload> {
  try {
    return JSON.parse(await readMetadataText(response, MAX_RESPONSE_BYTES)) as YouTubeVideoPayload;
  } catch {
    throw new YouTubeMusicValidationUnavailableError();
  }
}

export async function validateYouTubeMusicVideo(
  sourceUrl: string,
  options: ValidationOptions = {},
): Promise<void> {
  const apiKey = options.apiKey?.trim() || getYouTubeDataApiKey();
  if (!apiKey) {
    throw new YouTubeMusicValidationUnavailableError("YouTube音楽判定のAPIキーが設定されていないため、登録できません。");
  }
  const videoId = videoIdFromUrl(sourceUrl);
  const endpoint = new URL(YOUTUBE_VIDEOS_ENDPOINT);
  endpoint.searchParams.set("part", "snippet,contentDetails,status");
  endpoint.searchParams.set("id", videoId);
  endpoint.searchParams.set("key", apiKey);

  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new YouTubeMusicValidationUnavailableError();
  }
  if (!response.ok || isRedirectResponse(response)) throw new YouTubeMusicValidationUnavailableError();

  const payload = await readJson(response);
  const video = Array.isArray(payload.items) ? payload.items[0] : undefined;
  if (!video || video.id !== videoId) {
    throw new YouTubeMusicRejectedError("このYouTube動画は公開されていないか、利用できません。");
  }
  if (video.status?.privacyStatus !== "public") {
    throw new YouTubeMusicRejectedError("公開動画だけをMusicへ登録できます。");
  }
  if (video.status?.embeddable !== true) {
    throw new YouTubeMusicRejectedError("Hub内で埋め込み再生できない動画は登録できません。");
  }
  if (video.status?.madeForKids === true) {
    throw new YouTubeMusicRejectedError("子ども向けに設定された動画はMusicへ登録できません。");
  }
  if (video.snippet?.categoryId !== "10") {
    throw new YouTubeMusicRejectedError("YouTubeで音楽カテゴリに設定された動画だけを登録できます。");
  }
  if (video.snippet?.liveBroadcastContent !== "none") {
    throw new YouTubeMusicRejectedError("ライブ配信・配信予定動画はMusicへ登録できません。");
  }
  const duration = parseYouTubeDurationSeconds(video.contentDetails?.duration);
  if (duration === null) throw new YouTubeMusicValidationUnavailableError();
  if (duration < MIN_FULL_TRACK_SECONDS) {
    throw new YouTubeMusicRejectedError("1分未満の短い動画はフル楽曲として登録できません。");
  }
  if (duration > MAX_MUSIC_TRACK_SECONDS) {
    throw new YouTubeMusicRejectedError("15分を超える動画はMusicへ登録できません。");
  }
  const title = typeof video.snippet?.title === "string" ? video.snippet.title.normalize("NFKC") : "";
  if (!title || NON_MUSIC_TITLE_PATTERN.test(title)) {
    throw new YouTubeMusicRejectedError("音楽以外の可能性が高い動画は自動登録できません。");
  }
}
