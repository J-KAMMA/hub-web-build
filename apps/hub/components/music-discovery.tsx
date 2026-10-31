"use client";

import React, { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SavedQueryTabs } from "@/components/saved-query-tabs";
import { HorizontalScrollRail } from "@/components/horizontal-scroll-rail";

import { MUSIC_WORKS, canonicalizeMusicWork, canonicalizeMusicWorks, hasHubFullPlaybackSource, musicAlbumLabel, musicDisplayTitle, musicGenreCategoryLabel, musicGenrePathLabel, musicWorkArtworkUrl, type MusicProvider, type MusicServiceLink, type MusicWork } from "@/lib/music-catalog";
import { buildMusicPlaybackQueue, rankMusicWorks } from "@/lib/music-ranking";
import { useCategoryAccordion } from "@/lib/use-category-accordion";
import type { MusicTagFacet } from "@/lib/server/d1-music";
import {
  EMPTY_MUSIC_LISTENING_PROFILE,
  MUSIC_LISTENING_PROFILE_KEY,
  MUSIC_LISTENING_PROFILE_CHANGED_EVENT,
  readMusicListeningProfile,
  type MusicListeningProfile,
} from "@/lib/music-listening-profile";
import {
  MusicOriginalTracks,
  MusicUploadPanel,
  STOP_ORIGINAL_EVENT,
  type PublicTrack,
} from "@/components/music-upload-panel";
import {
  MUSIC_PLAYER_PLAY_EVENT,
  MUSIC_FAVORITES_CHANGED_EVENT,
  clearPersistentMusicQueue,
  enqueueNextPersistentMusic,
  playPersistentMusic,
  setPersistentMusicQueue,
  stopPersistentMusic,
  type PersistentMusicTrack,
} from "@/lib/music-player-events";

const SAVED_WORKS_KEY = "music.playlist";
const FAVORITES_KEY = "music.favorites";
const PLAYLISTS_KEY = "music.playlists";
const LISTEN_LATER_KEY = "music.listen-later";
const HIDDEN_WORKS_KEY = "music.recommendations.hidden";
const REDUCED_ARTISTS_KEY = "music.recommendations.reduced-artists";
const AUTO_PLAYABLE_PROVIDERS = new Set<MusicProvider>(["youtube"]);
const ORIGINAL_TRACK_PREFIX = "music:";
const MUSIC_DISPLAY_BATCH_SIZE = 20;
const MUSIC_API_PAGE_SIZE = 20;
const MAX_PUBLIC_MUSIC_WORKS = 5_000;

/*
 * What a work is called under its title. It used to be the genre path; the
 * genre tree is gone, so it is the first couple of tags — which carry the
 * same information and then some.
 */
function workTagLabel(work: MusicWork): string {
  const tags = (work.tags ?? []).slice(0, 2);
  return tags.length ? `${tags.join(" · ")} · ` : "";
}

function originalPlaylistKey(trackId: string) {
  return `${ORIGINAL_TRACK_PREFIX}${trackId}`;
}

function originalTrackId(value: string) {
  return value.startsWith(ORIGINAL_TRACK_PREFIX) ? value.slice(ORIGINAL_TRACK_PREFIX.length) : null;
}

function queueStartingAt(entryIds: string[], currentEntryId: string): string[] {
  const currentIndex = entryIds.indexOf(currentEntryId);
  if (currentIndex <= 0) return entryIds;
  return [...entryIds.slice(currentIndex), ...entryIds.slice(0, currentIndex)];
}

type MusicMetadata = {
  sourceUrl: string;
  providerLabel: string;
  title?: string;
  artist?: string;
};
type MusicPlaylistView = {
  id: string;
  title: string;
  description: string;
  workIds: string[];
};

function Artwork({ work, large = false }: { work: MusicWork; large?: boolean }) {
  const artworkUrl = musicWorkArtworkUrl(work);
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => setImageFailed(false), [artworkUrl]);
  return <div className={`music-artwork${large ? " music-artwork--large" : ""}`} style={{ "--music-accent": work.accent } as React.CSSProperties}>
    {artworkUrl && !imageFailed ? <img src={artworkUrl} alt={`${musicDisplayTitle(work.title)}のアートワーク`} loading={large ? "eager" : "lazy"} decoding="async" referrerPolicy="no-referrer" onError={() => setImageFailed(true)} /> : null}
    <span aria-hidden="true">{work.symbol}</span><small>HUB MUSIC</small>
  </div>;
}

export function MusicDiscovery({
  initialWorks = MUSIC_WORKS,
  initialTagFacets = [],
  initialCommunityCount = 0,
  initialCommunityTotal = 0,
  initialQuery = "",
  initialTags = [],
  initialPlaylist,
  initialPlaylists = [],
  initialFavoriteIds,
  authenticated = false,
}: {
  initialWorks?: MusicWork[];
  initialTagFacets?: MusicTagFacet[];
  initialCommunityCount?: number;
  initialCommunityTotal?: number;
  initialQuery?: string;
  initialTags?: string[];
  initialPlaylist?: MusicPlaylistView;
  initialPlaylists?: MusicPlaylistView[];
  initialFavoriteIds?: string[];
  authenticated?: boolean;
}) {
  const providedPlaylists = initialPlaylists.length ? initialPlaylists : initialPlaylist ? [initialPlaylist] : [];
  const defaultLocalPlaylist: MusicPlaylistView = { id: "local-default", title: "マイプレイリスト", description: "", workIds: [] };
  const fullPlaybackWorks = rankMusicWorks(canonicalizeMusicWorks(initialWorks).filter(hasHubFullPlaybackSource).slice(0, MAX_PUBLIC_MUSIC_WORKS));
  const [works, setWorks] = useState(fullPlaybackWorks);
  const [categoryWorks, setCategoryWorks] = useState<MusicWork[] | null>(null);
  const [communityOffset, setCommunityOffset] = useState(initialCommunityCount);
  const [communityLoading, setCommunityLoading] = useState(false);
  const [communityError, setCommunityError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [activeService, setActiveService] = useState<MusicServiceLink | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [searchInput, setSearchInput] = useState(initialQuery);
  const [directoryQuery, setDirectoryQuery] = useState("");
  /*
   * Tags replaced the genre tree. A work already carried its genre, its
   * decade, its language and its tempo as separate tags, so one axis with
   * many values reaches more of the catalogue than two nested ones did.
   */
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTags);
  /* How the server read the question: literal words, catalogue tags, or meaning. */
  const [queryReading, setQueryReading] = useState<{ matchedBy: "words" | "tags" | "meaning"; matchedTags: string[] } | null>(null);

  const [visibleWorkCount, setVisibleWorkCount] = useState(MUSIC_DISPLAY_BATCH_SIZE);
  const [favoriteIds, setFavoriteIds] = useState<string[]>(initialFavoriteIds ?? initialPlaylist?.workIds ?? []);
  const [listenLaterIds, setListenLaterIds] = useState<string[]>([]);
  const [hiddenWorkIds, setHiddenWorkIds] = useState<string[]>([]);
  const [reducedArtists, setReducedArtists] = useState<string[]>([]);
  const [playlists, setPlaylists] = useState<MusicPlaylistView[]>(providedPlaylists.length ? providedPlaylists : authenticated ? [] : [defaultLocalPlaylist]);
  const [activePlaylistId, setActivePlaylistId] = useState(providedPlaylists[0]?.id ?? (authenticated ? "" : defaultLocalPlaylist.id));
  const [playlistMessage, setPlaylistMessage] = useState("");
  const [playlistBusy, setPlaylistBusy] = useState(false);
  const [draggedPlaylistKey, setDraggedPlaylistKey] = useState("");
  const [dragOverPlaylistKey, setDragOverPlaylistKey] = useState("");
  const [continuousPlay, setContinuousPlay] = useState(false);
  const [playbackQueue, setPlaybackQueue] = useState<string[]>([]);
  const [playbackMessage, setPlaybackMessage] = useState("");
  const [originalTracks, setOriginalTracks] = useState<PublicTrack[]>([]);
  const [activeOriginalTrackId, setActiveOriginalTrackId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [metadataMessage, setMetadataMessage] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [reportMessage, setReportMessage] = useState("");
  const [urlImportOpen, setUrlImportOpen] = useState(false);
  const [listeningProfile, setListeningProfile] = useState<MusicListeningProfile>(EMPTY_MUSIC_LISTENING_PROFILE);
  const [recommendationProfile, setRecommendationProfile] = useState<MusicListeningProfile>(EMPTY_MUSIC_LISTENING_PROFILE);
  const [libraryView, setLibraryView] = useState<"recommended" | "popular" | "latest" | "genre">("latest");
  const metadataTimerRef = useRef<number | null>(null);
  const metadataRequestRef = useRef(0);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (authenticated) return;
    try {
      const legacy = JSON.parse(window.localStorage.getItem(SAVED_WORKS_KEY) ?? "[]") as unknown;
      const storedFavorites = JSON.parse(window.localStorage.getItem(FAVORITES_KEY) ?? "null") as unknown;
      const storedPlaylists = JSON.parse(window.localStorage.getItem(PLAYLISTS_KEY) ?? "null") as unknown;
      const legacyIds = Array.isArray(legacy) ? legacy.filter((id): id is string => typeof id === "string") : [];
      if (Array.isArray(storedFavorites)) setFavoriteIds(storedFavorites.filter((id): id is string => typeof id === "string"));
      else if (legacyIds.length) setFavoriteIds(legacyIds);
      if (Array.isArray(storedPlaylists) && storedPlaylists.length) {
        const localPlaylists = storedPlaylists.filter((item): item is MusicPlaylistView => Boolean(item)
          && typeof item === "object"
          && typeof Reflect.get(item, "id") === "string"
          && typeof Reflect.get(item, "title") === "string"
          && Array.isArray(Reflect.get(item, "workIds")));
        if (localPlaylists.length) {
          setPlaylists(localPlaylists);
          setActivePlaylistId(localPlaylists[0].id);
        }
      } else if (legacyIds.length) {
        const migrated = { ...defaultLocalPlaylist, workIds: legacyIds };
        setPlaylists([migrated]);
        setActivePlaylistId(migrated.id);
      }
    } catch { /* preferences are optional */ }
  }, [authenticated]);

  useEffect(() => {
    const readStoredIds = (key: string) => {
      try {
        const value = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      } catch { return []; }
    };
    setListenLaterIds(readStoredIds(LISTEN_LATER_KEY));
    setHiddenWorkIds([...new Set([...readStoredIds(HIDDEN_WORKS_KEY), ...readStoredIds("music.player.unavailable")])]);
    setReducedArtists(readStoredIds(REDUCED_ARTISTS_KEY));
  }, []);

  useEffect(() => {
    const initialProfile = readMusicListeningProfile();
    setListeningProfile(initialProfile);
    setRecommendationProfile(initialProfile);
    const syncProfile = (event: Event) => setListeningProfile((event as CustomEvent<MusicListeningProfile>).detail);
    window.addEventListener(MUSIC_LISTENING_PROFILE_CHANGED_EVENT, syncProfile);
    return () => window.removeEventListener(MUSIC_LISTENING_PROFILE_CHANGED_EVENT, syncProfile);
  }, []);

  useEffect(() => {
    const sharedIds = (new URL(window.location.href).searchParams.get("playlist") ?? "")
      .split(",")
      .filter((id) => /^[A-Za-z0-9:_-]{1,160}$/u.test(id))
      .filter((id, index, all) => all.indexOf(id) === index)
      .filter((id) => {
        const trackId = originalTrackId(id);
        return trackId
          ? /^[0-9a-f]{8}-[0-9a-f-]{27,}$/iu.test(trackId) && originalTracks.some((track) => track.id === trackId)
          : works.some((work) => work.id === id);
      })
      .slice(0, 40);
    if (!sharedIds.length) return;
    const sharedPlaylist = { id: "shared-link", title: "共有プレイリスト", description: "共有リンクから読み込みました。", workIds: sharedIds };
    setPlaylists((current) => [sharedPlaylist, ...current.filter((playlist) => playlist.id !== sharedPlaylist.id)]);
    setActivePlaylistId(sharedPlaylist.id);
  }, [originalTracks, works]);

  useEffect(() => {
    const syncFavorites = (event: Event) => {
      const next = (event as CustomEvent<string[]>).detail;
      if (Array.isArray(next)) setFavoriteIds(next);
    };
    window.addEventListener(MUSIC_FAVORITES_CHANGED_EVENT, syncFavorites);
    return () => window.removeEventListener(MUSIC_FAVORITES_CHANGED_EVENT, syncFavorites);
  }, []);

  useEffect(() => () => {
    if (metadataTimerRef.current !== null) window.clearTimeout(metadataTimerRef.current);
    metadataRequestRef.current += 1;
  }, []);

  useEffect(() => {
    const requested = new URL(window.location.href).searchParams.get("work");
    if (requested && works.some((work) => work.id === requested)) setSelectedId(requested);
  }, [works]);

  const genreRankedWorks = useMemo(() => rankMusicWorks([...works]), [works]);
  /*
   * Facets come from the server so the counts describe the whole catalogue,
   * not the hundred works this screen happens to be holding.
   */
  const tagFacets = useMemo(() => {
    if (initialTagFacets.length) return initialTagFacets;
    const counts = new Map<string, number>();
    for (const work of initialWorks) for (const tag of work.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts].map(([tag, count]) => ({ tag, count })).sort((left, right) => right.count - left.count);
  }, [initialTagFacets, initialWorks]);
  const visibleTagFacets = useMemo(() => {
    const needle = directoryQuery.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
    if (!needle) return tagFacets;
    return tagFacets.filter((facet) => facet.tag.toLocaleLowerCase("ja-JP").includes(needle));
  }, [directoryQuery, tagFacets]);
  /*
   * One string for both axes, so a saved view restores what was actually on
   * screen. URLSearchParams rather than a homemade separator: a tag may
   * contain anything, including whatever separator would have been chosen.
   */
  const savedViewValue = useMemo(() => {
    const parameters = new URLSearchParams();
    const term = query.trim();
    if (term) parameters.set("q", term);
    for (const tag of selectedTags) parameters.append("tag", tag);
    return parameters.toString() || "すべて";
  }, [query, selectedTags]);

  const applySavedView = useCallback((value: string) => {
    if (value === "すべて") {
      setSelectedTags([]);
      setQuery("");
      setSearchInput("");
      return;
    }
    const parameters = new URLSearchParams(value);
    const term = parameters.get("q") ?? "";
    setSelectedTags(parameters.getAll("tag").slice(0, 8));
    setQuery(term);
    setSearchInput(term);
  }, []);

  const toggleTag = useCallback((tag: string) => {
    setSelectedTags((current) => current.includes(tag)
      ? current.filter((item) => item !== tag)
      : [...current, tag].slice(0, 8));
  }, []);
  /*
   * Tags and the search box both re-ask the server rather than filtering what
   * is loaded. The screen holds at most a hundred works out of more than a
   * thousand, so filtering in place answers from a sample and calls it the
   * catalogue — a song that exists gets reported as not found.
   */
  useEffect(() => {
    const term = query.trim();
    if (!selectedTags.length && !term) {
      setCategoryWorks(null);
      setQueryReading(null);
      return;
    }
    setCategoryWorks([]);
    const controller = new AbortController();
    const parameters = new URLSearchParams({ limit: "60", offset: "0" });
    for (const tag of selectedTags) parameters.append("tag", tag);
    if (term) parameters.set("q", term);
    /* Typing should not send a request per keystroke. */
    const timer = setTimeout(() => {
      void fetch(`/api/music?${parameters.toString()}`, { cache: "no-store", signal: controller.signal })
        .then((response) => response.ok ? response.json() as Promise<{ works?: MusicWork[]; matchedBy?: "words" | "tags" | "meaning"; matchedTags?: string[] }> : Promise.reject(new Error("music_query_failed")))
        .then((payload) => {
          setCategoryWorks(canonicalizeMusicWorks(payload.works ?? []).filter(hasHubFullPlaybackSource));
          setQueryReading(term ? { matchedBy: payload.matchedBy ?? "words", matchedTags: payload.matchedTags ?? [] } : null);
        })
        .catch((error: unknown) => { if (!(error instanceof DOMException && error.name === "AbortError")) { setCategoryWorks([]); setQueryReading(null); } });
    }, term ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, selectedTags]);
  const filterSourceWorks = categoryWorks ?? works;
  /*
   * When the server answered by tags or by meaning, the works do not contain
   * the question as literal text — that is the whole point of those paths.
   * Re-applying the substring filter here hid every one of them: 「80年代の
   * ロック」 came back with six works and the screen showed none.
   */
  const serverReadBeyondWords = categoryWorks !== null && queryReading !== null && queryReading.matchedBy !== "words";
  const filtered = useMemo(() => {
    /*
     * Normalized the way the server normalizes, so a work it matched is not
     * then hidden here over a width or composition difference.
     */
    const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja-JP");
    return filterSourceWorks.filter((work) => {
      if (hiddenWorkIds.includes(work.id)) return false;
      if (!normalized || serverReadBeyondWords) return true;
      return `${work.title} ${work.artist} ${musicAlbumLabel(work)} ${(work.tags ?? []).join(" ")}`
        .normalize("NFKC").toLocaleLowerCase("ja-JP").includes(normalized);
    });
  }, [filterSourceWorks, hiddenWorkIds, query, serverReadBeyondWords]);
  const favoriteGenres = new Set(works.filter((work) => favoriteIds.includes(work.id)).map((work) => musicGenreCategoryLabel(work.genre)));
  const musicPersonalizationActive = favoriteGenres.size > 0 || recommendationProfile.history.length > 0;
  useEffect(() => {
    if (musicPersonalizationActive) setLibraryView((current) => current === "latest" ? "recommended" : current);
  }, [musicPersonalizationActive]);
  const personalizedFiltered = [...filtered].sort((left, right) => {
    const affinity = (work: MusicWork) => Number(favoriteGenres.has(musicGenreCategoryLabel(work.genre))) * 20
      + Math.min(recommendationProfile.genrePlays[work.genre] ?? 0, 12) * 2
      + (work.tagSignals?.length ? work.tagSignals : (work.tags ?? []).map((tag) => ({ tag, confidence: .5 }))).reduce((score, signal) =>
        score + Math.min(recommendationProfile.tagPlays[signal.tag] ?? 0, 10) * signal.confidence
          - Math.min(recommendationProfile.tagSkips[signal.tag] ?? 0, 8) * signal.confidence * 1.5, 0)
      + Math.min(recommendationProfile.plays[work.id] ?? 0, 5)
      - Math.min(recommendationProfile.skips[work.id] ?? 0, 5) * 8
      - (reducedArtists.includes(work.artist) ? 50 : 0);
    return affinity(right) - affinity(left);
  });
  const orderedFiltered = libraryView === "recommended" && musicPersonalizationActive
    ? personalizedFiltered
    : libraryView === "popular"
      ? rankMusicWorks([...filtered])
    : libraryView === "latest"
      ? [...filtered].sort((left, right) => right.year - left.year)
      : filtered;
  const displayedWorkCount = !query.trim() && selectedTags.length === 0 && categoryWorks === null
    ? Math.max(initialCommunityTotal, filtered.length)
    : filtered.length;
  const visibleFiltered = orderedFiltered.slice(0, visibleWorkCount);
  useEffect(() => setVisibleWorkCount(MUSIC_DISPLAY_BATCH_SIZE), [query, selectedTags]);
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (visibleWorkCount < filtered.length) {
        setVisibleWorkCount((count) => Math.min(count + MUSIC_DISPLAY_BATCH_SIZE, filtered.length));
        return;
      }
      if (categoryWorks !== null || works.length >= MAX_PUBLIC_MUSIC_WORKS || communityLoading || communityError || communityOffset >= initialCommunityTotal) return;
      setCommunityLoading(true);
      void fetch(`/api/music?limit=${MUSIC_API_PAGE_SIZE}&offset=${communityOffset}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error("music_page_failed")))
        .then((payload: { works?: MusicWork[]; nextOffset?: number; total?: number }) => {
          const incoming = payload.works ?? [];
          const nextOffset = payload.nextOffset ?? Math.min(communityOffset + incoming.length, initialCommunityTotal);
          if (!Array.isArray(incoming) || !Number.isSafeInteger(nextOffset) || nextOffset < 0 || (nextOffset <= communityOffset && communityOffset < (payload.total ?? initialCommunityTotal))) throw new Error("Invalid music continuation");
          setWorks((current) => canonicalizeMusicWorks([...current, ...incoming]).filter(hasHubFullPlaybackSource).slice(0, MAX_PUBLIC_MUSIC_WORKS));
          setCommunityOffset(nextOffset);
          setCommunityError(false);
          setVisibleWorkCount((count) => count + MUSIC_DISPLAY_BATCH_SIZE);
        })
        .catch(() => setCommunityError(true))
        .finally(() => setCommunityLoading(false));
    }, { rootMargin: "400px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [categoryWorks, communityLoading, communityError, communityOffset, filtered.length, initialCommunityTotal, visibleWorkCount, works.length]);

  const selected = works.find((work) => work.id === selectedId) ?? works[0];
  const hasSelectedWork = Boolean(selectedId && works.some((work) => work.id === selectedId));
  const activePlaylist = playlists.find((playlist) => playlist.id === activePlaylistId) ?? playlists[0];
  const saved = activePlaylist?.workIds ?? [];
  const playlistId = activePlaylist?.id ?? "";
  const playlistTitle = activePlaylist?.title ?? "プレイリストを選択";
  const favoriteOriginalTrackIds = favoriteIds.map(originalTrackId).filter((id): id is string => Boolean(id));
  const favoriteEntries = favoriteIds.map((key) => {
    const trackId = originalTrackId(key);
    if (trackId) {
      const track = originalTracks.find((item) => item.id === trackId);
      return track ? { key, title: track.title, artist: track.artist, kind: "original" as const, track } : null;
    }
    const work = works.find((item) => item.id === key);
      return work ? { key, title: musicDisplayTitle(work.title), artist: work.artist, kind: "external" as const, work } : null;
  }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const savedEntries = saved.map((key) => {
    const trackId = originalTrackId(key);
    if (trackId) {
      const track = originalTracks.find((item) => item.id === trackId);
      return track ? { key, title: track.title, artist: track.artist, kind: "original" as const, track } : null;
    }
    const work = works.find((item) => item.id === key);
    return work ? { key, title: musicDisplayTitle(work.title), artist: work.artist, kind: "external" as const, work } : null;
  }).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const historyWorks = listeningProfile.history.map((entry) => works.find((work) => work.id === entry.id)).filter((work): work is MusicWork => Boolean(work)).slice(0, 10);

  const playableServiceFor = useCallback((work: MusicWork) => {
    const supported = work.services.filter((service) => service.embedUrl && AUTO_PLAYABLE_PROVIDERS.has(service.provider));
    return supported[0] ?? null;
  }, []);
  const externalPersistentTrack = useCallback((work: MusicWork, service: MusicServiceLink, autoplay = true): PersistentMusicTrack => ({
      id: work.id,
      title: musicDisplayTitle(work.title),
      artist: work.artist,
      genre: work.genre,
      tags: work.tags,
      provider: service.provider,
      providerLabel: service.label,
      artworkUrl: musicWorkArtworkUrl(work),
      embedUrl: service.embedUrl,
      externalUrl: service.url,
      autoplay,
  }), []);
  const playExternalTrack = useCallback((work: MusicWork, service: MusicServiceLink, autoplay = true) => {
    playPersistentMusic(externalPersistentTrack(work, service, autoplay));
  }, [externalPersistentTrack]);
  const originalPersistentTrack = useCallback((track: PublicTrack): PersistentMusicTrack => ({
    id: originalPlaylistKey(track.id),
    title: track.title,
    artist: track.artist,
    genre: "Hub Music",
    provider: "hub",
    providerLabel: "Hub Music",
    audioUrl: `/music/api/tracks/${encodeURIComponent(track.id)}/audio`,
    autoplay: true,
  }), []);
  const playOriginalTrack = useCallback((track: PublicTrack) => {
    playPersistentMusic(originalPersistentTrack(track));
  }, [originalPersistentTrack]);
  const persistentTrackForEntry = useCallback((entryId: string): PersistentMusicTrack | null => {
    const trackId = originalTrackId(entryId);
    if (trackId) {
      const track = originalTracks.find((item) => item.id === trackId);
      return track ? originalPersistentTrack(track) : null;
    }
    const work = works.find((item) => item.id === entryId);
    if (!work) return null;
    const service = playableServiceFor(work);
    return service ? externalPersistentTrack(work, service) : null;
  }, [externalPersistentTrack, originalPersistentTrack, originalTracks, playableServiceFor, works]);
  const configurePersistentQueue = useCallback((entryIds: string[], currentEntryId: string) => {
    const tracks = entryIds.map(persistentTrackForEntry).filter((item): item is PersistentMusicTrack => Boolean(item));
    setPersistentMusicQueue(tracks, currentEntryId);
  }, [persistentTrackForEntry]);
  const updateSelectedWork = useCallback((work: MusicWork) => {
    setSelectedId(work.id);
    const url = new URL(window.location.href);
    url.searchParams.set("work", work.id);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);

  useEffect(() => {
    const syncPlayingTrack = (event: Event) => {
      const playingTrack = (event as CustomEvent<PersistentMusicTrack>).detail;
      if (!playingTrack?.id) return;
      const trackId = originalTrackId(playingTrack.id);
      if (trackId) {
        setActiveOriginalTrackId(trackId);
        setActiveService(null);
        setPlaybackMessage(`${playingTrack.title}をHub Musicで再生します。`);
        return;
      }
      const work = works.find((item) => item.id === playingTrack.id);
      if (!work) return;
      const service = work.services.find((item) => item.provider === playingTrack.provider && item.embedUrl === playingTrack.embedUrl)
        ?? playableServiceFor(work);
      window.dispatchEvent(new Event(STOP_ORIGINAL_EVENT));
      setActiveOriginalTrackId("");
      updateSelectedWork(work);
      setActiveService(service);
      setPlaybackMessage(`${musicDisplayTitle(work.title)}を${playingTrack.providerLabel}で再生します。`);
    };
    window.addEventListener(MUSIC_PLAYER_PLAY_EVENT, syncPlayingTrack);
    return () => window.removeEventListener(MUSIC_PLAYER_PLAY_EVENT, syncPlayingTrack);
  }, [playableServiceFor, updateSelectedWork, works]);

  const selectWork = (work: MusicWork) => {
    window.dispatchEvent(new Event(STOP_ORIGINAL_EVENT));
    clearPersistentMusicQueue();
    setActiveOriginalTrackId("");
    updateSelectedWork(work);
    setActiveService(null);
    setContinuousPlay(false);
    setPlaybackQueue([]);
    setPlaybackMessage("");
  };

  const playWorkInHub = (work: MusicWork) => {
    const service = playableServiceFor(work);
    if (!service) {
      selectWork(work);
      setPlaybackMessage("この作品は外部サイトでのみ再生できます。");
      return;
    }
    window.dispatchEvent(new Event(STOP_ORIGINAL_EVENT));
    setActiveOriginalTrackId("");
    updateSelectedWork(work);
    setActiveService(service);
    const queue = buildMusicPlaybackQueue([...filtered, ...works], { startId: work.id, favoriteIds, seed: work.id, ...listeningProfile }).map((item) => item.id);
    setPlaybackQueue(queue);
    setContinuousPlay(true);
    configurePersistentQueue(queue, work.id);
    playExternalTrack(work, service);
    setPlaybackMessage(`${musicDisplayTitle(work.title)}を${service.label}でHub内再生します。`);
  };

  const queueWorkNext = (work: MusicWork) => {
    const service = playableServiceFor(work);
    if (!service) return;
    enqueueNextPersistentMusic(externalPersistentTrack(work, service, true));
    setPlaybackMessage(`${musicDisplayTitle(work.title)}を次に再生します。`);
  };

  const startContinuousPlayback = () => {
    const service = playableServiceFor(selected);
    if (!service) {
      setPlaybackMessage("この作品にはHub内で再生できる配信先がありません。");
      return;
    }
    const queue = buildMusicPlaybackQueue([...filtered, ...works], { startId: selected.id, favoriteIds, seed: selected.id, ...listeningProfile }).map((work) => work.id);
    setPlaybackQueue(queue);
    window.dispatchEvent(new Event(STOP_ORIGINAL_EVENT));
    setActiveOriginalTrackId("");
    setContinuousPlay(true);
    setPlaybackMessage("同じジャンルと再生傾向を優先してラジオ再生します。");
    setActiveService(service);
    configurePersistentQueue(queue, selected.id);
    playExternalTrack(selected, service);
  };

  const stopContinuousPlayback = () => {
    setContinuousPlay(false);
    setPlaybackQueue([]);
    clearPersistentMusicQueue();
    setPlaybackMessage("連続再生を停止しました。現在のプレイヤーはそのまま操作できます。");
  };

  const activatePlaybackEntry = useCallback((entryId: string): boolean => {
    const trackId = originalTrackId(entryId);
    if (trackId) {
      const track = originalTracks.find((item) => item.id === trackId);
      if (!track) return false;
      setActiveOriginalTrackId(track.id);
      setActiveService(null);
      playOriginalTrack(track);
      setPlaybackMessage(`${track.title}をHub Musicで再生します。`);
      return true;
    }
    const work = works.find((item) => item.id === entryId);
    if (!work) return false;
    const service = playableServiceFor(work);
    if (!service) return false;
    window.dispatchEvent(new Event(STOP_ORIGINAL_EVENT));
    setActiveOriginalTrackId("");
    updateSelectedWork(work);
    setActiveService(service);
    playExternalTrack(work, service);
    setPlaybackMessage(`${musicDisplayTitle(work.title)}を${service.label}で再生します。`);
    return true;
  }, [originalTracks, playExternalTrack, playOriginalTrack, playableServiceFor, updateSelectedWork, works]);

  const advanceQueue = useCallback(() => {
    if (!continuousPlay) return;
    const queue = playbackQueue.length ? playbackQueue : filtered.map((work) => work.id);
    const currentEntryId = activeOriginalTrackId ? originalPlaylistKey(activeOriginalTrackId) : selected.id;
    const currentIndex = queue.indexOf(currentEntryId);
    for (let index = currentIndex + 1; index < queue.length; index += 1) {
      if (activatePlaybackEntry(queue[index])) return;
    }
    setContinuousPlay(false);
    setPlaybackQueue([]);
    setPlaybackMessage("プレイリストの最後まで再生しました。");
  }, [activatePlaybackEntry, activeOriginalTrackId, continuousPlay, filtered, playbackQueue, selected.id]);

  const retreatQueue = useCallback(() => {
    if (!continuousPlay) return;
    const queue = playbackQueue.length ? playbackQueue : filtered.map((work) => work.id);
    const currentEntryId = activeOriginalTrackId ? originalPlaylistKey(activeOriginalTrackId) : selected.id;
    const currentIndex = queue.indexOf(currentEntryId);
    for (let index = currentIndex - 1; index >= 0; index -= 1) {
      if (activatePlaybackEntry(queue[index])) return;
    }
    setPlaybackMessage("再生キューの先頭です。");
  }, [activatePlaybackEntry, activeOriginalTrackId, continuousPlay, filtered, playbackQueue, selected.id]);

  const storeLocalPlaylists = (next: MusicPlaylistView[]) => {
    try { window.localStorage.setItem(PLAYLISTS_KEY, JSON.stringify(next)); } catch { /* preferences are optional */ }
  };

  const updatePlaylistState = (targetId: string, update: (playlist: MusicPlaylistView) => MusicPlaylistView) => {
    setPlaylists((current) => {
      const next = current.map((playlist) => playlist.id === targetId ? update(playlist) : playlist);
      if (!authenticated) storeLocalPlaylists(next);
      return next;
    });
  };

  const persistPlaylistItems = async (targetId: string, workIds: string[]) => {
    updatePlaylistState(targetId, (playlist) => ({ ...playlist, workIds }));
    if (!authenticated) {
      setPlaylistMessage("この端末に保存しました。ログインするとアカウントへ同期できます。");
      return;
    }
    setPlaylistBusy(true);
    setPlaylistMessage("プレイリストを保存中…");
    try {
      const response = await fetch(`/api/music/playlists/${encodeURIComponent(targetId)}/items`, { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ workIds }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "プレイリストを保存できませんでした。");
      setPlaylistMessage("アカウントに保存しました。");
    } catch (error) {
      setPlaylistMessage(error instanceof Error ? error.message : "プレイリストを保存できませんでした。");
    } finally { setPlaylistBusy(false); }
  };

  const createPlaylistRecord = async (title: string): Promise<MusicPlaylistView | null> => {
    setPlaylistBusy(true);
    try {
      let playlist: MusicPlaylistView;
      if (authenticated) {
        const response = await fetch("/api/music/playlists", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, description: "" }) });
        const result = await response.json() as { playlist?: MusicPlaylistView; error?: string };
        if (!response.ok || !result.playlist) throw new Error(result.error ?? "プレイリストを作成できませんでした。");
        playlist = result.playlist;
      } else {
        playlist = { id: `local-${crypto.randomUUID()}`, title, description: "", workIds: [] };
      }
      setPlaylists((current) => {
        const next = [...current, playlist];
        if (!authenticated) storeLocalPlaylists(next);
        return next;
      });
      setActivePlaylistId(playlist.id);
      setPlaylistMessage(`「${playlist.title}」を作成しました。`);
      return playlist;
    } catch (error) {
      setPlaylistMessage(error instanceof Error ? error.message : "プレイリストを作成できませんでした。");
      return null;
    } finally { setPlaylistBusy(false); }
  };

  const createPlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = String(new FormData(form).get("newPlaylistTitle") ?? "").normalize("NFKC").trim();
    if (!title || title.length > 80) { setPlaylistMessage("プレイリスト名を1〜80文字で入力してください。"); return; }
    if (await createPlaylistRecord(title)) form.reset();
  };

  const setAndPersistPlaylist = (next: string[]) => {
    if (!playlistId) return;
    void persistPlaylistItems(playlistId, next);
  };

  const persistFavorites = (next: string[]) => {
    setFavoriteIds(next);
    try { window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(next)); } catch { /* preferences are optional */ }
    window.dispatchEvent(new CustomEvent<string[]>(MUSIC_FAVORITES_CHANGED_EVENT, { detail: next }));
    if (!authenticated) return;
    void fetch("/api/music/favorites", {
      method: "PUT",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workIds: next }),
    }).then(async (response) => {
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "お気に入りを保存できませんでした。");
    }).catch((error) => setPlaylistMessage(error instanceof Error ? error.message : "お気に入りを保存できませんでした。"));
  };

  const toggleFavorite = (id: string) => {
    const next = favoriteIds.includes(id) ? favoriteIds.filter((item) => item !== id) : [...favoriteIds, id];
    persistFavorites(next);
  };

  const toggleListenLater = (id: string) => {
    const next = listenLaterIds.includes(id) ? listenLaterIds.filter((item) => item !== id) : [...listenLaterIds, id];
    setListenLaterIds(next);
    window.localStorage.setItem(LISTEN_LATER_KEY, JSON.stringify(next));
  };

  const hideRecommendation = (id: string) => {
    const next = [...new Set([...hiddenWorkIds, id])];
    setHiddenWorkIds(next);
    window.localStorage.setItem(HIDDEN_WORKS_KEY, JSON.stringify(next));
    setSelectedId("");
  };

  const reduceArtist = (artist: string) => {
    const next = reducedArtists.includes(artist) ? reducedArtists.filter((item) => item !== artist) : [...reducedArtists, artist];
    setReducedArtists(next);
    window.localStorage.setItem(REDUCED_ARTISTS_KEY, JSON.stringify(next));
  };

  const reportWork = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setReportMessage("送信しています…");
    const response = await fetch("/api/music/reports", { method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workId: selected.id, reason: data.get("reason"), details: data.get("details") }) });
    const result = await response.json().catch(() => ({})) as { error?: string };
    setReportMessage(response.ok ? "通報を受け付けました。" : result.error ?? "通報を送信できませんでした。");
    if (response.ok) form.reset();
  };

  const addToActivePlaylist = async (id: string) => {
    const target = activePlaylist ?? await createPlaylistRecord("マイプレイリスト");
    if (!target) return;
    if (target.workIds.includes(id)) {
      setPlaylistMessage(`「${target.title}」には追加済みです。`);
      return;
    }
    await persistPlaylistItems(target.id, [...target.workIds, id]);
    setPlaylistMessage(`「${target.title}」へ追加しました。`);
  };

  const removeFromActivePlaylist = (id: string) => {
    if (!activePlaylist) return;
    void persistPlaylistItems(activePlaylist.id, activePlaylist.workIds.filter((item) => item !== id));
  };

  const movePlaylistItem = (id: string, direction: -1 | 1) => {
    const index = saved.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= saved.length) return;
    const next = [...saved];
    [next[index], next[target]] = [next[target], next[index]];
    setAndPersistPlaylist(next);
  };

  const dropPlaylistItem = (targetId: string, transferredId = "") => {
    const sourceId = draggedPlaylistKey || transferredId;
    setDraggedPlaylistKey("");
    setDragOverPlaylistKey("");
    if (!sourceId || sourceId === targetId) return;
    const sourceIndex = saved.indexOf(sourceId);
    const targetIndex = saved.indexOf(targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const next = [...saved];
    const [moved] = next.splice(sourceIndex, 1);
    next.splice(targetIndex, 0, moved);
    setAndPersistPlaylist(next);
    setPlaylistMessage("ドラッグした曲順を保存しました。");
  };

  const renamePlaylist = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextTitle = String(new FormData(event.currentTarget).get("playlistTitle") ?? "").normalize("NFKC").trim();
    if (!nextTitle || nextTitle.length > 80) { setPlaylistMessage("プレイリスト名を1〜80文字で入力してください。"); return; }
    if (!playlistId) return;
    updatePlaylistState(playlistId, (playlist) => ({ ...playlist, title: nextTitle }));
    if (!authenticated) { setPlaylistMessage("プレイリスト名を変更しました。"); return; }
    setPlaylistBusy(true);
    try {
      const response = await fetch(`/api/music/playlists/${encodeURIComponent(playlistId)}`, { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: nextTitle, description: "" }) });
      if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "名前を変更できませんでした。");
      setPlaylistMessage("プレイリスト名を変更しました。");
    } catch (error) { setPlaylistMessage(error instanceof Error ? error.message : "名前を変更できませんでした。"); }
    finally { setPlaylistBusy(false); }
  };

  const deletePlaylist = async () => {
    if (!activePlaylist || !window.confirm(`「${activePlaylist.title}」を削除しますか？`)) return;
    setPlaylistBusy(true);
    try {
      if (authenticated) {
        const response = await fetch(`/api/music/playlists/${encodeURIComponent(activePlaylist.id)}`, { method: "DELETE", credentials: "same-origin" });
        if (!response.ok) throw new Error((await response.json() as { error?: string }).error ?? "プレイリストを削除できませんでした。");
      }
      setPlaylists((current) => {
        const next = current.filter((playlist) => playlist.id !== activePlaylist.id);
        if (!authenticated) storeLocalPlaylists(next);
        setActivePlaylistId(next[0]?.id ?? "");
        return next;
      });
      setPlaylistMessage("プレイリストを削除しました。");
    } catch (error) {
      setPlaylistMessage(error instanceof Error ? error.message : "プレイリストを削除できませんでした。");
    } finally { setPlaylistBusy(false); }
  };

  const startSavedPlaylist = () => {
    if (!savedEntries.length) {
      setPlaybackMessage("曲をプレイリストへ追加してください。");
      return;
    }
    const first = savedEntries.find((entry) => entry.kind === "original" || playableServiceFor(entry.work));
    const queue = savedEntries.map((entry) => entry.key);
    if (!first) {
      setPlaybackMessage("マイプレイリストにサイト内再生できる作品がありません。");
      return;
    }
    configurePersistentQueue(queue, first.key);
    if (!activatePlaybackEntry(first.key)) {
      setPlaybackMessage("マイプレイリストにサイト内再生できる作品がありません。");
      return;
    }
    setPlaybackQueue(queue);
    setContinuousPlay(true);
    setPlaybackMessage("Hub音源と外部メディアをプレイリスト順に連続再生します。");
  };

  const clearSavedPlaylist = () => {
    if (!savedEntries.length || !window.confirm(`「${playlistTitle}」の曲をすべて削除しますか？`)) return;
    setAndPersistPlaylist([]);
    setPlaylistMessage("マイプレイリストを空にしました。");
  };

  const fillMetadataFromUrls = useCallback(async (form: HTMLFormElement, rawValue: string) => {
    const urls = rawValue.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 6);
    const requestId = ++metadataRequestRef.current;
    if (!urls.length) {
      setMetadataMessage("");
      return;
    }
    setMetadataMessage("URLから作品情報を取得中…");
    const results = await Promise.all(urls.map(async (sourceUrl) => {
      try {
        const response = await fetch("/api/music/metadata", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourceUrl }),
        });
        const result = await response.json() as { metadata?: MusicMetadata; error?: string };
        return {
          metadata: response.ok && result.metadata ? result.metadata : null,
          error: response.ok ? undefined : result.error,
          sourceUrl,
        };
      } catch {
        return { metadata: null, error: "作品情報を取得できませんでした。", sourceUrl };
      }
    }));
    if (requestId !== metadataRequestRef.current) return;

    const metadata = results.map((item) => item.metadata).filter((item): item is MusicMetadata => Boolean(item));
    const validationError = results.find((item) => item.error)?.error;
    if (validationError) {
      setMetadataMessage(validationError);
      return;
    }
    if (!metadata.length) {
      setMetadataMessage("情報を取得できませんでした。対応サービスの作品URLか確認してください。");
      return;
    }
    const title = metadata.find((item) => item.title)?.title;
    const artist = metadata.find((item) => item.artist)?.artist;
    const titleField = form.elements.namedItem("title") as HTMLInputElement | null;
    const artistField = form.elements.namedItem("artist") as HTMLInputElement | null;
    const genreField = form.elements.namedItem("genre") as HTMLInputElement | null;
    const descriptionField = form.elements.namedItem("description") as HTMLTextAreaElement | null;
    const urlField = form.elements.namedItem("serviceUrls") as HTMLTextAreaElement | null;
    if (title && titleField && !titleField.value.trim()) titleField.value = title;
    if (artist && artistField && !artistField.value.trim()) artistField.value = artist;
    if (genreField && !genreField.value.trim()) genreField.value = "未分類";
    if (descriptionField && !descriptionField.value.trim()) descriptionField.value = `${metadata[0].providerLabel}の公式配信ページから登録された作品です。`;
    if (urlField) urlField.value = results.map((item) => item.metadata?.sourceUrl ?? item.sourceUrl).join("\n");
    const services = Array.from(new Set(metadata.map((item) => item.providerLabel))).join("・");
    const duplicate = title && artist ? works.find((work) => work.title.normalize("NFKC").toLocaleLowerCase("ja-JP") === title.normalize("NFKC").toLocaleLowerCase("ja-JP") && work.artist.normalize("NFKC").toLocaleLowerCase("ja-JP") === artist.normalize("NFKC").toLocaleLowerCase("ja-JP")) : undefined;
    if (duplicate) {
      setMetadataMessage(`曲名・アーティスト情報を自動入力しました。「${duplicate.title}」はすでに登録されているため、既存の曲も確認してください。`);
      return;
    }
    setMetadataMessage(title || artist
      ? `${services}から曲名・アーティスト情報を自動入力しました。音楽判定は登録時に行います。`
      : `${services}のURLを確認しました。音楽判定は登録時に行います。取得できない項目だけ入力してください。`);
  }, [works]);

  const scheduleMetadataLookup = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (metadataTimerRef.current !== null) window.clearTimeout(metadataTimerRef.current);
    const form = event.currentTarget.form;
    const value = event.currentTarget.value;
    if (!form) return;
    const urls = value.split(/\r?\n/u).map((item) => item.trim()).filter(Boolean);
    if (urls.length > 1) {
      metadataRequestRef.current += 1;
      setMetadataMessage(urls.length > 50 ? "一度にインポートできるのは50件までです。" : `${urls.length}件を50件単位のインポートとして処理します。`);
      return;
    }
    metadataTimerRef.current = window.setTimeout(() => void fillMetadataFromUrls(form, value), 500);
  };

  const submitWork = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmitMessage("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const serviceUrls = String(data.get("serviceUrls") ?? "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    if (serviceUrls.length > 50) {
      setSubmitMessage("一度にインポートできるのは50件までです。");
      setSubmitting(false);
      return;
    }
    const payload = {
      title: String(data.get("title") ?? ""), artist: String(data.get("artist") ?? ""),
      description: String(data.get("description") ?? ""), genre: String(data.get("genre") ?? ""),
      tags: String(data.get("tags") ?? "").split(/[、,]/u).map((item) => item.trim()).filter(Boolean),
      year: Number(data.get("year")), serviceUrls,
    };
    try {
      if (serviceUrls.length > 1) {
        const imported: MusicWork[] = [];
        const failed: string[] = [];
        for (let offset = 0; offset < serviceUrls.length; offset += 5) {
          const batch = serviceUrls.slice(offset, offset + 5);
          const results = await Promise.all(batch.map(async (sourceUrl) => {
            try {
              const metadataResponse = await fetch("/api/music/metadata", {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sourceUrl }),
              });
              const metadataResult = await metadataResponse.json() as { metadata?: MusicMetadata; error?: string };
              if (!metadataResponse.ok || !metadataResult.metadata?.title || !metadataResult.metadata.artist) throw new Error(metadataResult.error ?? "曲情報を取得できませんでした。");
              const metadata = metadataResult.metadata;
              const response = await fetch("/api/music", {
                method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
                body: JSON.stringify({
                  title: metadata.title,
                  artist: metadata.artist,
                  description: `${metadata.providerLabel}の公開音楽作品です。`,
                  genre: "未分類",
                  tags: payload.tags,
                  year: payload.year,
                  serviceUrls: [metadata.sourceUrl],
                }),
              });
              const result = await response.json() as { work?: MusicWork; error?: string };
              if (!response.ok || !result.work) throw new Error(result.error ?? "追加できませんでした。");
              return { work: canonicalizeMusicWork(result.work), sourceUrl };
            } catch (error) {
              return { error: error instanceof Error ? error.message : "追加できませんでした。", sourceUrl };
            }
          }));
          for (const result of results) {
            if ("work" in result && result.work && hasHubFullPlaybackSource(result.work)) imported.push(result.work);
            else failed.push(result.sourceUrl);
          }
          setSubmitMessage(`${Math.min(offset + batch.length, serviceUrls.length)} / ${serviceUrls.length}件を処理しました。`);
        }
        if (imported.length) {
          setWorks((current) => rankMusicWorks(canonicalizeMusicWorks([...imported, ...current])).slice(0, MAX_PUBLIC_MUSIC_WORKS));
          selectWork(imported[0]);
        }
        form.reset();
        setSubmitMessage(`${imported.length}件を追加しました${failed.length ? `。${failed.length}件は追加できませんでした` : ""}。`);
        return;
      }
      const response = await fetch("/api/music", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json() as { work?: MusicWork; error?: string };
      if (!response.ok || !result.work) throw new Error(result.error ?? "作品を追加できませんでした。");
      const normalizedWork = canonicalizeMusicWork(result.work);
      if (!hasHubFullPlaybackSource(normalizedWork)) throw new Error("サイト内で再生できるYouTubeまたはYouTube MusicのURLが必要です。");
      setWorks((current) => rankMusicWorks(canonicalizeMusicWorks([normalizedWork, ...current])).slice(0, MAX_PUBLIC_MUSIC_WORKS));
      selectWork(normalizedWork);
      form.reset();
      setSubmitMessage("作品を追加しました。共有リンクをポストやコミュニティで使えます。");
    } catch (error) { setSubmitMessage(error instanceof Error ? error.message : "作品を追加できませんでした。"); }
    finally { setSubmitting(false); }
  };

  const copyShareLink = async () => {
    if (!selected) return;
    const url = new URL("/music", window.location.origin);
    url.searchParams.set("work", selected.id);
    try { await navigator.clipboard.writeText(url.toString()); setShareMessage("作品リンクをコピーしました。"); }
    catch { setShareMessage(url.toString()); }
  };

  const copyPlaylistShareLink = async () => {
    if (!savedEntries.length) return;
    const url = new URL("/music", window.location.origin);
    const shareableIds = savedEntries.map((entry) => entry.key).filter((id) => {
      const trackId = originalTrackId(id);
      return trackId ? originalTracks.some((track) => track.id === trackId) : works.some((work) => work.id === id);
    }).slice(0, 40);
    if (!shareableIds.length) { setPlaylistMessage("公開済みの曲がないため共有できません。"); return; }
    url.searchParams.set("playlist", shareableIds.join(","));
    try { await navigator.clipboard.writeText(url.toString()); setPlaylistMessage("プレイリストの共有リンクをコピーしました。"); }
    catch { setPlaylistMessage(url.toString()); }
  };

  const clearListeningHistory = () => {
    try { window.localStorage.removeItem(MUSIC_LISTENING_PROFILE_KEY); } catch { /* preferences are optional */ }
    setListeningProfile(EMPTY_MUSIC_LISTENING_PROFILE);
    setRecommendationProfile(EMPTY_MUSIC_LISTENING_PROFILE);
  };

  const openMusicAddPanel = (panelId: string) => {
    const panel = document.getElementById(panelId);
    if (!(panel instanceof HTMLDetailsElement)) return;
    panel.open = true;
  };

  const toggleMusicImportPanel = () => {
    const panel = document.getElementById("music-url-panel");
    if (!(panel instanceof HTMLDetailsElement)) return;
    panel.open = !panel.open;
    setUrlImportOpen(panel.open);
  };

  if (!selected) return <section className="music-page"><p className="music-empty">作品がまだありません。</p></section>;

  return <section className={`music-page${hasSelectedWork ? " has-selected-work" : ""}`}>
    <header className="music-header">
      <div className="music-title"><h1>音楽</h1></div>
      <form className="music-search" action="/music" method="get" role="search">
        <span aria-hidden="true">⌕</span>
        {selectedTags.map((tag) => <input key={tag} type="hidden" name="tag" value={tag} />)}

        <input name="q" type="search" list="music-search-suggestions" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder={`${selectedTags.length ? selectedTags.join("・") : "すべての音楽"}から曲名・アーティスト・アルバムを検索`} aria-label={`${selectedTags.length ? selectedTags.join("・") : "すべての音楽"}を検索`} />
        <datalist id="music-search-suggestions">{[...new Set(works.flatMap((work) => [work.title, work.artist, musicAlbumLabel(work), ...(work.tags ?? [])]))].slice(0, 80).map((item) => <option key={item} value={item} />)}</datalist>
        {searchInput ? <button type="button" onClick={() => setSearchInput("")} aria-label="検索をクリア">×</button> : null}
      </form>
      <div className="music-header-actions">
        <details className="music-header-menu music-header-library-menu">
          <summary>マイ音楽</summary>
          <div><a href="/music/library">ライブラリ</a><a href="/music/history">再生履歴</a><a href="/lists?tab=playlists">プレイリスト</a></div>
        </details>
        <details className="music-header-menu music-header-add-menu">
          <summary>曲を追加</summary>
          <div><button type="button" aria-expanded={urlImportOpen} aria-controls="music-url-panel" onClick={toggleMusicImportPanel}>URLから追加</button><button type="button" onClick={() => openMusicAddPanel("music-upload-panel")}>音源をアップロード</button><a href="/music/studio">制作スタジオ</a></div>
        </details>
      </div>
    </header>

    {query.trim() && queryReading && queryReading.matchedBy !== "words" ? (
      <p className="music-query-reading" role="status">
        <span>読み取り:</span>
        {queryReading.matchedTags.map((tag) => (
          <button type="button" key={tag} onClick={() => { setLibraryView("genre"); toggleTag(tag); setQuery(""); setSearchInput(""); }}>{tag}</button>
        ))}
        <small>{queryReading.matchedBy === "meaning" ? "質問の意味で探しました" : "タグで絞り込み、意味の近い順に並べています"}</small>
      </p>
    ) : null}

    <MusicOriginalTracks
      delegatePlayback
      externalActive={Boolean(activeService)}
      onEnded={advanceQueue}
      onNext={advanceQueue}
      onPrevious={retreatQueue}
      onTracksLoaded={setOriginalTracks}
      savedTrackIds={favoriteOriginalTrackIds}
      onToggleSaved={(trackId) => toggleFavorite(originalPlaylistKey(trackId))}
      onSelectTrack={(trackId) => {
        const track = originalTracks.find((item) => item.id === trackId);
        if (!track) return;
        const queue = originalTracks.map((item) => originalPlaylistKey(item.id));
        setPlaybackQueue(queue);
        configurePersistentQueue(queue, originalPlaylistKey(trackId));
        setActiveOriginalTrackId(trackId);
        setActiveService(null);
        setContinuousPlay(true);
        playOriginalTrack(track);
        setPlaybackMessage(`${track.title}からHub音源を連続再生します。`);
      }}
    />

    <MusicUploadPanel />

    <section className="music-favorites music-history" aria-labelledby="music-history-title" hidden={!historyWorks.length}>
      <header>
        <div><small>RECENTLY PLAYED</small><h2 id="music-history-title">最近聴いた曲<span>{historyWorks.length}曲</span></h2><p>この端末で再生した曲を、新しい順に表示します。</p></div>
        <details className="music-history-actions">
          <summary>詳細</summary>
          <button type="button" onClick={clearListeningHistory}>履歴を消去</button>
        </details>
      </header>
      <ol>{historyWorks.map((work) => <li key={work.id}>
        <button type="button" className="music-favorite-track" onClick={() => playWorkInHub(work)}>
          <div className="music-favorite-artwork"><Artwork work={work} /><i aria-hidden="true">▶</i></div>
          <span><small>{workTagLabel(work)}{work.year}</small><strong>{musicDisplayTitle(work.title)}</strong><b>{work.artist}</b></span>
        </button>
        <div className="music-favorite-actions"><button type="button" onClick={() => toggleFavorite(work.id)} aria-label={`${musicDisplayTitle(work.title)}をお気に入りに追加`}>{favoriteIds.includes(work.id) ? "♥" : "♡"}</button></div>
      </li>)}</ol>
    </section>

    <section className="music-favorites" aria-labelledby="music-favorites-title" hidden={!favoriteEntries.length}>
      <header>
        <div><small>FAVORITES</small><h2 id="music-favorites-title">お気に入り<span>{favoriteEntries.length}曲</span></h2><p>ハートした曲だけをまとめます。プレイリストとは別に保存されます。</p></div>
      </header>
      {favoriteEntries.length ? <ol>{favoriteEntries.map((entry, index) => <li key={entry.key}>
        <button type="button" className="music-favorite-track" onClick={() => {
          const queue = queueStartingAt(favoriteEntries.map((item) => item.key), entry.key);
          configurePersistentQueue(queue, entry.key);
          if (!activatePlaybackEntry(entry.key)) return;
          setPlaybackQueue(queue);
          setContinuousPlay(true);
          setPlaybackMessage(`${entry.title}からお気に入りを再生します。`);
        }}>
          <div className="music-favorite-artwork">
            {entry.kind === "original"
              ? <span className="music-artwork music-my-playlist-original-artwork"><span aria-hidden="true">♫</span><small>HUB MUSIC</small></span>
              : <Artwork work={entry.work} />}
            <i aria-hidden="true">▶</i>
          </div>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <span><strong>{entry.title}</strong><small>{entry.artist}</small></span>
        </button>
        <div className="music-favorite-actions">
          <button type="button" onClick={() => void addToActivePlaylist(entry.key)} disabled={playlistBusy}>＋</button>
          <button type="button" onClick={() => toggleFavorite(entry.key)} aria-label={`${entry.title}のお気に入りを解除`}>♥</button>
        </div>
      </li>)}</ol> : <p className="music-favorites-empty">曲一覧の♡を押すと、お気に入りへ追加されます。</p>}
    </section>

    <section id="music-playlists" className="music-my-playlist" aria-labelledby="music-my-playlist-title" hidden={!savedEntries.length}>
      <header>
        <div className="music-my-playlist-heading">
          <small>PLAYLISTS</small>
          <div><select value={activePlaylist?.id ?? ""} onChange={(event) => setActivePlaylistId(event.currentTarget.value)} aria-label="プレイリストを選択" disabled={!playlists.length || playlistBusy}>
            {!playlists.length ? <option value="">プレイリストなし</option> : playlists.map((playlist) => <option key={playlist.id} value={playlist.id}>{playlist.title}（{playlist.workIds.length}曲）</option>)}
          </select><h2 id="music-my-playlist-title">{playlistTitle}<span className="music-my-playlist-count">{savedEntries.length}曲</span></h2></div>
          <p>複数作成して、曲順・シャッフル・連続再生を個別に管理できます。</p>
        </div>
        <div className="music-my-playlist-actions">
          <a className="music-list-hub-link" href="/lists?tab=playlists">リストで見る</a>
          <button type="button" onClick={continuousPlay && playbackQueue.length ? stopContinuousPlayback : startSavedPlaylist} disabled={!savedEntries.length || playlistBusy}>
            {continuousPlay && playbackQueue.length ? "停止" : "先頭から再生"}
          </button>
          <details className="music-playlist-more"><summary aria-label="プレイリスト管理">…</summary><div>
            <form onSubmit={createPlaylist}><input name="newPlaylistTitle" placeholder="新しいプレイリスト名" maxLength={80} aria-label="新しいプレイリスト名" disabled={playlistBusy} /><button type="submit" disabled={playlistBusy}>新規作成</button></form>
            {activePlaylist ? <form key={activePlaylist.id} onSubmit={renamePlaylist}><input name="playlistTitle" defaultValue={playlistTitle} maxLength={80} aria-label="プレイリスト名" disabled={playlistBusy} /><button type="submit" disabled={playlistBusy}>名前変更</button></form> : null}
            <button type="button" onClick={() => void copyPlaylistShareLink()} disabled={!savedEntries.length || playlistBusy}>共有</button>
            <button type="button" className="is-danger" onClick={clearSavedPlaylist} disabled={!savedEntries.length || playlistBusy}>全削除</button>
            <button type="button" className="is-danger" onClick={() => void deletePlaylist()} disabled={!activePlaylist || playlistBusy}>プレイリスト削除</button>
          </div></details>
        </div>
      </header>
      {savedEntries.length ? <ol>{savedEntries.map((entry, index) => <li
        key={entry.key}
        className={`${(activeOriginalTrackId ? originalPlaylistKey(activeOriginalTrackId) : selected.id) === entry.key && continuousPlay ? "is-playing" : ""}${dragOverPlaylistKey === entry.key && draggedPlaylistKey !== entry.key ? " is-drag-over" : ""}`}
        onDragOver={(event) => {
          if (!draggedPlaylistKey || draggedPlaylistKey === entry.key) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDragOverPlaylistKey(entry.key);
        }}
        onDragLeave={() => setDragOverPlaylistKey((current) => current === entry.key ? "" : current)}
        onDrop={(event) => {
          event.preventDefault();
          dropPlaylistItem(entry.key, event.dataTransfer.getData("text/plain"));
        }}
      >
        <button type="button" className="music-my-playlist-track" onClick={() => {
          const queue = queueStartingAt(savedEntries.map((item) => item.key), entry.key);
          configurePersistentQueue(queue, entry.key);
          if (!activatePlaybackEntry(entry.key)) { setPlaybackMessage("この作品は外部サービスでのみ再生できます。"); return; }
          setPlaybackQueue(queue);
          setContinuousPlay(true);
          setPlaybackMessage(`${entry.title}から統合プレイリストを再生します。`);
        }}>
          <div className="music-my-playlist-artwork">
            {entry.kind === "original"
              ? <span className="music-artwork music-my-playlist-original-artwork"><span aria-hidden="true">♫</span><small>HUB MUSIC</small></span>
              : <Artwork work={entry.work} />}
            <i aria-hidden="true">▶</i>
          </div>
          <span className="music-my-playlist-copy">
            <small>{entry.kind === "original" ? "Hub Music" : `$${workTagLabel(entry.work)}${entry.work.year}`}</small>
            <strong>{entry.title}</strong>
            <b>{entry.artist}</b>
          </span>
        </button>
        <div className="music-my-playlist-order">
          <button type="button" className="music-my-playlist-favorite" onClick={() => toggleFavorite(entry.key)} aria-label={favoriteIds.includes(entry.key) ? `${entry.title}のお気に入りを解除` : `${entry.title}をお気に入りに追加`} aria-pressed={favoriteIds.includes(entry.key)}>{favoriteIds.includes(entry.key) ? "♥" : "♡"}</button>
          <span
            className="music-my-playlist-drag"
            draggable={!playlistBusy}
            role="button"
            tabIndex={0}
            aria-label={`${entry.title}をドラッグして並べ替え`}
            onDragStart={(event) => {
              setDraggedPlaylistKey(entry.key);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", entry.key);
            }}
            onDragEnd={() => {
              setDraggedPlaylistKey("");
              setDragOverPlaylistKey("");
            }}
          >⠿</span>
          <button type="button" onClick={() => movePlaylistItem(entry.key, -1)} disabled={index === 0 || playlistBusy} aria-label={`${entry.title}を上へ移動`}>↑</button>
          <button type="button" onClick={() => movePlaylistItem(entry.key, 1)} disabled={index === savedEntries.length - 1 || playlistBusy} aria-label={`${entry.title}を下へ移動`}>↓</button>
          <button type="button" className="music-my-playlist-remove" onClick={() => removeFromActivePlaylist(entry.key)} disabled={playlistBusy} aria-label={`${entry.title}をプレイリストから削除`}>×</button>
        </div>
      </li>)}</ol> : <p className="music-my-playlist-empty">曲を選び「プレイリストに追加」を押すと、ここへ追加されます。</p>}
      {playlistMessage ? <p className="music-my-playlist-message" role="status">{playlistMessage}</p> : null}
    </section>

    <details id="music-url-panel" className="music-submit music-add-panel music-add-modal" onToggle={(event) => setUrlImportOpen(event.currentTarget.open)} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.open = false; }} onKeyDown={(event) => { if (event.key === "Escape") event.currentTarget.open = false; }}>
      <summary>
        <div><small>配信サービス</small><h2>URLから曲を追加</h2><span>YouTube／YouTube Musicから曲情報を自動取得</span></div>
        <b aria-hidden="true">＋</b>
      </summary>
      <div className="music-add-panel__body">
        <div className="music-submit-intro"><h3>曲のURLを貼り付ける</h3><p>曲名、アーティスト、ジャンルなどはURLから自動取得します。</p></div>
        {authenticated ? <form onSubmit={submitWork}>
        <input name="title" type="hidden" />
        <input name="artist" type="hidden" />
        <input name="genre" type="hidden" />
        <input name="year" type="hidden" defaultValue={new Date().getFullYear()} />
        <input name="description" type="hidden" />
        <label><span>タグ（任意）</span><input name="tags" maxLength={240} placeholder="夜、ドライブ、落ち着く" /></label>
        <label><span>曲のURL（最大50件・1行に1件）</span><textarea name="serviceUrls" rows={5} placeholder={"https://music.youtube.com/watch?v=...\nhttps://www.youtube.com/watch?v=..."} required disabled={submitting} onChange={scheduleMetadataLookup} /></label>
        {metadataMessage ? <p className="music-metadata-status" role="status">{metadataMessage}</p> : null}
        <button type="submit" disabled={submitting}>{submitting ? "確認中…" : "追加"}</button>
        </form> : <p className="music-submit-login"><a href="/auth">ログイン</a>すると作品と配信先を登録できます。</p>}
        {submitMessage ? <p className="music-submit-message" role="status">{submitMessage}</p> : null}
      </div>
    </details>

    {hasSelectedWork ? <section className="music-feature" aria-labelledby="music-selected-title">
      <button type="button" className="music-feature-artwork-play" onClick={() => playWorkInHub(selected)} aria-label={`${musicDisplayTitle(selected.title)}を画像から再生`}>
        <Artwork work={selected} large />
        <span aria-hidden="true">▶</span>
      </button>
      <div className="music-feature-copy">
        <small>{workTagLabel(selected)}{selected.year}{selected.submittedBy ? ` · ${selected.submittedBy}が登録` : ""}</small>
        <h2 id="music-selected-title">{musicDisplayTitle(selected.title)}</h2>
        <a className="music-feature-artist" href={`/music/artists/${encodeURIComponent(selected.artist)}`}>{selected.artist}</a>
        <a className="music-feature-album" href={`/music/albums/${encodeURIComponent(musicAlbumLabel(selected))}?artist=${encodeURIComponent(selected.artist)}`}>{musicAlbumLabel(selected)}</a>
        <p>{selected.description}</p>
        {selected.tags?.length ? <div className="music-work-tags" aria-label="曲のタグ">
          {selected.tags.map((tag) => <button type="button" key={tag} onClick={() => { setQuery(tag); setSearchInput(tag); }}>{tag}</button>)}
        </div> : null}
        <div className="music-feature-actions">
          <button type="button" className={`music-playlist-toggle${saved.includes(selected.id) ? " is-saved" : ""}`} onClick={() => saved.includes(selected.id) ? removeFromActivePlaylist(selected.id) : void addToActivePlaylist(selected.id)} aria-pressed={saved.includes(selected.id)}>{saved.includes(selected.id) ? "選択中のプレイリストから削除" : "プレイリストに追加"}</button>
          <button type="button" className="music-share-button" onClick={copyShareLink}>共有リンク</button>
          <button type="button" className={`music-queue-button${continuousPlay ? " is-active" : ""}`} onClick={continuousPlay ? stopContinuousPlayback : startContinuousPlayback} aria-pressed={continuousPlay}>{continuousPlay ? "ラジオを停止" : "ラジオ再生"}</button>
          <button type="button" onClick={() => toggleListenLater(selected.id)} aria-pressed={listenLaterIds.includes(selected.id)}>{listenLaterIds.includes(selected.id) ? "あとで聴くから削除" : "あとで聴く"}</button>
          <button type="button" onClick={() => hideRecommendation(selected.id)}>興味なし</button>
          <button type="button" onClick={() => reduceArtist(selected.artist)} aria-pressed={reducedArtists.includes(selected.artist)}>{reducedArtists.includes(selected.artist) ? "減らす設定を解除" : "このアーティストを減らす"}</button>
        </div>
        <details className="music-work-report"><summary>作品情報を報告</summary><form onSubmit={reportWork}>
          <label><span>理由</span><select name="reason" defaultValue="wrong_metadata"><option value="wrong_metadata">作品情報が違う</option><option value="unavailable">再生できない</option><option value="duplicate">重複している</option><option value="not_music">音楽ではない</option><option value="rights">権利上の問題</option><option value="other">その他</option></select></label>
          <label><span>詳細（任意）</span><textarea name="details" maxLength={1000} /></label><button type="submit">送信</button>
        </form></details>
        {reportMessage ? <small className="music-share-message" role="status">{reportMessage}</small> : null}
        {shareMessage ? <small className="music-share-message" role="status">{shareMessage}</small> : null}
      </div>
    </section> : null}

    {activeService?.embedUrl ? <section className="music-player" aria-label={`${activeService.label}プレイヤー`}>
      <header><div><small>{continuousPlay ? "AUTO PLAY · ON" : "NOW LISTENING"}</small><b>{musicDisplayTitle(selected.title)} — {selected.artist}</b></div><button type="button" onClick={() => { stopPersistentMusic(); clearPersistentMusicQueue(); setActiveService(null); setContinuousPlay(false); setPlaybackQueue([]); setPlaybackMessage(""); }}>再生を停止</button></header>
      <p className="music-player-message">右下のミニプレーヤーで再生中です。Hub内の別タブへ移動しても再生は続きます。</p>
      {playbackMessage ? <p className="music-player-message" role="status">{playbackMessage}</p> : null}
      <a href={activeService.url} target="_blank" rel="noopener noreferrer">{activeService.label}で開く <span aria-hidden="true">↗</span></a>
    </section> : <details className="music-privacy-note"><summary>外部サービスから再生</summary><span>再生するまで外部プレイヤーを読み込みません。音源はHubへ保存せず、選択したサービスの公式プレイヤーから再生します。</span></details>}


    <section className="music-library" aria-labelledby="music-library-title">
      <div className="music-library-content tab-left-column-layout">
      <aside data-hub-page-left-column className="music-library-directory bbs-thread-directory tab-left-column" aria-label="音楽ディレクトリ">
        <header className="bbs-thread-directory__header tab-left-column__header"><div><strong>音楽</strong></div></header>
        <label className="bbs-thread-directory__search">
          <span className="sr-only">タグを探す</span>
          <div>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></svg>
            <input type="search" value={directoryQuery} onChange={(event) => setDirectoryQuery(event.target.value)} placeholder="タグを検索" aria-label="タグを検索" />
            {directoryQuery ? <button type="button" onClick={() => setDirectoryQuery("")} aria-label="タグ検索を消去">×</button> : null}
          </div>
        </label>
        <nav className="bbs-thread-directory__nav" aria-label="曲の並び順">
          {musicPersonalizationActive ? <button type="button" className={libraryView === "recommended" ? "is-active" : ""} onClick={() => { setLibraryView("recommended"); setSelectedTags([]); }}>おすすめ</button> : null}
          <button type="button" className={libraryView === "popular" ? "is-active" : ""} onClick={() => { setLibraryView("popular"); setSelectedTags([]); }}>人気</button>
          <button type="button" className={libraryView === "latest" ? "is-active" : ""} onClick={() => { setLibraryView("latest"); setSelectedTags([]); }}>新着</button>
          {selectedTags.length ? <button type="button" onClick={() => setSelectedTags([])}>タグを外す</button> : null}
        </nav>
        <div className="music-library-directory__genres bbs-thread-directory__groups">
          {visibleTagFacets.slice(0, 60).map((facet) => <button type="button" key={facet.tag} className={selectedTags.includes(facet.tag) ? "is-active" : ""} onClick={() => { setLibraryView("genre"); toggleTag(facet.tag); setQuery(""); setSearchInput(""); }}><span>{facet.tag}</span><small>{facet.count}</small></button>)}





          {directoryQuery && !visibleTagFacets.length ? <p className="bbs-thread-directory__empty">一致するタグがありません。</p> : null}
        </div>
      </aside>
      <div className="music-library-results tab-left-column-main">
      <nav className="video-discovery-tabs music-discovery-tabs" aria-label="音楽の表示">
        {musicPersonalizationActive ? <button type="button" className={libraryView === "recommended" ? "video-discovery-tab--active" : ""} aria-pressed={libraryView === "recommended"} onClick={() => setLibraryView("recommended")}>おすすめ</button> : null}
        <button type="button" className={libraryView === "popular" ? "video-discovery-tab--active" : ""} aria-pressed={libraryView === "popular"} onClick={() => setLibraryView("popular")}>人気</button>
        <button type="button" className={libraryView === "latest" ? "video-discovery-tab--active" : ""} aria-pressed={libraryView === "latest"} onClick={() => setLibraryView("latest")}>新着</button>
        <button type="button" className={libraryView === "genre" ? "video-discovery-tab--active" : ""} aria-pressed={libraryView === "genre"} onClick={() => setLibraryView("genre")}>タグ</button>
      </nav>
      <header><h2 id="music-library-title">{libraryView === "recommended" ? "おすすめの曲" : libraryView === "popular" ? "人気の曲" : libraryView === "latest" ? "新着の曲" : "タグから探す"}</h2><span>{displayedWorkCount.toLocaleString("ja-JP")}曲</span></header>
      {/*
        * A saved view is the tags and the term together, since either alone
        * leaves out half of what the reader chose. Both are asked of the
        * server now, so a saved view means the same thing on any device.
        */}
      <SavedQueryTabs
        surface="music"
        currentValue={savedViewValue}
        onApply={applySavedView}
      />
      <HorizontalScrollRail className="music-genres-shell" viewportClassName="music-genres" label="音楽のタグ">
        <button type="button" className={selectedTags.length ? "" : "is-active"} onClick={() => setSelectedTags([])}>すべて</button>
        {[...selectedTags.map((tag) => ({ tag, count: tagFacets.find((facet) => facet.tag === tag)?.count ?? 0 })),
          ...tagFacets.filter((facet) => !selectedTags.includes(facet.tag)).slice(0, 40)]
          .map((facet) => <button type="button" key={facet.tag} className={selectedTags.includes(facet.tag) ? "is-active" : ""} onClick={() => toggleTag(facet.tag)}>{facet.tag}</button>)}
      </HorizontalScrollRail>









      {filtered.length ? <div className="music-grid">{visibleFiltered.map((work) => {
        return <article key={work.id} className={`music-card${selectedId === work.id ? " is-selected" : ""}`}>
          <button className="music-card-artwork-play" type="button" onClick={() => playWorkInHub(work)} aria-label={`${musicDisplayTitle(work.title)}を画像から再生`}>
            <Artwork work={work} />
            <span aria-hidden="true">▶</span>
          </button>
          <div className="music-card-body">
            <button className="music-card-main" type="button" onClick={() => selectWork(work)}><span><small>{workTagLabel(work)}{work.year}</small><strong>{musicDisplayTitle(work.title)}</strong></span></button>
            <a className="music-card-artist" href={`/music/artists/${encodeURIComponent(work.artist)}`}>{work.artist}</a>
          </div>
          <footer>
            <details className="music-card-more"><summary aria-label={`${musicDisplayTitle(work.title)}の操作`}>…</summary><div><button type="button" onClick={() => queueWorkNext(work)}>次に再生</button><button type="button" onClick={() => void addToActivePlaylist(work.id)}>プレイリストに追加</button></div></details>
            <button type="button" onClick={() => toggleFavorite(work.id)} aria-label={favoriteIds.includes(work.id) ? `${musicDisplayTitle(work.title)}のお気に入りを解除` : `${musicDisplayTitle(work.title)}をお気に入りに追加`} aria-pressed={favoriteIds.includes(work.id)}>{favoriteIds.includes(work.id) ? "♥" : "♡"}</button>
          </footer>
        </article>;
      })}</div> : <div className="music-empty"><b>作品が見つかりませんでした</b><p>検索語やジャンルを変更してください。</p><button type="button" onClick={() => { setQuery(""); setSearchInput(""); setSelectedTags([]); }}>条件をリセット</button></div>}
      {communityError ? <p role="alert">続きを読み込めませんでした。<button type="button" onClick={() => setCommunityError(false)}>もう一度読み込む</button></p> : null}
      {visibleFiltered.length < filtered.length || (categoryWorks === null && works.length < MAX_PUBLIC_MUSIC_WORKS && communityOffset < initialCommunityTotal) ? <div ref={loadMoreSentinelRef} className="music-scroll-sentinel" aria-hidden="true" /> : null}
      </div>
      </div>
    </section>

    <aside className="music-boundary"><b>これは外部音楽サービスをまとめる公開カタログです。</b><span>Hubは音源ファイル、音楽サービスのログイン情報、契約情報を保存しません。各サービスの利用条件が適用されます。</span></aside>
  </section>;
}
