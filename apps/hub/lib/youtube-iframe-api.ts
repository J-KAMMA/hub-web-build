/*
 * YouTube の公式 IFrame Player API の読み込み（2026-09-03、常駐プレーヤーから抜き出した）。
 *
 * **規約で決まっていること**（YouTube API Services Terms / Developer Policies）。
 * 実装を変えるときはここを読んでから変える:
 *   1. 再生は**公式の埋め込みプレーヤー**だけ。音声だけを取り出したり、
 *      自前のサーバーを通したり、保存したりしない。
 *   2. プレーヤーは**200×200px 以上**で、**見えている**こと。
 *   3. プレーヤーの上に何も**重ねない**（操作も広告も文字も）。
 *   4. **音だけの再生をしない**。隠したまま鳴らさない。畳むなら止める。
 *   5. 出所を示し、**YouTube へ戻る道**を出す。
 * 埋め込み先は youtube-nocookie.com（同意は components/youtube-embed-consent.tsx）。
 */

export type YouTubePlayer = {
  destroy: () => void;
  getPlayerState: () => number;
  pauseVideo: () => void;
  playVideo: () => void;
  setVolume?: (volume: number) => void;
  getCurrentTime?: () => number;
  getDuration?: () => number;
};

export type YouTubeApi = {
  Player: new (
    element: HTMLIFrameElement,
    options: { events: Record<string, (event: { data?: number; target: YouTubePlayer }) => void> },
  ) => YouTubePlayer;
  PlayerState: { ENDED: number; PAUSED: number; PLAYING: number };
};

let youtubeApiPromise: Promise<YouTubeApi> | null = null;

/* script は1本だけ。2つ目のプレーヤーが来ても同じ約束を返す。 */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  const playerWindow = window as typeof window & { YT?: YouTubeApi; onYouTubeIframeAPIReady?: () => void };
  if (playerWindow.YT?.Player) return Promise.resolve(playerWindow.YT);
  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve, reject) => {
      const previous = playerWindow.onYouTubeIframeAPIReady;
      playerWindow.onYouTubeIframeAPIReady = () => {
        previous?.();
        if (playerWindow.YT) resolve(playerWindow.YT);
      };
      const existing = document.getElementById("hub-youtube-iframe-api");
      if (existing) return;
      const script = document.createElement("script");
      script.id = "hub-youtube-iframe-api";
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.addEventListener("error", () => reject(new Error("YouTube player API failed to load")), { once: true });
      document.body.append(script);
    });
  }
  return youtubeApiPromise;
}

/*
 * 同意で得た埋め込み先に、API から操作するための印を足す。
 * autoplay は「利用者が再生を押した」ときだけ。勝手には鳴らさない。
 */
export function youtubeEmbedSrc(authorizedEmbedUrl: string, autoplay: boolean): string {
  const url = new URL(authorizedEmbedUrl);
  url.searchParams.set("enablejsapi", "1");
  url.searchParams.set("playsinline", "1");
  url.searchParams.set("origin", window.location.origin);
  url.searchParams.set("widget_referrer", window.location.origin);
  if (autoplay) url.searchParams.set("autoplay", "1");
  return url.toString();
}

/* 埋め込み先から動画の id を取り出す。取れなければ空。 */
export function youtubeVideoId(embedUrl: string | undefined): string {
  if (!embedUrl) return "";
  try {
    return new URL(embedUrl).pathname.split("/").filter(Boolean).at(-1) ?? "";
  } catch {
    return "";
  }
}

/* 規約が求める「YouTube へ戻る道」。 */
export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}
