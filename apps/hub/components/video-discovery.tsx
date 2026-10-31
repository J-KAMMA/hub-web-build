"use client";

import {
  Fragment,
  type FormEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  personalizeVideos,
  readVideoHistory,
} from "@/lib/video-personalization";
import {
  HUB_INTEREST_PROFILE_CHANGED_EVENT,
  readHubInterestProfile,
  recordHubInterests,
  scoreHubInterestText,
  topHubInterests,
} from "@/lib/hub-interest-profile";
import { staticDemoServedAd } from "@/components/static-demo-ad";
import { FirstPartyAdSlot } from "@/components/first-party-ad-slot";
import { CrossProviderVideoPlayer } from "@/components/cross-provider-video-player";
import { NativeVideoPlayer } from "@/components/native-video-player";
import { VideoReportPicker } from "@/components/video-report-picker";
import { revokeYouTubeEmbedConsent } from "@/components/youtube-embed-consent";
import { classifyVideoBroadcastStatus, videoBroadcastLabel } from "@/lib/video-broadcast-status";
import { VideoThread } from "@/components/video-thread";
import { HorizontalScrollRail } from "@/components/horizontal-scroll-rail";
import { shouldInsertRecurringAd } from "@/lib/ad-insertion-schedule";
import type { VideoThreadComment } from "@/lib/server/d1-video-thread-comments";
import { isVerticalVideo } from "@/lib/video-display-format";
import { V2AccessGateAttachToggle } from "@/components/v2/v2-access-gate-attach";
import { applyAccessGate } from "@/components/v2/v2-access-gate-shared";
import { useCategoryAccordion } from "@/lib/use-category-accordion";
import {
  personalizeShortVideos,
  readShortPreferenceProfile,
  recordShortChannelDismissal,
  recordShortOutcome,
  type ShortPreferenceProfile,
} from "@/lib/video-short-personalization";

export const VIDEO_PROVIDERS = [
  "youtube",
  "vimeo",
  "twitch",
  "niconico",
  "tiktok",
  "dailymotion",
  "peertube",
  "hub",
] as const;
export type VideoProvider = (typeof VIDEO_PROVIDERS)[number];

const VIDEO_CATALOG_BATCH_SIZE = 30;
const MAX_LOADED_DISCOVERY_VIDEOS = 100;
const MAX_RELATED_VIDEO_RESULTS = 12;

export const VIDEO_PURPOSES = [
  "guide",
  "explanation",
  "live",
  "review",
  "creation",
  "music",
  "other",
] as const;
export type VideoPurpose = (typeof VIDEO_PURPOSES)[number];

export type PublicVideoEntry = {
  id: string;
  title: string;
  channel: string;
  category: string;
  purpose: VideoPurpose;
  topic: string;
  relatedHubpediaSlug?: string | null;
  provider: VideoProvider;
  sourceUrl: string;
  thumbnailUrl?: string | null;
  duration?: string | null;
  publishedAt?: string | null;
  submittedByDisplayName?: string | null;
  createdAt: string;
  viewCount?: number;
  safetyLevel?: "standard" | "sensitive" | "adult" | "medical" | "political";
  safetyNotice?: string;
  availabilityStatus?: "unknown" | "available" | "unavailable";
  broadcastStatus?: "video" | "live" | "upcoming" | "archive";
  metadataCheckedAt?: string | null;
};

type VideoDiscoveryProps = {
  beforeContent?: ReactNode;
  initialVideos: PublicVideoEntry[];
  initialTotal?: number;
  initialCatalogOffset?: number;
  authenticated: boolean;
  initialOpenVideoId?: string;
  persistableVideoIds?: string[];
  adFirstAfterItem?: number;
};

type VideoSearchCandidate = {
  provider: VideoProvider;
  sourceUrl: string;
  title: string;
  channel: string;
  thumbnailUrl?: string | null;
  publishedAt?: string | null;
};

type VideoPlaylist = {
  id: string;
  title: string;
  description?: string | null;
  videoIds?: string[];
};

function relatedVideoCandidates(videos: PublicVideoEntry[], current: PublicVideoEntry) {
  return videos
    .filter((video) => video.id !== current.id && isShortVideo(video) === isShortVideo(current))
    .sort((left, right) =>
      Number(right.topic === current.topic) - Number(left.topic === current.topic)
      || Number(right.channel === current.channel) - Number(left.channel === current.channel),
    )
    .slice(0, MAX_RELATED_VIDEO_RESULTS);
}

type DiscoveryMode = "popular" | "rising" | "recent" | "shorts" | "saved";

type RankedVideo = PublicVideoEntry & { saveCount?: number };
type VideoActivity = { videoId: string; positionSeconds: number; durationSeconds: number; volume: number; muted: boolean; completed: boolean; hidden: boolean; lastViewedAt?: string };

type HubTrendingPayload = {
  popular: RankedVideo[];
  rising: RankedVideo[];
  recent: RankedVideo[];
};

function ScrollableVideoCategories({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <HorizontalScrollRail className="music-genres-shell video-category-shell" viewportClassName="music-genres" label={label}>{children}</HorizontalScrollRail>
  );
}

const PROVIDER_LABELS: Record<VideoProvider, string> = {
  youtube: "YouTube",
  vimeo: "Vimeo",
  twitch: "Twitch",
  niconico: "ニコニコ動画",
  tiktok: "TikTok",
  dailymotion: "Dailymotion",
  peertube: "PeerTube",
  hub: "Hub動画",
};

function ShortVideoThread({ authenticated, videoId, playbackSeconds, onSeek }: { authenticated: boolean; videoId: string; playbackSeconds?: number; onSeek?: (seconds: number) => void }) {
  const [comments, setComments] = useState<VideoThreadComment[]>([]);
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/videos/${encodeURIComponent(videoId)}/comments`, { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { comments?: VideoThreadComment[] } | null) => {
        if (!cancelled) setComments(payload?.comments ?? []);
      })
      .catch(() => { if (!cancelled) setComments([]); });
    return () => { cancelled = true; };
  }, [videoId]);
  return <VideoThread
    key={videoId}
    videoId={videoId}
    initialComments={comments}
    authenticated={authenticated}
    currentPlaybackSeconds={playbackSeconds}
    onSeek={onSeek}
  />;
}

function videoDetailHref(videoId: string) {
  return `/videos/${encodeURIComponent(videoId)}`;
}

export function isShortVideo(video: PublicVideoEntry) {
  if (isVerticalVideo(video)) return true;
  const parts = video.duration?.split(":").map(Number);
  if (!parts?.length || parts.some((part) => !Number.isFinite(part)))
    return false;
  const seconds = parts.reduce((total, part) => total * 60 + part, 0);
  return seconds > 0 && seconds <= 60;
}

function videoSafetyNotice(video: PublicVideoEntry) {
  if (video.safetyLevel && video.safetyLevel !== "standard") return video.safetyNotice ?? ({ sensitive: "刺激の強い内容を含む可能性があります。", adult: "成人向けの内容を含む可能性があります。", medical: "医療・健康情報を含みます。診断や治療は専門家へ確認してください。", political: "政治に関する内容です。複数の情報源も確認してください。" }[video.safetyLevel]);
  const text = `${video.title} ${video.category} ${video.topic}`.normalize("NFKC").toLocaleLowerCase("ja");
  if (/(成人|性的|18禁|暴力|流血)/u.test(text)) return "年齢制限または刺激の強い内容を含む可能性があります。";
  if (/(医療|病気|治療|薬|健康)/u.test(text)) return "医療・健康情報を含みます。診断や治療は専門家へ確認してください。";
  if (/(政治|選挙|政党)/u.test(text)) return "政治に関する内容です。複数の情報源も確認してください。";
  return null;
}

function ProviderBadge({ provider }: { provider: VideoProvider }) {
  return (
    <span className={`video-provider video-provider--${provider}`}>
      {PROVIDER_LABELS[provider]}
    </span>
  );
}

function VideoArtwork({
  video,
  featured = false,
}: {
  video: PublicVideoEntry;
  featured?: boolean;
}) {
  const className = featured ? "video-feature__visual" : "video-thumbnail";
  const qualityBadges = [
    isShortVideo(video) ? "縦動画" : null,
    /(?:字幕|subtitles?|captions?)/iu.test(video.title) ? "字幕" : null,
    video.safetyLevel && video.safetyLevel !== "standard" ? "要確認" : null,
    video.availabilityStatus === "unavailable" ? "再生不可" : null,
  ].filter(Boolean) as string[];
  return (
    <div className={`${className} video-thumbnail--provider-${video.provider}`}>
      {video.thumbnailUrl ? (
        <img
          src={video.thumbnailUrl}
          alt=""
          loading={featured ? "eager" : "lazy"}
          referrerPolicy="no-referrer"
        />
      ) : null}
      <ProviderBadge provider={video.provider} />
      {qualityBadges.length ? <span className="video-thumbnail__quality">{qualityBadges.map((badge) => <b key={badge}>{badge}</b>)}</span> : null}
      {video.duration ? <time>{video.duration}</time> : null}
    </div>
  );
}

function VideoCard({
  video,
  onOpenShortApp,
  short = false,
}: {
  video: PublicVideoEntry;
  authenticated: boolean;
  persistable: boolean;
  saved: boolean;
  pending: boolean;
  playlists: VideoPlaylist[];
  onOpenShortApp?: (video: PublicVideoEntry) => void;
  onSave: (video: PublicVideoEntry) => void;
  onAddToPlaylist: (playlistId: string, video: PublicVideoEntry) => void;
  short?: boolean;
}) {
  const provider = PROVIDER_LABELS[video.provider];
  const broadcastStatus = classifyVideoBroadcastStatus(video);
  const liveLabel = videoBroadcastLabel(broadcastStatus);
  return (
    <article className={`video-card${short ? " video-card--short" : ""}`}>
      {onOpenShortApp ? (
        <button
          type="button"
          className="video-card__open"
          onClick={() => onOpenShortApp(video)}
          aria-label={`${video.title}をHub動画アプリで開く`}
        />
      ) : (
        <a
          className="video-card__open"
          href={videoDetailHref(video.id)}
          aria-label={`${video.title}のHub動画ページを開く`}
        />
      )}
      <div className="video-card__artwork">
        <VideoArtwork video={video} />
        {liveLabel ? <span className={`video-card__live video-card__live--${broadcastStatus}`}>{liveLabel}</span> : null}
      </div>
      <div className="video-card__meta">
        <div>
          <h3>{video.title}</h3>
          <p>
            <strong>{video.topic}</strong>
            <span>
              {provider}のリンク · {video.channel}
            </span>
          </p>
          <small>Hubのスレッドで見る</small>
        </div>
      </div>
    </article>
  );
}

export function VideoDiscovery({
  beforeContent,
  initialVideos,
  initialTotal = initialVideos.length,
  initialCatalogOffset = initialVideos.length,
  authenticated,
  initialOpenVideoId,
  persistableVideoIds,
  adFirstAfterItem = 1,
}: VideoDiscoveryProps) {
  const [videos, setVideos] = useState(() => initialVideos.slice(0, MAX_LOADED_DISCOVERY_VIDEOS));
  const [catalogTotal, setCatalogTotal] = useState(initialTotal);
  const [catalogOffset, setCatalogOffset] = useState(initialCatalogOffset);
  const [catalogPending, setCatalogPending] = useState(false);
  const catalogSentinelRef = useRef<HTMLDivElement | null>(null);
  const [provider, setProvider] = useState<VideoProvider | "all">("all");
  const [category, setCategory] = useState("すべて");
  const { expandedCategoryKey: expandedVideoCategory, toggleCategory: toggleVideoCategory, collapseCategories: collapseVideoCategories } = useCategoryAccordion();
  const [detailCategory, setDetailCategory] = useState("すべて");
  const [query, setQuery] = useState("");
  const [lengthFilter, setLengthFilter] = useState<"all" | "under4" | "4to20" | "over20">("all");
  const [watchedFilter, setWatchedFilter] = useState<"all" | "unwatched" | "watched">("all");
  const [dateFilter, setDateFilter] = useState<"all" | "week" | "month" | "year">("all");
  const [languageFilter, setLanguageFilter] = useState<"all" | "ja" | "latin">("all");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [channel, setChannel] = useState("");
  const [registrationCategory, setRegistrationCategory] = useState("");
  const [topic, setTopic] = useState("");
  const [relatedHubpediaSlug, setRelatedHubpediaSlug] = useState("");
  const [accessGateId, setAccessGateId] = useState<string | null>(null);
  const [mode, setMode] = useState<DiscoveryMode>("rising");
  const [rankedVideos, setRankedVideos] = useState<RankedVideo[] | null>(null);
  const [rankingPending, setRankingPending] = useState(false);
  const [savedVideoIds, setSavedVideoIds] = useState<Set<string>>(new Set());
  const [savedVideos, setSavedVideos] = useState<PublicVideoEntry[]>([]);
  const [playlists, setPlaylists] = useState<VideoPlaylist[]>([]);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState("all");
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [libraryPending, setLibraryPending] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState("");
  const persistableVideoIdSet = useMemo(
    () => new Set(
      persistableVideoIds?.length === 0
        ? []
        : videos.map((video) => video.id),
    ),
    [persistableVideoIds, videos],
  );
  const [videoActionPending, setVideoActionPending] = useState<Set<string>>(
    new Set(),
  );
  const [playlistTitle, setPlaylistTitle] = useState("");
  const [metadataPending, setMetadataPending] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importJobs, setImportJobs] = useState<Array<{
    id: string;
    status: string;
    controlState: string;
    totalCount: number;
    succeededCount: number;
    failedCount: number;
    attemptCount: number;
    errorMessage?: string;
    createdAt: string;
  }>>([]);
  const [youtubeQuota, setYoutubeQuota] = useState({ usedUnits: 0, limit: 10000 });
  const [shortApp, setShortApp] = useState<{
    video: PublicVideoEntry;
    queue: PublicVideoEntry[];
  } | null>(null);
  const [videoAppMessage, setVideoAppMessage] = useState("");
  const [videoAppMenuOpen, setVideoAppMenuOpen] = useState(false);
  const [dismissedVideo, setDismissedVideo] = useState<PublicVideoEntry | null>(null);
  const [channelView, setChannelView] = useState<string | null>(null);
  const [sidePanel, setSidePanel] = useState<"thread" | "related">("thread");
  const [showRecommendationSettings, setShowRecommendationSettings] = useState(false);
  const [analyticsEnabled, setAnalyticsEnabled] = useState(true);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [recommendationSyncReady, setRecommendationSyncReady] = useState(false);
  const [followedChannels, setFollowedChannels] = useState<Set<string>>(new Set());
  const [videoEngagement, setVideoEngagement] = useState({ likeCount: 0, likedByViewer: false });
  const [safetyAcceptedVideoIds, setSafetyAcceptedVideoIds] = useState<Set<string>>(new Set());
  const [videoActivity, setVideoActivity] = useState<Record<string, VideoActivity>>({});
  const [currentPlaybackSeconds, setCurrentPlaybackSeconds] = useState(0);
  const [requestedSeekSeconds, setRequestedSeekSeconds] = useState<number>();
  const [shortPreferences, setShortPreferences] = useState<ShortPreferenceProfile>({ videos: {}, channels: {}, topics: {}, categories: {} });
  const playbackEventsSent = useRef<Set<string>>(new Set());
  const initialVideoOpened = useRef(false);
  const metadataLookupUrl = useRef("");
  const [hubTrending, setHubTrending] = useState<HubTrendingPayload | null>(
    null,
  );
  const [recentVideoIds, setRecentVideoIds] = useState<string[]>([]);
  const [sharedInterests, setSharedInterests] = useState<string[]>([]);

  useEffect(() => {
    const sentinel = catalogSentinelRef.current;
    if (!sentinel || videos.length >= catalogTotal || videos.length >= MAX_LOADED_DISCOVERY_VIDEOS || catalogPending || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setCatalogPending(true);
      void fetch(`/api/videos?limit=${VIDEO_CATALOG_BATCH_SIZE}&offset=${catalogOffset}`, { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("video_catalog_unavailable");
          return response.json() as Promise<{ videos?: PublicVideoEntry[]; total?: number }>;
        })
        .then((payload) => {
          setVideos((current) => {
            const byId = new Map(current.map((video) => [video.id, video]));
            for (const video of payload.videos ?? []) byId.set(video.id, video);
            return [...byId.values()].slice(0, MAX_LOADED_DISCOVERY_VIDEOS);
          });
          if (typeof payload.total === "number") setCatalogTotal(payload.total);
          setCatalogOffset((current) => current + (payload.videos?.length ?? 0));
        })
        .catch(() => undefined)
        .finally(() => setCatalogPending(false));
    }, { rootMargin: "600px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [catalogOffset, catalogPending, catalogTotal, videos.length]);

  useEffect(() => {
    if (!initialOpenVideoId || initialVideoOpened.current) return;
    const selected = videos.find((video) => video.id === initialOpenVideoId);
    if (!selected) return;
    initialVideoOpened.current = true;
    const sameFormat = videos.filter((video) => isShortVideo(video) === isShortVideo(selected));
    setShortApp({ video: selected, queue: sameFormat.filter((video) => video.id !== selected.id) });
  }, [initialOpenVideoId, videos]);

  useEffect(() => {
    const syncVideoFromUrl = () => {
      const videoId = new URL(window.location.href).searchParams.get("video");
      if (!videoId) return setShortApp(null);
      const selected = videos.find((video) => video.id === videoId);
      if (!selected) return;
      setShortApp({ video: selected, queue: videos.filter((video) => video.id !== selected.id && isShortVideo(video) === isShortVideo(selected)) });
    };
    window.addEventListener("popstate", syncVideoFromUrl);
    return () => window.removeEventListener("popstate", syncVideoFromUrl);
  }, [videos]);

  useEffect(() => {
    if (!shortApp) return;
    playbackEventsSent.current = new Set();
    setRequestedSeekSeconds(undefined);
    setCurrentPlaybackSeconds(videoActivity[shortApp.video.id]?.positionSeconds ?? 0);
    void fetch(`/api/videos/${encodeURIComponent(shortApp.video.id)}/engagement`, { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { likeCount?: number; likedByViewer?: boolean } | null) => setVideoEngagement({ likeCount: payload?.likeCount ?? 0, likedByViewer: payload?.likedByViewer ?? false }))
      .catch(() => setVideoEngagement({ likeCount: 0, likedByViewer: false }));
  }, [shortApp?.video.id]);

  useEffect(() => {
    setShortPreferences(readShortPreferenceProfile(window.localStorage));
    setRecentVideoIds(readVideoHistory(window.localStorage));
    try {
      setFollowedChannels(new Set(JSON.parse(window.localStorage.getItem("hub.video-followed-channels.v1") ?? "[]") as string[]));
      setAnalyticsEnabled(window.localStorage.getItem("hub.video-analytics.v1") !== "off");
      setHistoryEnabled(window.localStorage.getItem("hub.video-history.v1") !== "off");
    } catch { /* local preferences fall back to defaults */ }
    const syncInterests = () =>
      setSharedInterests(topHubInterests(readHubInterestProfile()));
    syncInterests();
    window.addEventListener(HUB_INTEREST_PROFILE_CHANGED_EVENT, syncInterests);
    return () =>
      window.removeEventListener(
        HUB_INTEREST_PROFILE_CHANGED_EVENT,
        syncInterests,
      );
  }, []);

  useEffect(() => {
    if (!authenticated || !historyEnabled) return;
    void fetch("/api/videos/history", { credentials: "same-origin" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { activity?: VideoActivity[] } | null) => {
        if (payload?.activity) setVideoActivity(Object.fromEntries(payload.activity.map((item) => [item.videoId, item])));
      })
      .catch(() => undefined);
  }, [authenticated, historyEnabled]);

  useEffect(() => {
    if (!authenticated) return;
    void fetch("/api/videos/channels", { credentials: "same-origin", cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload: { channels?: Array<{ name: string; notificationsEnabled: boolean }> } | null) => {
      if (!payload?.channels) return;
      setFollowedChannels(new Set(payload.channels.map((item) => item.name)));
    }).catch(() => undefined);
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated) return;
    void fetch("/api/videos/preferences", { credentials: "same-origin", cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload: { preferences?: (ShortPreferenceProfile & { analyticsEnabled?: boolean }) | null } | null) => {
      if (payload?.preferences) {
        setShortPreferences({ videos: payload.preferences.videos, channels: payload.preferences.channels, topics: payload.preferences.topics, categories: payload.preferences.categories });
        setAnalyticsEnabled(payload.preferences.analyticsEnabled !== false);
      }
      setRecommendationSyncReady(true);
    }).catch(() => setRecommendationSyncReady(true));
  }, [authenticated]);

  useEffect(() => {
    if (!authenticated || !recommendationSyncReady) return;
    const timer = window.setTimeout(() => void fetch("/api/videos/preferences", { method: "PUT", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...shortPreferences, analyticsEnabled }) }).catch(() => undefined), 500);
    return () => window.clearTimeout(timer);
  }, [analyticsEnabled, authenticated, recommendationSyncReady, shortPreferences]);

  useEffect(() => {
    if (!authenticated || libraryLoaded) return;
    let cancelled = false;
    setLibraryPending(true);
    void fetch("/api/videos/library", { credentials: "same-origin" })
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          savedVideoIds?: string[];
          savedVideos?: PublicVideoEntry[];
          playlists?: VideoPlaylist[];
        };
        if (!response.ok || cancelled) return;
        setSavedVideoIds(new Set(payload.savedVideoIds ?? []));
        setSavedVideos(payload.savedVideos ?? []);
        setPlaylists(payload.playlists ?? []);
        setLibraryLoaded(true);
      })
      .finally(() => {
        if (!cancelled) setLibraryPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated, libraryLoaded]);

  useEffect(() => {
    let cancelled = false;
    async function loadTrending() {
      try {
        const response = await fetch("/api/videos/rankings", {
          credentials: "same-origin",
        });
        const payload = (await response
          .json()
          .catch(() => ({}))) as Partial<HubTrendingPayload> & {
          error?: string;
        };
        if (!response.ok)
          throw new Error(payload.error ?? "注目動画を取得できませんでした。");
        if (cancelled) return;
        setHubTrending({
          popular: Array.isArray(payload.popular) ? payload.popular : [],
          rising: Array.isArray(payload.rising) ? payload.rising : [],
          recent: Array.isArray(payload.recent) ? payload.recent : [],
        });
        setRankedVideos(
          Array.isArray(payload.rising) && payload.rising.length
            ? payload.rising
            : null,
        );
      } catch {
        /* The catalog remains available when ranking refresh fails. */
      }
    }
    void loadTrending();
    return () => {
      cancelled = true;
    };
  }, []);

  const providers = useMemo(
    () =>
      VIDEO_PROVIDERS.filter((item) =>
        videos.some((video) => video.provider === item),
      ),
    [videos],
  );
  const categories = useMemo(
    () =>
      Array.from(
        new Set(videos.map((video) => video.category).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, "ja")),
    [videos],
  );
  const detailCategories = useMemo(() => category === "すべて" ? [] : Array.from(new Set(
    videos.filter((video) => video.category === category).map((video) => video.topic).filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, "ja")), [category, videos]);
  const videoCategoryDirectory = useMemo(() => categories.map((parent) => ({
    category: parent,
    children: Array.from(new Set(videos
      .filter((video) => video.category === parent)
      .map((video) => video.topic)
      .filter(Boolean))).sort((a, b) => a.localeCompare(b, "ja")),
  })), [categories, videos]);
  const videoCategorySearchTerm = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  const matchingVideoCategoryDirectory = useMemo(() => videoCategoryDirectory.flatMap((entry) => {
    if (!videoCategorySearchTerm) return [];
    if (entry.category.toLocaleLowerCase("ja").includes(videoCategorySearchTerm)) return [entry];
    const children = entry.children.filter((item) => item.toLocaleLowerCase("ja").includes(videoCategorySearchTerm));
    return children.length ? [{ ...entry, children }] : [];
  }), [videoCategoryDirectory, videoCategorySearchTerm]);
  useEffect(() => {
    if (detailCategory !== "すべて" && !detailCategories.includes(detailCategory)) setDetailCategory("すべて");
  }, [detailCategories, detailCategory]);
  const personalizationSignals = useMemo(() => {
    const byId = new Map(videos.map((video) => [video.id, video]));
    return [
      ...savedVideos,
      ...recentVideoIds
        .map((id) => byId.get(id))
        .filter((video): video is PublicVideoEntry => Boolean(video)),
    ].filter(
      (video, index, all) =>
        all.findIndex((item) => item.id === video.id) === index,
    );
  }, [recentVideoIds, savedVideos, videos]);
  const personalizedVideos = useMemo(
    () =>
      personalizeVideos(
        hubTrending?.rising.length ? hubTrending.rising : videos,
        personalizationSignals,
      ).sort(
        (left, right) =>
          scoreHubInterestText(
            `${right.title} ${right.topic} ${right.category}`,
            sharedInterests,
          ) -
          scoreHubInterestText(
            `${left.title} ${left.topic} ${left.category}`,
            sharedInterests,
          ),
      ),
    [hubTrending, personalizationSignals, sharedInterests, videos],
  );
  const personalizationActive =
    personalizationSignals.length > 0 || sharedInterests.length > 0;
  useEffect(() => {
    if (personalizationActive || mode !== "rising" || !hubTrending) return;
    setMode("popular");
    setRankedVideos(hubTrending.popular.length ? hubTrending.popular : null);
  }, [hubTrending, mode, personalizationActive]);
  const discoveryVideos = useMemo(() => {
    if (mode === "saved") {
      if (selectedPlaylistId === "all") return savedVideos;
      const selected = playlists.find(
        (playlist) => playlist.id === selectedPlaylistId,
      );
      return savedVideos.filter((video) =>
        selected?.videoIds?.includes(video.id),
      );
    }
    if (mode === "rising" && personalizationActive) return personalizedVideos;
    if (mode === "shorts") return personalizeShortVideos(videos.filter(isShortVideo), shortPreferences);
    if (mode !== "recent" && rankedVideos) return rankedVideos;
    return videos;
  }, [
    mode,
    personalizationActive,
    personalizedVideos,
    playlists,
    rankedVideos,
    savedVideos,
    selectedPlaylistId,
    shortPreferences,
    videos,
  ]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ja");
    const durationSeconds = (video: PublicVideoEntry) => video.duration?.split(":").map(Number).reduce((total, part) => total * 60 + part, 0) ?? 0;
    const dateCutoff = dateFilter === "week" ? 7 : dateFilter === "month" ? 31 : dateFilter === "year" ? 366 : 0;
    return discoveryVideos.filter(
      (video) =>
        !videoActivity[video.id]?.hidden &&
        video.availabilityStatus !== "unavailable" &&
        (mode === "shorts" ? isShortVideo(video) : !isShortVideo(video)) &&
        (provider === "all" || video.provider === provider) &&
        (category === "すべて" || video.category === category) &&
        (detailCategory === "すべて" || video.topic === detailCategory) &&
        (lengthFilter === "all" || (lengthFilter === "under4" && durationSeconds(video) > 0 && durationSeconds(video) < 240) || (lengthFilter === "4to20" && durationSeconds(video) >= 240 && durationSeconds(video) <= 1200) || (lengthFilter === "over20" && durationSeconds(video) > 1200)) &&
        (watchedFilter === "all" || (watchedFilter === "watched" ? Boolean(videoActivity[video.id] || recentVideoIds.includes(video.id)) : !videoActivity[video.id] && !recentVideoIds.includes(video.id))) &&
        (!dateCutoff || (typeof video.publishedAt === "string" && Date.now() - new Date(video.publishedAt).getTime() <= dateCutoff * 86400000)) &&
        (languageFilter === "all" || (languageFilter === "ja" ? /[ぁ-んァ-ヶ一-龠]/u.test(`${video.title}${video.channel}`) : /^[\x00-\x7F\s\p{P}]+$/u.test(`${video.title}${video.channel}`))) &&
        (!needle ||
          `${video.title} ${video.channel} ${video.category} ${video.topic} ${PROVIDER_LABELS[video.provider]}`
            .toLocaleLowerCase("ja")
            .includes(needle)),
    );
  }, [category, dateFilter, detailCategory, discoveryVideos, languageFilter, lengthFilter, mode, provider, query, recentVideoIds, videoActivity, watchedFilter]);

  const shortRailVideos = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("ja");
    return personalizeShortVideos(
      videos.filter(
        (video) =>
          !videoActivity[video.id]?.hidden &&
          isShortVideo(video) &&
          (provider === "all" || video.provider === provider) &&
          (category === "すべて" || video.category === category) &&
          (detailCategory === "すべて" || video.topic === detailCategory) &&
          (!needle ||
            `${video.title} ${video.channel} ${video.category} ${video.topic} ${PROVIDER_LABELS[video.provider]}`
              .toLocaleLowerCase("ja")
              .includes(needle)),
      ),
      shortPreferences,
    )
      .slice(0, 12);
  }, [category, detailCategory, provider, query, shortPreferences, videoActivity, videos]);

  const continueWatchingVideos = useMemo(() => historyEnabled ? videos
    .filter((video) => {
      const activity = videoActivity[video.id];
      return activity && !activity.hidden && !activity.completed && activity.positionSeconds > 5 && video.availabilityStatus !== "unavailable";
    })
    .sort((left, right) => Date.parse(videoActivity[right.id]?.lastViewedAt ?? "") - Date.parse(videoActivity[left.id]?.lastViewedAt ?? ""))
    .slice(0, 8) : [], [historyEnabled, videoActivity, videos]);
  const recommendationReasonFor = (video: PublicVideoEntry) => {
    if (followedChannels.has(video.channel)) return `${video.channel}をフォロー中`;
    if ((shortPreferences.topics[video.topic] ?? 0) > 1) return `「${video.topic}」をよく見るため`;
    if ((shortPreferences.categories[video.category] ?? 0) > 1) return `「${video.category}」への関心から`;
    if (!videoActivity[video.id] && !recentVideoIds.includes(video.id)) return "未視聴の動画から";
    return "最近の視聴傾向から";
  };

  async function loadRankings(
    nextMode: Exclude<DiscoveryMode, "saved" | "shorts">,
  ) {
    setMode(nextMode);
    if (nextMode === "recent") {
      setRankedVideos(null);
      return;
    }
    if (hubTrending) {
      const nextVideos =
        nextMode === "popular" ? hubTrending.popular : hubTrending.rising;
      setRankedVideos(nextVideos.length ? nextVideos : null);
      return;
    }
    setRankingPending(true);
    setLibraryMessage("");
    try {
      const response = await fetch("/api/videos/rankings", {
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        popular?: RankedVideo[];
        rising?: RankedVideo[];
        recent?: RankedVideo[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "ランキングを取得できませんでした。");
      setHubTrending({
        popular: payload.popular ?? [],
        rising: payload.rising ?? payload.popular ?? [],
        recent: payload.recent ?? [],
      });
      const nextVideos =
        nextMode === "popular"
          ? (payload.popular ?? [])
          : (payload.rising ?? payload.popular ?? []);
      setRankedVideos(nextVideos.length ? nextVideos : null);
    } catch (cause) {
      setRankedVideos(null);
      setLibraryMessage(
        cause instanceof Error
          ? cause.message
          : "ランキングを取得できませんでした。",
      );
    } finally {
      setRankingPending(false);
    }
  }

  async function loadLibrary() {
    setMode("saved");
    if (!authenticated || libraryPending || libraryLoaded) return;
    setLibraryPending(true);
    setLibraryMessage("");
    try {
      const response = await fetch("/api/videos/library", {
        credentials: "same-origin",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        savedVideoIds?: string[];
        savedVideos?: PublicVideoEntry[];
        playlists?: VideoPlaylist[];
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.error ?? "保存した動画を取得できませんでした。",
        );
      setSavedVideoIds(new Set(payload.savedVideoIds ?? []));
      setSavedVideos(
        payload.savedVideos ??
          videos.filter((video) => payload.savedVideoIds?.includes(video.id)),
      );
      setPlaylists(payload.playlists ?? []);
      setLibraryLoaded(true);
    } catch (cause) {
      setLibraryMessage(
        cause instanceof Error
          ? cause.message
          : "保存した動画を取得できませんでした。",
      );
    } finally {
      setLibraryPending(false);
    }
  }

  async function toggleSave(video: PublicVideoEntry) {
    if (!authenticated || videoActionPending.has(video.id)) return;
    const saved = savedVideoIds.has(video.id);
    setVideoActionPending((current) => new Set(current).add(video.id));
    setLibraryMessage("");
    try {
      const response = await fetch(
        `/api/videos/${encodeURIComponent(video.id)}/save`,
        {
          method: saved ? "DELETE" : "POST",
          credentials: "same-origin",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        saved?: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(payload.error ?? "保存状態を変更できませんでした。");
      const nextSaved = payload.saved ?? !saved;
      setSavedVideoIds((current) => {
        const next = new Set(current);
        if (nextSaved) next.add(video.id);
        else next.delete(video.id);
        return next;
      });
      setSavedVideos((current) =>
        nextSaved
          ? [video, ...current.filter((item) => item.id !== video.id)]
          : current.filter((item) => item.id !== video.id),
      );
      setLibraryLoaded(true);
      setLibraryMessage(
        nextSaved ? "あとで見るに保存しました。" : "保存を解除しました。",
      );
      if (nextSaved)
        recordHubInterests("video", [video.topic, video.category], 3);
    } catch (cause) {
      setLibraryMessage(
        cause instanceof Error
          ? cause.message
          : "保存状態を変更できませんでした。",
      );
    } finally {
      setVideoActionPending((current) => {
        const next = new Set(current);
        next.delete(video.id);
        return next;
      });
    }
  }

  async function createPlaylist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = playlistTitle.trim();
    if (!normalized) return;
    setLibraryPending(true);
    setLibraryMessage("");
    try {
      const response = await fetch("/api/videos/playlists", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: normalized }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        playlist?: VideoPlaylist;
        error?: string;
      };
      if (!response.ok || !payload.playlist)
        throw new Error(
          payload.error ?? "プレイリストを作成できませんでした。",
        );
      setPlaylists((current) => [
        ...current,
        { ...payload.playlist!, videoIds: payload.playlist!.videoIds ?? [] },
      ]);
      setPlaylistTitle("");
      setLibraryMessage("プレイリストを作成しました。");
    } catch (cause) {
      setLibraryMessage(
        cause instanceof Error
          ? cause.message
          : "プレイリストを作成できませんでした。",
      );
    } finally {
      setLibraryPending(false);
    }
  }

  async function addToPlaylist(playlistId: string, video: PublicVideoEntry) {
    if (!playlistId || videoActionPending.has(video.id)) return;
    setVideoActionPending((current) => new Set(current).add(video.id));
    setLibraryMessage("");
    try {
      const response = await fetch(
        `/api/videos/playlists/${encodeURIComponent(playlistId)}/items/${encodeURIComponent(video.id)}`,
        {
          method: "POST",
          credentials: "same-origin",
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        added?: boolean;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.error ?? "プレイリストへ追加できませんでした。",
        );
      setPlaylists((current) =>
        current.map((playlist) =>
          playlist.id === playlistId
            ? {
                ...playlist,
                videoIds: Array.from(
                  new Set([...(playlist.videoIds ?? []), video.id]),
                ),
              }
            : playlist,
        ),
      );
      setSavedVideoIds((current) => new Set(current).add(video.id));
      setSavedVideos((current) => [
        video,
        ...current.filter((item) => item.id !== video.id),
      ]);
      setLibraryLoaded(true);
      setLibraryMessage("プレイリストへ追加しました。");
    } catch (cause) {
      setLibraryMessage(
        cause instanceof Error
          ? cause.message
          : "プレイリストへ追加できませんでした。",
      );
    } finally {
      setVideoActionPending((current) => {
        const next = new Set(current);
        next.delete(video.id);
        return next;
      });
    }
  }

  async function autofillMetadata(requestedUrl = sourceUrl) {
    const normalizedUrl = requestedUrl.trim();
    if (normalizedUrl.split(/\r?\n/u).filter(Boolean).length > 1) return;
    if (
      !normalizedUrl ||
      metadataPending ||
      metadataLookupUrl.current === normalizedUrl
    )
      return;
    metadataLookupUrl.current = normalizedUrl;
    setMetadataPending(true);
    setError("");
    try {
      const response = await fetch("/api/videos/metadata", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceUrl: normalizedUrl }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        metadata?: VideoSearchCandidate;
        error?: string;
      };
      if (!response.ok || !payload.metadata)
        throw new Error(payload.error ?? "動画情報を取得できませんでした。");
      const resolvedUrl = payload.metadata.sourceUrl ?? normalizedUrl;
      metadataLookupUrl.current = resolvedUrl;
      setSourceUrl(resolvedUrl);
      setTitle(payload.metadata.title ?? "");
      setChannel(payload.metadata.channel ?? "");
      setSuccess("タイトルとチャンネル情報を入力しました。");
    } catch (cause) {
      metadataLookupUrl.current = "";
      setError(
        cause instanceof Error
          ? cause.message
          : "動画情報を取得できませんでした。",
      );
    } finally {
      setMetadataPending(false);
    }
  }

  async function submitVideo(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");
    setSuccess("");
    const form = event.currentTarget;
    const fields = new FormData(form);
    const sourceUrls = Array.from(
      new Set(
        String(fields.get("sourceUrl") ?? "")
          .split(/\r?\n/u)
          .map((value) => value.trim())
          .filter(Boolean),
      ),
    );

    try {
      if (sourceUrls.length === 0) throw new Error("動画URLを入力してください。");
      if (sourceUrls.length > 50) throw new Error("一度に登録できる動画は50件までです。");

      const registered: PublicVideoEntry[] = [];
      const failures: string[] = [];
      if (sourceUrls.length > 1) {
        setSuccess(`${sourceUrls.length}件を一括確認中…`);
        const response = await fetch("/api/videos/import", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceUrls,
            category: fields.get("category"),
            purpose: "other",
            topic: fields.get("topic"),
            relatedHubpediaSlug: fields.get("relatedHubpediaSlug"),
            background: true,
          }),
        });
        const payload = (await response.json().catch(() => ({}))) as {
          videos?: PublicVideoEntry[];
          failures?: Array<{ sourceUrl: string; error: string }>;
          job?: { id: string; status: string; totalCount: number };
          error?: string;
        };
        if (!response.ok || !payload.job) throw new Error(payload.error ?? "動画インポートを開始できませんでした。");
        let completedJob: { status: string; succeededCount?: number; failedCount?: number; errorMessage?: string } | null = null;
        for (let attempt = 0; attempt < 180; attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          const statusResponse = await fetch(`/api/videos/import?jobId=${encodeURIComponent(payload.job.id)}`, {
            credentials: "same-origin",
          });
          const statusPayload = (await statusResponse.json().catch(() => ({}))) as {
            job?: { status: string; succeededCount?: number; failedCount?: number; errorMessage?: string };
          };
          if (statusPayload.job?.status === "completed" || statusPayload.job?.status === "failed") {
            completedJob = statusPayload.job;
            break;
          }
          setSuccess(`${sourceUrls.length}件をバックグラウンドで処理中…`);
        }
        if (!completedJob) {
          setSuccess(`${sourceUrls.length}件を処理キューへ登録しました。画面を閉じても処理は継続します。`);
          return;
        }
        if (completedJob.status === "failed") throw new Error(completedJob.errorMessage ?? "動画インポートに失敗しました。");
        const catalogResponse = await fetch(`/api/videos?limit=${MAX_LOADED_DISCOVERY_VIDEOS}&offset=0`, { credentials: "same-origin" });
        const catalogPayload = (await catalogResponse.json().catch(() => ({}))) as { videos?: PublicVideoEntry[] };
        registered.push(...(catalogPayload.videos ?? []).slice(0, completedJob.succeededCount ?? sourceUrls.length));
        if (completedJob.failedCount) failures.push(`${completedJob.failedCount}件を登録できませんでした。`);
      } else for (let offset = 0; offset < sourceUrls.length; offset += 5) {
        const batch = sourceUrls.slice(offset, offset + 5);
        const results = await Promise.allSettled(
          batch.map(async (url) => {
            let resolvedTitle = sourceUrls.length === 1 ? String(fields.get("title") ?? "") : "";
            let resolvedChannel = sourceUrls.length === 1 ? String(fields.get("channel") ?? "") : "";
            if (!resolvedTitle || !resolvedChannel) {
              const metadataResponse = await fetch("/api/videos/metadata", {
                method: "POST",
                credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sourceUrl: url }),
              });
              const metadataPayload = (await metadataResponse.json().catch(() => ({}))) as {
                metadata?: VideoSearchCandidate;
                error?: string;
              };
              if (!metadataResponse.ok || !metadataPayload.metadata) {
                throw new Error(metadataPayload.error ?? "動画情報を取得できませんでした。");
              }
              resolvedTitle = metadataPayload.metadata.title ?? "";
              resolvedChannel = metadataPayload.metadata.channel ?? "";
            }

            const response = await fetch("/api/videos", {
              method: "POST",
              credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                sourceUrl: url,
                title: resolvedTitle,
                channel: resolvedChannel,
                category: fields.get("category"),
                purpose: "other",
                topic: fields.get("topic"),
                relatedHubpediaSlug: fields.get("relatedHubpediaSlug"),
              }),
            });
            const payload = (await response.json().catch(() => ({}))) as {
              video?: PublicVideoEntry;
              error?: string;
              message?: string;
            };
            if (!response.ok || !payload.video) {
              throw new Error(payload.error ?? payload.message ?? "動画を登録できませんでした。");
            }
            if (accessGateId) await applyAccessGate("video", payload.video.id, accessGateId);
            return payload.video;
          }),
        );
        results.forEach((result, index) => {
          if (result.status === "fulfilled") registered.push(result.value);
          else failures.push(`${batch[index]}: ${result.reason instanceof Error ? result.reason.message : "登録に失敗しました。"}`);
        });
        setSuccess(`${Math.min(offset + batch.length, sourceUrls.length)} / ${sourceUrls.length}件を確認中…`);
      }

      if (registered.length > 0) {
        setVideos((current) => {
          const byId = new Map(current.map((item) => [item.id, item]));
          registered.forEach((item) => byId.set(item.id, item));
          return [...registered, ...Array.from(byId.values()).filter((item) => !registered.some((added) => added.id === item.id))]
            .slice(0, MAX_LOADED_DISCOVERY_VIDEOS);
        });
      }
      setProvider("all");
      setCategory("すべて");
      setQuery("");
      setSuccess(`${registered.length}件の動画を登録しました${failures.length ? `（${failures.length}件失敗）` : ""}。`);
      if (failures.length) setError(failures.slice(0, 3).join("\n"));
      if (registered.length === 0) throw new Error(failures[0] ?? "動画を登録できませんでした。");
      form.reset();
      setSourceUrl("");
      metadataLookupUrl.current = "";
      setTitle("");
      setChannel("");
      setRegistrationCategory("");
      setTopic("");
      setRelatedHubpediaSlug("");
      setAccessGateId(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "動画を登録できませんでした。",
      );
    } finally {
      setPending(false);
    }
  }

  async function refreshImportJobs() {
    if (!authenticated) return;
    const response = await fetch("/api/videos/import", { credentials: "same-origin" });
    const payload = (await response.json().catch(() => ({}))) as {
      jobs?: typeof importJobs;
      quota?: { usedUnits: number; limit: number };
    };
    if (response.ok) {
      setImportJobs(payload.jobs ?? []);
      setYoutubeQuota(payload.quota ?? { usedUnits: 0, limit: 10000 });
    }
  }

  async function importVideoFile(file: File) {
    if (pending) return;
    if (file.size > 50 * 1024 * 1024) {
      setError("CSV・JSONLファイルは50MBまでです。");
      return;
    }
    setPending(true);
    setError("");
    setSuccess("URLを解析中…");
    try {
      const text = await file.text();
      const ids = new Set<string>();
      const pattern = /https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^\s,"']*?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/giu;
      for (const match of text.matchAll(pattern)) ids.add(match[1]);
      if (ids.size === 0) throw new Error("YouTube URLが見つかりませんでした。");
      if (ids.size > 500_000) throw new Error("一度に投入できる動画は50万件までです。");
      const urls = Array.from(ids, (id) => `https://www.youtube.com/watch?v=${id}`);
      let queued = 0;
      for (let offset = 0; offset < urls.length; offset += 50) {
        const response = await fetch("/api/videos/import", {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            sourceUrls: urls.slice(offset, offset + 50),
            category: registrationCategory || "その他",
            purpose: "other",
            topic: topic || "その他",
            relatedHubpediaSlug,
            background: true,
          }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(payload.error ?? `${offset + 1}件目以降をキューへ登録できませんでした。`);
        }
        queued += Math.min(50, urls.length - offset);
        setSuccess(`${queued} / ${urls.length}件を処理キューへ登録中…`);
      }
      setSuccess(`${queued}件を登録しました。画面を閉じても処理は継続します。`);
      await refreshImportJobs();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ファイルを読み込めませんでした。");
    } finally {
      setPending(false);
    }
  }

  async function controlImportJob(jobId: string, action: "pause" | "resume" | "cancel" | "retry") {
    const response = await fetch("/api/videos/import", {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, action }),
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setError(payload.error ?? "ジョブを操作できませんでした。");
      return;
    }
    await refreshImportJobs();
  }

  useEffect(() => {
    if (!showImport || !authenticated) return;
    const timer = window.setInterval(() => void refreshImportJobs(), 5_000);
    return () => window.clearInterval(timer);
  }, [showImport, authenticated]);

  const featured = filtered[0];
  const learnShort = (video: PublicVideoEntry, outcome: "started" | "completed" | "skipped" | "notInterested") => {
    setShortPreferences(recordShortOutcome(window.localStorage, video, outcome));
  };
  const recordVideoEvent = (video: PublicVideoEntry, event: "start" | "quarter" | "half" | "complete" | "skip" | "external") => {
    if (!analyticsEnabled) return;
    if (playbackEventsSent.current.has(event)) return;
    playbackEventsSent.current.add(event);
    void fetch(`/api/videos/${encodeURIComponent(video.id)}/events`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ event }) }).catch(() => undefined);
  };
  const openVideoApp = (video: PublicVideoEntry, queue: PublicVideoEntry[]) => {
    setVideoAppMessage("");
    setVideoAppMenuOpen(false);
    setChannelView(null);
    setShortApp({ video, queue });
    const url = new URL(window.location.href);
    url.pathname = "/videos";
    url.searchParams.set("video", video.id);
    window.history.pushState({ hubVideoApp: true }, "", `${url.pathname}${url.search}`);
  };
  const persistChannelSet = (key: string, next: Set<string>) => window.localStorage.setItem(key, JSON.stringify([...next]));
  const toggleChannelFollow = (channelName: string) => setFollowedChannels((current) => {
    const next = new Set(current);
    if (next.has(channelName)) {
      next.delete(channelName);
    } else next.add(channelName);
    persistChannelSet("hub.video-followed-channels.v1", next);
    if (authenticated) {
      const providerName = videos.find((video) => video.channel === channelName)?.provider ?? "youtube";
      void fetch(`/api/videos/channels${next.has(channelName) ? "" : `?channel=${encodeURIComponent(channelName)}&provider=${encodeURIComponent(providerName)}`}`, { method: next.has(channelName) ? "PUT" : "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: next.has(channelName) ? JSON.stringify({ channel: channelName, provider: providerName, notificationsEnabled: false }) : undefined }).catch(() => undefined);
    }
    return next;
  });
  const saveVideoActivity = (video: PublicVideoEntry, state: Omit<VideoActivity, "videoId" | "hidden"> & { hidden?: boolean }) => {
    if (!historyEnabled && state.hidden === undefined) return;
    const activity: VideoActivity = { ...state, videoId: video.id, hidden: state.hidden ?? videoActivity[video.id]?.hidden ?? false };
    window.localStorage.setItem(`hub.video-playback.${video.id}`, JSON.stringify(activity));
    if (authenticated) void fetch("/api/videos/history", {
      method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(activity),
    }).catch(() => undefined);
  };
  const closeShortApp = () => {
    setVideoAppMessage("");
    if (window.history.state?.hubVideoApp) window.history.back();
    else {
      window.history.replaceState({}, "", "/videos");
      setShortApp(null);
    }
  };
  useEffect(() => {
    if (!shortApp) return;
    const navigateByKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true'], .hub-short-app__thread")) return;
      if (event.key === "Escape") { event.preventDefault(); closeShortApp(); return; }
    };
    window.addEventListener("keydown", navigateByKey);
    return () => window.removeEventListener("keydown", navigateByKey);
  });
  const clearVideoHistory = () => {
    Object.keys(window.localStorage).filter((key) => key.startsWith("hub.video-playback.")).forEach((key) => window.localStorage.removeItem(key));
    setVideoActivity({});
    if (authenticated) void fetch("/api/videos/history", { method: "DELETE", credentials: "same-origin" });
    setLibraryMessage("動画の視聴履歴を消去しました。");
  };

  return (
    <section className="video-hub tab-left-column-layout">
      <aside data-hub-page-left-column className="video-category-sidebar bbs-thread-directory tab-left-column" aria-label="動画カテゴリ">
        <header className="bbs-thread-directory__header tab-left-column__header"><strong>動画</strong></header>
        <nav className="bbs-thread-directory__nav" aria-label="動画カテゴリ">
          <button type="button" className={category === "すべて" ? "is-active" : ""} onClick={() => { collapseVideoCategories(); setCategory("すべて"); setDetailCategory("すべて"); }}>すべて</button>
          {videoCategoryDirectory.map((entry) => (
            <details key={entry.category} open={expandedVideoCategory === entry.category}>
              <summary className={category === entry.category && detailCategory === "すべて" ? "is-active" : ""} aria-expanded={expandedVideoCategory === entry.category} onClick={(event) => { event.preventDefault(); toggleVideoCategory(entry.category); setCategory(entry.category); setDetailCategory("すべて"); }}>
                {entry.category}
              </summary>
              <div>
                {entry.children.map((item) => <button type="button" key={item} className={detailCategory === item ? "is-active" : ""} onClick={() => { setCategory(entry.category); setDetailCategory(item); }}>{item}</button>)}
              </div>
            </details>
          ))}
        </nav>
      </aside>
      <div className="video-hub__content tab-left-column-main">
      <header className="video-hub__header">
        {/* The shell page header already names this screen; the band is here for the search. */}
        <div>
          <small>HUB VIDEOS</small>
        </div>
        <label className="video-search">
          <span aria-hidden="true">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="動画・テーマ・チャンネルを検索"
            aria-label="動画を検索"
          />
          {query ? (
            <button
              type="button"
              aria-label="検索をクリア"
              onClick={() => setQuery("")}
            >
              ×
            </button>
          ) : null}
        </label>
        <div className="video-hub__header-actions">
          <span className="video-hub__prototype">外部動画を横断表示</span>
          <button
            type="button"
            className="video-hub__import-button"
            aria-expanded={showImport}
            aria-controls="video-import-panel"
            onClick={() => {
              const next = !showImport;
              setShowImport(next);
              if (next) void refreshImportJobs();
            }}
          >
            {showImport ? "閉じる" : "インポート"}
          </button>
        </div>
      </header>

      {beforeContent}

      <section className="video-topic-intro" aria-labelledby="video-topic-intro-title">
        <div>
          <small>HUB VIDEO DIRECTORY</small>
          <h2 id="video-topic-intro-title">話題</h2>
          <p>配信元を横断し、動画を起点にHubのスレッドで話せます。</p>
        </div>
        {rankingPending || libraryPending ? (
          <span role="status">読み込み中…</span>
        ) : null}
      </section>

      {mode === "saved" ? (
        <section className="video-library-toolbar" aria-label="動画ライブラリ">
          {authenticated ? (
            <>
              <label>
                <span>表示するリスト</span>
                <select
                  value={selectedPlaylistId}
                  onChange={(event) =>
                    setSelectedPlaylistId(event.target.value)
                  }
                >
                  <option value="all">あとで見る</option>
                  {playlists.map((playlist) => (
                    <option key={playlist.id} value={playlist.id}>
                      {playlist.title}
                    </option>
                  ))}
                </select>
              </label>
              <form onSubmit={createPlaylist}>
                <label htmlFor="new-video-playlist">新しいプレイリスト</label>
                <div>
                  <input
                    id="new-video-playlist"
                    value={playlistTitle}
                    onChange={(event) => setPlaylistTitle(event.target.value)}
                    maxLength={80}
                    placeholder="例：初心者向け攻略"
                  />
                  <button
                    type="submit"
                    disabled={libraryPending || !playlistTitle.trim()}
                  >
                    作成
                  </button>
                </div>
              </form>
            </>
          ) : (
            <p>
              <a href="/auth">ログイン</a>
              すると、動画の保存とプレイリストを利用できます。
            </p>
          )}
        </section>
      ) : null}
      {libraryMessage ? (
        <p className="video-library-message" role="status">
          {libraryMessage}
        </p>
      ) : null}

      {showImport ? (
        <section
          className="video-submit"
          id="video-import-panel"
          aria-labelledby="video-submit-title"
        >
          <div>
            <small>IMPORT A VIDEO</small>
            <h2 id="video-submit-title">URLから動画を追加</h2>
            <p>
              公式ページのURLを登録します。動画ファイルをHubへ転載する機能ではありません。
            </p>
          </div>
          {authenticated ? (
            <div className="video-submit__authenticated">
              <form className="video-registration-form" onSubmit={submitVideo}>
                <label className="video-registration-form__url">
                  <span>動画URL</span>
                  <span className="video-url-autofill">
                    <textarea
                      name="sourceUrl"
                      inputMode="url"
                      rows={4}
                      value={sourceUrl}
                      onChange={(event) => {
                        setSourceUrl(event.target.value);
                        setError("");
                        setSuccess("");
                      }}
                      onPaste={(event) => {
                        const pastedUrls = event.clipboardData.getData("text").trim();
                        if (!pastedUrls) return;
                        if (pastedUrls.split(/\r?\n/u).filter(Boolean).length === 1) {
                          event.preventDefault();
                          setSourceUrl(pastedUrls);
                          void autofillMetadata(pastedUrls);
                        }
                      }}
                      onBlur={() => void autofillMetadata()}
                      placeholder={"動画URLを1行に1件入力\nhttps://www.youtube.com/watch?v=..."}
                      required
                      disabled={pending || metadataPending}
                    />
                    <span aria-live="polite">
                      {metadataPending
                        ? "動画情報を取得中…"
                        : "1行に1件、最大50件。各動画の情報と埋め込み可否を確認します"}
                    </span>
                  </span>
                </label>
                <input name="title" type="hidden" value={title} readOnly />
                <input name="channel" type="hidden" value={channel} readOnly />
                <input name="category" type="hidden" value={registrationCategory} readOnly />
                <input name="topic" type="hidden" value={topic} readOnly />
                <input name="relatedHubpediaSlug" type="hidden" value={relatedHubpediaSlug} readOnly />
                <V2AccessGateAttachToggle targetType="video" gateId={accessGateId} onChange={setAccessGateId} disabled={pending} />
                <button
                  type="submit"
                  disabled={
                    pending ||
                    metadataPending ||
                    !sourceUrl.trim() ||
                    (sourceUrl.split(/\r?\n/u).filter(Boolean).length === 1 && (!title || !channel))
                  }
                >
                  {pending || metadataPending ? "確認中…" : "追加"}
                </button>
              </form>
              <div className="video-import-file">
                <label>
                  <span>CSV・JSONL一括投入</span>
                  <input
                    type="file"
                    accept=".csv,.jsonl,.txt,text/csv,application/x-ndjson,text/plain"
                    disabled={pending}
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void importVideoFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                </label>
                <p>最大50万URLを読み取り、重複を除いて50件単位のバックグラウンドジョブに分割します。</p>
                <p>YouTube API: {youtubeQuota.usedUnits.toLocaleString()} / {youtubeQuota.limit.toLocaleString()} 単位</p>
              </div>
              {importJobs.length ? (
                <details>
                  <summary>インポートジョブ（{importJobs.length}件）</summary>
                  <div className="video-import-jobs">
                    {importJobs.map((job) => (
                      <div key={job.id}>
                        <strong>{job.status === "completed" ? "完了" : job.status === "running" ? "処理中" : job.status === "failed" ? "失敗" : "待機中"}</strong>
                        <span>{job.succeededCount}成功・{job.failedCount}失敗 / {job.totalCount}件</span>
                        {job.errorMessage ? <span>{job.errorMessage}</span> : null}
                        {job.status === "queued" && job.controlState === "active" ? (
                          <button type="button" onClick={() => void controlImportJob(job.id, "pause")}>一時停止</button>
                        ) : null}
                        {job.status === "queued" && job.controlState === "paused" ? (
                          <button type="button" onClick={() => void controlImportJob(job.id, "resume")}>再開</button>
                        ) : null}
                        {job.status === "failed" ? (
                          <button type="button" onClick={() => void controlImportJob(job.id, "retry")}>再試行</button>
                        ) : null}
                        {job.status === "queued" && job.controlState !== "cancelled" ? (
                          <button type="button" onClick={() => void controlImportJob(job.id, "cancel")}>中止</button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          ) : (
            <p className="video-submit__auth">
              <a href="/auth">ログイン</a>すると動画URLを登録できます。
            </p>
          )}
          {error ? (
            <p
              className="video-submit__message video-submit__message--error"
              role="alert"
            >
              {error}
            </p>
          ) : null}
          {success ? (
            <p
              className="video-submit__message video-submit__message--success"
              role="status"
            >
              {success}
            </p>
          ) : null}
        </section>
      ) : null}

      {categories.length && !matchingVideoCategoryDirectory.length ? (
        <ScrollableVideoCategories label="動画のカテゴリ">
          <button
            type="button"
            className={category === "すべて" ? "is-active" : ""}
            aria-pressed={category === "すべて"}
            onClick={() => { setCategory("すべて"); setDetailCategory("すべて"); }}
          >
            すべて
          </button>
          {categories.map((item) => (
            <button
              type="button"
              key={item}
              className={category === item ? "is-active" : ""}
              aria-pressed={category === item}
              onClick={() => { setCategory(item); setDetailCategory("すべて"); }}
            >
              {item}
            </button>
          ))}
        </ScrollableVideoCategories>
      ) : null}
      {detailCategories.length > 1 && !matchingVideoCategoryDirectory.length ? (
        <ScrollableVideoCategories label={`${category}の詳細カテゴリ`}>
          <button type="button" className={detailCategory === "すべて" ? "is-active" : ""} aria-pressed={detailCategory === "すべて"} onClick={() => setDetailCategory("すべて")}>すべて</button>
          {detailCategories.map((item) => <button type="button" key={item} className={detailCategory === item ? "is-active" : ""} aria-pressed={detailCategory === item} onClick={() => setDetailCategory(item)}>{item}</button>)}
        </ScrollableVideoCategories>
      ) : null}
      {matchingVideoCategoryDirectory.length ? <section className="video-category-directory" aria-label="動画カテゴリ検索結果">
        {matchingVideoCategoryDirectory.map((entry) => <article key={entry.category} className="video-category-directory__category">
          <button type="button" className="video-category-directory__parent" onClick={() => { setCategory(entry.category); setDetailCategory("すべて"); setQuery(""); }}>
            <strong>{entry.category}</strong><span>{videos.filter((video) => video.category === entry.category).length}本</span>
          </button>
          <div className="video-category-directory__children">
            {entry.children.map((item) => <button type="button" key={item} onClick={() => { setCategory(entry.category); setDetailCategory(item); setQuery(""); }}>{item}</button>)}
          </div>
        </article>)}
      </section> : null}
      {providers.length ? (
        <nav className="video-providers" aria-label="配信元">
          <button
            type="button"
            className={
              provider === "all" ? "video-provider-filter--active" : ""
            }
            aria-pressed={provider === "all"}
            onClick={() => setProvider("all")}
          >
            すべての配信元
          </button>
          {providers.map((item) => (
            <button
              type="button"
              key={item}
              className={
                provider === item ? "video-provider-filter--active" : ""
              }
              aria-pressed={provider === item}
              onClick={() => setProvider(item)}
            >
              {PROVIDER_LABELS[item]}
            </button>
          ))}
        </nav>
      ) : null}
      <div className="video-detail-filters" aria-label="動画の詳細フィルター">
        <label>長さ<select value={lengthFilter} onChange={(event) => setLengthFilter(event.target.value as typeof lengthFilter)}><option value="all">すべて</option><option value="under4">4分未満</option><option value="4to20">4〜20分</option><option value="over20">20分超</option></select></label>
        <label>視聴状態<select value={watchedFilter} onChange={(event) => setWatchedFilter(event.target.value as typeof watchedFilter)}><option value="all">すべて</option><option value="unwatched">未視聴</option><option value="watched">視聴済み</option></select></label>
        <label>投稿日<select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as typeof dateFilter)}><option value="all">すべて</option><option value="week">1週間以内</option><option value="month">1か月以内</option><option value="year">1年以内</option></select></label>
        <label>言語<select value={languageFilter} onChange={(event) => setLanguageFilter(event.target.value as typeof languageFilter)}><option value="all">すべて</option><option value="ja">日本語</option><option value="latin">英数字中心</option></select></label>
        <button type="button" aria-expanded={showRecommendationSettings} onClick={() => setShowRecommendationSettings((current) => !current)}>表示調整</button>
      </div>

      {showRecommendationSettings ? <section className="video-recommendation-settings" aria-labelledby="video-recommendation-settings-title"><header><div><small>PERSONALIZATION CONTROL</small><h2 id="video-recommendation-settings-title">表示調整</h2></div><button type="button" onClick={() => setShowRecommendationSettings(false)}>閉じる</button></header><div><section><h3>関心のある話題</h3>{Object.entries(shortPreferences.topics).filter(([, score]) => score > 0).sort((a, b) => b[1] - a[1]).map(([name]) => <button type="button" key={name} onClick={() => { const next = { ...shortPreferences, topics: { ...shortPreferences.topics, [name]: 0 } }; setShortPreferences(next); window.localStorage.setItem("hub.video-short-preferences.v1", JSON.stringify(next)); }}>{name}<span>解除</span></button>)}</section><section><h3>表示しないチャンネル</h3>{Object.entries(shortPreferences.channels).filter(([, score]) => score < 0).map(([name]) => <button type="button" key={name} onClick={() => { const next = { ...shortPreferences, channels: { ...shortPreferences.channels, [name]: 0 } }; setShortPreferences(next); window.localStorage.setItem("hub.video-short-preferences.v1", JSON.stringify(next)); }}>{name}<span>解除</span></button>)}</section><section><h3>興味なし履歴</h3>{videos.filter((video) => videoActivity[video.id]?.hidden).map((video) => <button type="button" key={video.id} onClick={() => { const current = videoActivity[video.id]; if (!current) return; const restored = { ...current, hidden: false }; setVideoActivity((items) => ({ ...items, [video.id]: restored })); saveVideoActivity(video, restored); }}>{video.title}<span>元に戻す</span></button>)}</section></div><footer><label><input type="checkbox" checked={historyEnabled} onChange={(event) => { setHistoryEnabled(event.target.checked); window.localStorage.setItem("hub.video-history.v1", event.target.checked ? "on" : "off"); if (!event.target.checked) clearVideoHistory(); }} />視聴履歴と「続きから見る」を保存する</label><label><input type="checkbox" checked={analyticsEnabled} onChange={(event) => { setAnalyticsEnabled(event.target.checked); window.localStorage.setItem("hub.video-analytics.v1", event.target.checked ? "on" : "off"); }} />匿名の再生イベントでおすすめを改善する</label><p>履歴は停止・消去できます。個人を識別する情報は保存しません。</p><button type="button" onClick={clearVideoHistory}>視聴履歴を消去</button><button type="button" onClick={() => { const next: ShortPreferenceProfile = { videos: {}, channels: {}, topics: {}, categories: {} }; setShortPreferences(next); window.localStorage.setItem("hub.video-short-preferences.v1", JSON.stringify(next)); }}>パーソナライズ学習をリセット</button></footer></section> : null}

      {mode !== "shorts" && continueWatchingVideos.length ? (
        <section className="video-continue-rail" aria-labelledby="video-continue-title">
          <header><h2 id="video-continue-title">続きから見る</h2></header>
          <div className="video-continue-rail__track">
            {continueWatchingVideos.map((video) => {
              const activity = videoActivity[video.id];
              const progress = activity?.durationSeconds ? Math.min(100, Math.round(activity.positionSeconds / activity.durationSeconds * 100)) : 0;
              return <article key={video.id}><button type="button" onClick={() => openVideoApp(video, videos.filter((item) => isShortVideo(item) === isShortVideo(video) && item.id !== video.id))}>
                  <VideoArtwork video={video} />
                  <span><strong>{video.title}</strong><small>{video.channel}</small><i style={{ width: `${progress}%` }} /></span>
                </button><button type="button" className="video-continue-rail__remove" aria-label={`${video.title}を続きから見るから削除`} onClick={() => {
                  window.localStorage.removeItem(`hub.video-playback.${video.id}`);
                  setVideoActivity((current) => { const next = { ...current }; delete next[video.id]; return next; });
                  if (authenticated) void fetch(`/api/videos/history?videoId=${encodeURIComponent(video.id)}`, { method: "DELETE", credentials: "same-origin" });
                }}>×</button></article>;
            })}
          </div>
        </section>
      ) : null}

      {mode !== "shorts" && mode !== "saved" && shortRailVideos.length ? (
        <section className="video-short-rail" aria-labelledby="video-short-rail-title">
          <header>
            <h2 id="video-short-rail-title">ショート</h2>
            <button type="button" onClick={() => { setMode("shorts"); setRankedVideos(null); }}>
              すべて見る
            </button>
          </header>
          <div className="video-short-rail__track">
            {shortRailVideos.map((video) => (
              <VideoCard
                key={video.id}
                video={video}
                short
                authenticated={authenticated}
                persistable={persistableVideoIdSet.has(video.id)}
                saved={savedVideoIds.has(video.id)}
                pending={videoActionPending.has(video.id)}
                playlists={playlists}
                onOpenShortApp={(selected) =>
                  openVideoApp(selected, [])
                }
                onSave={toggleSave}
                onAddToPlaylist={addToPlaylist}
              />
            ))}
          </div>
        </section>
      ) : null}

      {featured ? (
        <>
          <section
            className={`video-section${mode === "shorts" ? " video-section--shorts" : ""}`}
          >
            <header>
              <h2>
                {mode === "shorts"
                  ? "ショート動画"
                  : query || category !== "すべて" || provider !== "all"
                    ? "検索結果"
                    : "話題の動画リンク"}
              </h2>
              <small>{filtered.length}本</small>
            </header>
            <div className="video-grid">
              {filtered.map((video, index) => (
                <Fragment key={video.id}>
                  <VideoCard
                    video={video}
                    short={mode === "shorts"}
                    authenticated={authenticated}
                    persistable={persistableVideoIdSet.has(video.id)}
                    saved={savedVideoIds.has(video.id)}
                    pending={videoActionPending.has(video.id)}
                    playlists={playlists}
                    onOpenShortApp={(selected) =>
                      openVideoApp(selected, filtered.filter((item) => isShortVideo(item) === isShortVideo(selected) && item.id !== selected.id))}
                    onSave={toggleSave}
                    onAddToPlaylist={addToPlaylist}
                  />
                  {shouldInsertRecurringAd(index, adFirstAfterItem) ? (
                    <FirstPartyAdSlot placementKey="videos.discovery.inline" variant="video" developmentFallback={staticDemoServedAd("videos")} context={{pageType:"video_discovery",pageCategory:video.category,contentTags:[video.topic,video.category],language:"ja"}} />
                  ) : null}
                </Fragment>
              ))}
            </div>
            {mode !== "saved" && videos.length < catalogTotal && videos.length < MAX_LOADED_DISCOVERY_VIDEOS ? (
              <div ref={catalogSentinelRef} aria-live="polite">
                {catalogPending ? "読み込み中…" : null}
              </div>
            ) : null}
          </section>
        </>
      ) : (
        <section className="video-empty">
          <span aria-hidden="true">▶</span>
          <h2>
            {mode === "shorts"
              ? "ショート動画はまだありません"
              : mode === "saved"
                ? "保存した動画はまだありません"
                : videos.length
                  ? "条件に一致する動画がありません"
                  : "まだ動画が登録されていません"}
          </h2>
          <p>
            {mode === "shorts"
              ? "短尺動画やYouTube Shorts、TikTokをインポートすると、ここに自動でまとまります。"
              : mode === "saved"
                ? "動画カードの「あとで見る」から追加できます。"
                : videos.length
                  ? "検索語や絞り込みを変更してください。"
                  : authenticated
                    ? "上のフォームから最初の動画URLを共有できます。"
                    : "ログインすると動画URLを共有できます。"}
          </p>
          {videos.length && mode !== "saved" && mode !== "shorts" ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                setCategory("すべて");
                setProvider("all");
              }}
            >
              すべての動画に戻る
            </button>
          ) : null}
        </section>
      )}
      {shortApp ? (
        <div className="hub-short-app-layer">
          <button
            type="button"
            className="hub-short-app-backdrop"
            onClick={closeShortApp}
            aria-label="ショートアプリを閉じる"
          />
          <section className={`hub-short-app${isShortVideo(shortApp.video) ? " hub-short-app--short-fullscreen" : " hub-short-app--wide"}`} role="dialog" aria-modal="true" aria-label="Hub動画アプリ">
            <header>
              <span><strong>{isShortVideo(shortApp.video) ? "Hubショート" : "Hub動画"}</strong><button type="button" className="hub-short-app__channel" onClick={() => setChannelView((current) => current ? null : shortApp.video.channel)}>{shortApp.video.channel}</button></span>
              <nav aria-label="動画アプリ表示"><button type="button" aria-pressed={sidePanel === "thread"} onClick={() => { setSidePanel("thread"); setChannelView(null); }}>スレッド</button><button type="button" aria-pressed={sidePanel === "related"} onClick={() => { setSidePanel("related"); setChannelView(null); }}>関連動画</button></nav>
              <button type="button" onClick={closeShortApp} aria-label="閉じる">×</button>
            </header>
            <div className="hub-short-app__body">
            <div
              className="hub-short-app__player"
            >
            {videoSafetyNotice(shortApp.video) && !safetyAcceptedVideoIds.has(shortApp.video.id) ? (
              <div className="hub-video-safety-notice" role="alertdialog" aria-label="動画内容の確認">
                <strong>再生前の確認</strong>
                <p>{videoSafetyNotice(shortApp.video)}</p>
                <button type="button" onClick={() => setSafetyAcceptedVideoIds((current) => new Set(current).add(shortApp.video.id))}>確認して再生</button>
              </div>
            ) : shortApp.video.provider === "hub" ? <NativeVideoPlayer key={shortApp.video.id} videoId={shortApp.video.id} title={shortApp.video.title} /> : <CrossProviderVideoPlayer
              key={shortApp.video.provider}
              authenticated={authenticated}
              video={shortApp.video}
              initialPlaybackState={videoActivity[shortApp.video.id] ?? (() => {
                try { return JSON.parse(window.localStorage.getItem(`hub.video-playback.${shortApp.video.id}`) ?? "null") as VideoActivity | null ?? undefined; }
                catch { return undefined; }
              })()}
              seekToSeconds={requestedSeekSeconds}
              onPlaybackState={(state) => {
                setCurrentPlaybackSeconds(state.positionSeconds);
                saveVideoActivity(shortApp.video, state);
              }}
              autoplay={false}
              requireMostlyVisible={false}
              onStarted={() => undefined}
              onEnded={() => {
                saveVideoActivity(shortApp.video, { positionSeconds: 0, durationSeconds: 0, volume: 100, muted: false, completed: true });
              }}
              onPlaybackError={() => {
                setVideoAppMessage("この動画をHub内で再生できません。配信元サイトで確認してください。");
              }}
              onAutoplayBlocked={() => undefined}
            />}
            </div>
            <aside className="hub-short-app__thread">
              {sidePanel === "related" ? <section className="hub-video-related"><header><small>RELATED</small><h2>関連動画</h2></header><div>{relatedVideoCandidates(videos, shortApp.video).map((video) => <button type="button" key={video.id} onClick={() => openVideoApp(video, relatedVideoCandidates(videos, video))}><VideoArtwork video={video} /><span><strong>{video.title}</strong><small>{video.channel}</small><em>{video.topic === shortApp.video.topic ? "同じ話題" : video.channel === shortApp.video.channel ? "同じチャンネル" : recommendationReasonFor(video)}</em></span></button>)}</div></section> : channelView ? <section className="hub-video-channel">
                <header><small>CHANNEL</small><h2>{channelView}</h2><p>{videos.filter((video) => video.channel === channelView).length}本の動画</p><div><button type="button" aria-pressed={followedChannels.has(channelView)} onClick={() => toggleChannelFollow(channelView)}>{followedChannels.has(channelView) ? "フォロー中" : "フォロー"}</button></div></header>
                <div>{videos.filter((video) => video.channel === channelView && video.id !== shortApp.video.id).map((video) => <button type="button" key={video.id} onClick={() => { setChannelView(null); openVideoApp(video, videos.filter((item) => item.channel === channelView && item.id !== video.id)); }}><VideoArtwork video={video} /><span>{video.title}</span></button>)}</div>
              </section> : <ShortVideoThread authenticated={authenticated} videoId={shortApp.video.id} playbackSeconds={currentPlaybackSeconds} onSeek={(seconds) => {
                setRequestedSeekSeconds(seconds);
                setCurrentPlaybackSeconds(seconds);
              }} />}
            </aside>
            </div>
            <footer>
              <div className="hub-short-app__title"><strong>{shortApp.video.title}</strong><small>{shortApp.video.channel}</small></div>
              <button type="button" aria-pressed={videoEngagement.likedByViewer} disabled={!authenticated} onClick={() => {
                const liked = !videoEngagement.likedByViewer;
                void fetch(`/api/videos/${encodeURIComponent(shortApp.video.id)}/engagement`, { method: liked ? "POST" : "DELETE", credentials: "same-origin", headers: { "content-type": "application/json" }, body: liked ? JSON.stringify({ action: "like" }) : undefined })
                  .then((response) => response.ok ? response.json() : Promise.reject(new Error("いいねを更新できませんでした。")))
                  .then((payload: { likeCount: number; likedByViewer: boolean }) => setVideoEngagement(payload))
                  .catch((error: Error) => setVideoAppMessage(error.message));
              }}>いいね {videoEngagement.likeCount}</button>
              <button type="button" onClick={() => {
                const shareUrl = `${window.location.origin}/videos/${encodeURIComponent(shortApp.video.id)}`;
                void navigator.clipboard.writeText(shareUrl).then(
                  () => setVideoAppMessage("共有URLをコピーしました。"),
                  () => setVideoAppMessage("URLをコピーできませんでした。"),
                );
              }}>共有</button>
              <details className="hub-short-app__more" open={videoAppMenuOpen} onToggle={(event) => setVideoAppMenuOpen(event.currentTarget.open)}><summary aria-label="その他の操作">•••</summary><div>
              <a href={shortApp.video.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={() => recordVideoEvent(shortApp.video, "external")}>サイトで見る</a>
              <VideoReportPicker videoId={shortApp.video.id} authenticated={authenticated} />
              {shortApp.video.provider === "youtube" ? <button type="button" onClick={() => {
                revokeYouTubeEmbedConsent();
                setVideoAppMessage("YouTubeの埋め込み同意を解除しました。");
              }}>埋め込み同意を解除</button> : null}
              <button
                type="button"
                onClick={() => {
                  learnShort(shortApp.video, "notInterested");
                  saveVideoActivity(shortApp.video, { positionSeconds: 0, durationSeconds: 0, volume: 100, muted: false, completed: false, hidden: true });
                  setVideoActivity((current) => ({ ...current, [shortApp.video.id]: { videoId: shortApp.video.id, positionSeconds: 0, durationSeconds: 0, volume: 100, muted: false, completed: false, hidden: true, lastViewedAt: new Date().toISOString() } }));
                  setDismissedVideo(shortApp.video);
                  closeShortApp();
                }}
              >興味なし</button>
              <button
                type="button"
                onClick={() => {
                  setShortPreferences(recordShortChannelDismissal(window.localStorage, shortApp.video.channel));
                  closeShortApp();
                }}
              >このチャンネルを表示しない</button>
              </div></details>
            </footer>
            {videoAppMessage ? <p className="hub-short-app__message" role="status" aria-live="polite">{videoAppMessage}</p> : null}
            {dismissedVideo ? <div className="hub-video-undo" role="status"><span>「興味なし」にしました</span><button type="button" onClick={() => {
              const restored: VideoActivity = { ...(videoActivity[dismissedVideo.id] ?? { videoId: dismissedVideo.id, positionSeconds: 0, durationSeconds: 0, volume: 100, muted: false, completed: false, hidden: false }), hidden: false, lastViewedAt: new Date().toISOString() };
              setVideoActivity((current) => ({ ...current, [dismissedVideo.id]: restored }));
              saveVideoActivity(dismissedVideo, restored);
              setDismissedVideo(null);
              setVideoAppMessage("興味なしを取り消しました。");
            }}>元に戻す</button></div> : null}
          </section>
        </div>
      ) : null}
      </div>
    </section>
  );
}
