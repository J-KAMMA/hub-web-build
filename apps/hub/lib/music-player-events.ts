import type { MusicProvider } from "@/lib/music-catalog";

export const MUSIC_PLAYER_PLAY_EVENT = "music:player-play";
export const MUSIC_PLAYER_STOP_EVENT = "music:player-stop";
export const MUSIC_PLAYER_ENDED_EVENT = "music:player-ended";
export const MUSIC_PLAYER_NEXT_EVENT = "music:player-next";
export const MUSIC_PLAYER_PREVIOUS_EVENT = "music:player-previous";
export const MUSIC_PLAYER_TOGGLE_EVENT = "music:player-toggle";
export const MUSIC_PLAYER_RESUME_EVENT = "music:player-resume";
export const MUSIC_PLAYER_PAUSE_EVENT = "music:player-pause";
export const MUSIC_PLAYER_QUEUE_EVENT = "music:player-queue";
export const MUSIC_PLAYER_ENQUEUE_NEXT_EVENT = "music:player-enqueue-next";
export const MUSIC_PLAYER_STATE_EVENT = "music:player-state";
export const MUSIC_PLAYER_STATE_REQUEST_EVENT = "music:player-state-request";
export const MUSIC_PLAYER_VOLUME_EVENT = "music:player-volume";
/* 再生位置（秒）。右列の再生カードの進み具合の表示用。曲が変われば duration は 0 から始まる。 */
export const MUSIC_PLAYER_PROGRESS_EVENT = "music:player-progress";
export type PersistentMusicProgress = { trackId: string; position: number; duration: number };
export const MUSIC_FAVORITES_CHANGED_EVENT = "music:favorites-changed";

export type PersistentMusicTrack = {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  tags?: string[];
  provider: MusicProvider | "hub";
  providerLabel: string;
  artworkUrl?: string;
  audioUrl?: string;
  embedUrl?: string;
  externalUrl?: string;
  autoplay?: boolean;
  keepCollapsed?: boolean;
};

export type PersistentMusicQueue = {
  tracks: PersistentMusicTrack[];
  currentTrackId: string;
};

export type PersistentMusicPlayerState = {
  track: PersistentMusicTrack | null;
  playing: boolean;
  volume: number;
  queue: PersistentMusicTrack[];
};

export function playPersistentMusic(track: PersistentMusicTrack) {
  window.dispatchEvent(new CustomEvent<PersistentMusicTrack>(MUSIC_PLAYER_PLAY_EVENT, { detail: track }));
}

export function setPersistentMusicQueue(tracks: PersistentMusicTrack[], currentTrackId: string) {
  window.dispatchEvent(new CustomEvent<PersistentMusicQueue>(MUSIC_PLAYER_QUEUE_EVENT, {
    detail: { tracks, currentTrackId },
  }));
}

export function clearPersistentMusicQueue() {
  setPersistentMusicQueue([], "");
}

export function enqueueNextPersistentMusic(track: PersistentMusicTrack) {
  window.dispatchEvent(new CustomEvent<PersistentMusicTrack>(MUSIC_PLAYER_ENQUEUE_NEXT_EVENT, { detail: track }));
}

export function stopPersistentMusic() {
  window.dispatchEvent(new Event(MUSIC_PLAYER_STOP_EVENT));
}

export function notifyPersistentMusicEnded(track: PersistentMusicTrack) {
  window.dispatchEvent(new CustomEvent<PersistentMusicTrack>(MUSIC_PLAYER_ENDED_EVENT, { detail: track }));
}
