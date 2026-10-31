"use client";

import { useEffect, useState } from "react";
import { EMPTY_MUSIC_LISTENING_PROFILE, MUSIC_LISTENING_PROFILE_CHANGED_EVENT, readMusicListeningProfile } from "@/lib/music-listening-profile";
import { buildMusicPlaybackQueue } from "@/lib/music-ranking";
import type { MusicWork } from "@/lib/music-catalog";

export function useMusicRecommendations() {
  const [profile, setProfile] = useState(EMPTY_MUSIC_LISTENING_PROFILE);
  useEffect(() => {
    const refresh = () => setProfile(readMusicListeningProfile());
    refresh();
    window.addEventListener(MUSIC_LISTENING_PROFILE_CHANGED_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(MUSIC_LISTENING_PROFILE_CHANGED_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return (works: MusicWork[], favoriteIds: string[]) => {
    const genrePlays = { ...profile.genrePlays };
    const tagPlays = { ...profile.tagPlays };
    for (const work of works) {
      if (!favoriteIds.includes(work.id)) continue;
      genrePlays[work.genre] = (genrePlays[work.genre] ?? 0) + 4;
      for (const tag of work.tags ?? []) tagPlays[tag] = (tagPlays[tag] ?? 0) + 4;
    }
    // Start genre blocks with the listener's strongest genre, not catalog order.
    const candidates = [...works].sort((a, b) => (genrePlays[b.genre] ?? 0) - (genrePlays[a.genre] ?? 0));
    return buildMusicPlaybackQueue(candidates, { ...profile, genrePlays, tagPlays, favoriteIds });
  };
}
