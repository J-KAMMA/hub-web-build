export const MUSIC_LISTENING_PROFILE_KEY = "music.listening-profile.v1";
export const MUSIC_LISTENING_PROFILE_CHANGED_EVENT = "music:listening-profile-changed";

export type MusicHistoryEntry = {
  id: string;
  title: string;
  artist: string;
  genre?: string;
  artworkUrl?: string;
  playedAt: number;
};

export type MusicListeningProfile = {
  history: MusicHistoryEntry[];
  plays: Record<string, number>;
  skips: Record<string, number>;
  genrePlays: Record<string, number>;
  tagPlays: Record<string, number>;
  tagSkips: Record<string, number>;
};

export const EMPTY_MUSIC_LISTENING_PROFILE: MusicListeningProfile = { history: [], plays: {}, skips: {}, genrePlays: {}, tagPlays: {}, tagSkips: {} };

export function readMusicListeningProfile(storage: Pick<Storage, "getItem"> = window.localStorage): MusicListeningProfile {
  try {
    const value = JSON.parse(storage.getItem(MUSIC_LISTENING_PROFILE_KEY) ?? "null") as Partial<MusicListeningProfile> | null;
    if (!value || typeof value !== "object") return EMPTY_MUSIC_LISTENING_PROFILE;
    return {
      history: Array.isArray(value.history) ? value.history.filter((entry): entry is MusicHistoryEntry => Boolean(entry) && typeof entry.id === "string" && typeof entry.playedAt === "number").slice(0, 30) : [],
      plays: value.plays && typeof value.plays === "object" ? value.plays : {},
      skips: value.skips && typeof value.skips === "object" ? value.skips : {},
      genrePlays: value.genrePlays && typeof value.genrePlays === "object" ? value.genrePlays : {},
      tagPlays: value.tagPlays && typeof value.tagPlays === "object" ? value.tagPlays : {},
      tagSkips: value.tagSkips && typeof value.tagSkips === "object" ? value.tagSkips : {},
    };
  } catch {
    return EMPTY_MUSIC_LISTENING_PROFILE;
  }
}

export function recordMusicListeningAction(
  action: "play" | "skip",
  track: { id: string; title: string; artist: string; genre?: string; tags?: string[]; artworkUrl?: string },
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
) {
  const current = readMusicListeningProfile(storage);
  const next: MusicListeningProfile = {
    history: current.history,
    plays: { ...current.plays },
    skips: { ...current.skips },
    genrePlays: { ...current.genrePlays },
    tagPlays: { ...current.tagPlays },
    tagSkips: { ...current.tagSkips },
  };
  if (action === "play") {
    next.plays[track.id] = (next.plays[track.id] ?? 0) + 1;
    if (track.genre) next.genrePlays[track.genre] = (next.genrePlays[track.genre] ?? 0) + 1;
    for (const tag of track.tags ?? []) next.tagPlays[tag] = (next.tagPlays[tag] ?? 0) + 1;
    next.history = [{ ...track, playedAt: Date.now() }, ...current.history.filter((entry) => entry.id !== track.id)].slice(0, 30);
  } else {
    next.skips[track.id] = (next.skips[track.id] ?? 0) + 1;
    for (const tag of track.tags ?? []) next.tagSkips[tag] = (next.tagSkips[tag] ?? 0) + 1;
  }
  try {
    storage.setItem(MUSIC_LISTENING_PROFILE_KEY, JSON.stringify(next));
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MUSIC_LISTENING_PROFILE_CHANGED_EVENT, { detail: next }));
  } catch { /* listening preferences are optional */ }
  return next;
}
