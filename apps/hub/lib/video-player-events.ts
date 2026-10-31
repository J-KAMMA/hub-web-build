import type { VideoProvider } from "@/components/video-discovery";

export const VIDEO_PLAYER_PLAY_EVENT = "video:player-play";
export const VIDEO_PLAYER_STOP_EVENT = "video:player-stop";

export type PersistentVideoItem = {
  id: string; title: string; channel: string; provider: VideoProvider; sourceUrl: string; authenticated: boolean;
};

export type PersistentVideoTrack = PersistentVideoItem & {
  queue?: PersistentVideoItem[];
};

export function playPersistentVideo(video: PersistentVideoTrack): void {
  window.dispatchEvent(new CustomEvent<PersistentVideoTrack>(VIDEO_PLAYER_PLAY_EVENT, { detail: video }));
}
