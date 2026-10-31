import { isPlayableMusicWork, musicGenreCategoryLabel, type MusicWork } from "@/lib/music-catalog";
import { orderPlaybackQueue, originalsFirst } from "@/lib/music-originals-first";
import { rankHubObjects } from "@/lib/platform/hub-object-ranking";


function releaseRecencyScore(year: number, currentYear: number): number {
  const age = currentYear - year;
  if (age <= 1) return 12;
  if (age <= 3) return 8;
  if (age <= 10) return 4;
  return 0;
}

export function scoreMusicWork(work: MusicWork, now = new Date()): number {
  return (isPlayableMusicWork(work) ? 12 : -100)
    + (work.featured ? 24 : 0)
    + releaseRecencyScore(work.year, now.getFullYear())
    + Math.min(work.services.length, 3) * 2;
}

export function rankMusicWorks(works: MusicWork[], now = new Date()): MusicWork[] {
  return originalsFirst(rankHubObjects(
    works.map((work, index) => ({
      ref: { namespace: "music", kind: "audio", id: work.id },
      value: work,
      baseScore: scoreMusicWork(work, now),
      stableKey: String(index).padStart(8, "0"),
      tieBreakers: [-index],
      diversityKeys: { author: work.artist, topic: work.genre },
    })),
    {
      surface: "media_feed",
      diversity: {
        author: { recentWindow: 3, penalty: 35 },
        topic: { recentWindow: 1, penalty: 10 },
      },
    },
  ).map((entry) => entry.value));
}

export type MusicPlaybackQueueOptions = {
  startId?: string;
  favoriteIds?: Iterable<string>;
  maxLength?: number;
  seed?: string;
  now?: Date;
  plays?: Record<string, number>;
  skips?: Record<string, number>;
  genrePlays?: Record<string, number>;
  tagPlays?: Record<string, number>;
  tagSkips?: Record<string, number>;
};

function stableVariation(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * Builds a deterministic listening queue without external APIs or personal tracking.
 * The chosen track stays first, while subsequent picks balance quality, favorites,
 * genre continuity, artist spacing, and a small stable variation.
 */
export function buildMusicPlaybackQueue(works: MusicWork[], options: MusicPlaybackQueueOptions = {}): MusicWork[] {
  const now = options.now ?? new Date();
  const favorites = new Set(options.favoriteIds ?? []);
  const uniquePlayable = [...new Map(
    works.filter(isPlayableMusicWork).map((work) => [work.id, work]),
  ).values()];
  if (!uniquePlayable.length) return [];

  const maximum = Math.max(1, Math.min(options.maxLength ?? uniquePlayable.length, uniquePlayable.length));
  const start = uniquePlayable.find((work) => work.id === options.startId);
  const queue: MusicWork[] = start ? [start] : [];
  const remaining = uniquePlayable.filter((work) => work.id !== start?.id);
  const seed = options.seed ?? options.startId ?? "hub-music";
  let blockGenre = start?.genre ?? "";
  let blockCategory = blockGenre ? musicGenreCategoryLabel(blockGenre) : "";
  let smallGenreCount = start ? 1 : 0;
  let broadGenreCount = 0;
  let broadPhase = false;

  while (remaining.length && queue.length < maximum) {
    let bestIndex = 0;
    let bestScore = Number.NEGATIVE_INFINITY;
    if (!blockGenre && remaining.length) {
      blockGenre = remaining[0].genre;
      blockCategory = musicGenreCategoryLabel(blockGenre);
    }
    const smallGenreAvailable = !broadPhase && remaining.some((work) => work.genre === blockGenre && (options.skips?.[work.id] ?? 0) < 3);
    if (!smallGenreAvailable) broadPhase = true;
    const broadGenreAvailable = broadPhase && remaining.some((work) => work.genre !== blockGenre && musicGenreCategoryLabel(work.genre) === blockCategory);
    const outsideCategoryAvailable = !smallGenreAvailable && !broadGenreAvailable && remaining.some((work) => musicGenreCategoryLabel(work.genre) !== blockCategory);
    for (let index = 0; index < remaining.length; index += 1) {
      const candidate = remaining[index];
      const candidateCategory = musicGenreCategoryLabel(candidate.genre);
      const sameCategoryLast = candidateCategory === blockCategory;
      const sameSmallGenreLast = candidate.genre === blockGenre;
      if (smallGenreAvailable && (!sameSmallGenreLast || (options.skips?.[candidate.id] ?? 0) >= 3)) continue;
      if (broadGenreAvailable && (!sameCategoryLast || sameSmallGenreLast)) continue;
      if (outsideCategoryAvailable && sameCategoryLast) continue;
      const recent = queue.slice(-5);
      const last = recent.at(-1);
      const sameArtistRecently = recent.some((work) => work.artist === candidate.artist);
      const sameGenreLast = last?.genre === candidate.genre;
      const sameGenreRecently = recent.slice(-3).some((work) => work.genre === candidate.genre);
      const favoriteRun = favorites.has(candidate.id) && recent.slice(-2).every((work) => favorites.has(work.id));
      const variation = stableVariation(`${seed}:${queue.length}:${candidate.id}`) * 8;
      const adjustedScore = scoreMusicWork(candidate, now)
        + (favorites.has(candidate.id) ? 8 : 0)
        + Math.min(options.plays?.[candidate.id] ?? 0, 5) * 2
        + Math.min(options.genrePlays?.[candidate.genre] ?? 0, 12) * 1.5
        + (candidate.tags ?? []).reduce((score, tag) => score + Math.min(options.tagPlays?.[tag] ?? 0, 10) * .8, 0)
        - (candidate.tags ?? []).reduce((score, tag) => score + Math.min(options.tagSkips?.[tag] ?? 0, 8) * 1.2, 0)
        + (start?.tags ?? []).filter((tag) => candidate.tags?.includes(tag)).length * 5
        + (sameCategoryLast ? 6 : 0)
        + (sameSmallGenreLast ? 24 : 0)
        + (!sameGenreLast && sameGenreRecently ? 2 : 0)
        + variation
        - (sameArtistRecently ? 80 : 0)
        - Math.min(options.skips?.[candidate.id] ?? 0, 5) * 9
        - (favoriteRun ? 14 : 0);
      if (adjustedScore > bestScore) {
        bestScore = adjustedScore;
        bestIndex = index;
      }
    }
    const next = remaining.splice(bestIndex, 1)[0];
    queue.push(next);
    const nextCategory = musicGenreCategoryLabel(next.genre);
    if (next.genre === blockGenre && !broadPhase) {
      smallGenreCount += 1;
    } else if (nextCategory === blockCategory) {
      broadPhase = true;
      broadGenreCount += 1;
    } else {
      blockGenre = next.genre;
      blockCategory = nextCategory;
      smallGenreCount = 1;
      broadGenreCount = 0;
      broadPhase = false;
    }
  }

  return orderPlaybackQueue(queue, start?.id);
}
