"use client";

import { useRouter } from "next/navigation";
import React, { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import {
  ExternalLink,
  Image as ImageIcon,
  Link2,
  Pencil,
  SlidersHorizontal,
  Trash2,
  UsersRound,
} from "lucide-react";

import { TabMainSearchHeader } from "@/components/tab-main-search-header";
import { EngagementBar } from "@/components/engagement-bar";
import { AsyncActionButton } from "@/components/async-action-button";
import { ExternalLinkCard } from "@/components/external-link-card";
import { PostActionRow } from "@/components/post-action-row";
import { PostAuthorRow, PostContentFrame } from "@/components/post-content-frame";
import { PostContextActions } from "@/components/post-context-actions";
import { TranslatedText } from "@/components/translated-text";
import { ContentTagLinks } from "@/components/content-tag-links";
import { CrossPostControl } from "@/components/cross-post-control";
import { UiButton, UiStatePanel } from "@/components/ui/primitives";
import { EngagementSummary, FollowRelation, SocialPost, ThreadPost, UserList } from "@/lib/domain";
import { newAuthorProfileIds, rankPopularFeed, sortNewestFeed, type FeedRankSignals } from "@/lib/feed-ranking";
import { sourceFeedCandidates } from "@/lib/feed-candidate-sourcing";
import { HUB_PERSONALIZATION_KEY, recordHubInterests } from "@/lib/hub-interest-profile";
import {
  HUB_RANKING_PREFERENCE_EVENT,
  readHubRankingPreference,
  type HubRankingPreference,
} from "@/lib/hub-ranking-preference";
import { withoutExternalCardUrl } from "@/lib/external-link";
import type { HubLocale } from "@/lib/i18n";
import { hubUi } from "@/lib/ui-copy";
import { FEED_PREFERENCES_EVENT, hideFeedItem, personalizePosts, primaryPostTopic, readHiddenPostIds, readHiddenTopics, readPostHistory, recommendationReason, recommendedInterest, rememberPost } from "@/lib/post-personalization";
import { shouldInsertRecurringAd } from "@/lib/ad-insertion-schedule";
import { extractContentTags } from "@/lib/content-tags";
import { FEED_REALTIME_SHARDS, FEED_REALTIME_STORAGE_KEY, normalizeFeedRealtimeShard, parseFeedRealtimeEvent } from "@/lib/feed-realtime";
import {
  normalizeHomeFeedReadState,
  readHomeFeedReadState,
  writeHomeFeedReadState,
  type HomeFeedReadState,
} from "@/lib/home-feed-read-state";
import { readHomeFeedSession, writeHomeFeedSession, type HomeFeedViewPosition } from "@/lib/home-feed-session";
import { recordPersonalNodeEventOnce } from "@/lib/personal-node-local-keystore";
import { encodeTimelineCursor } from "@/lib/timeline-cursor";
import { commitTextCrossPost, prepareTextCrossPost, type SocialTextProvider } from "@/lib/social-publisher-client";
import { HUB_SOCIAL_POST_MAX_CHARACTERS } from "@/lib/social-post-limits";
import { canContinueTimelinePage } from "@/lib/timeline-pagination";
import { HUB_COMPOSE_HASH, HUB_COMPOSE_OPEN_EVENT } from "@/lib/compose-events";
import {
  createFeedQuery,
  FEED_ACTIVE_QUERY_STORAGE_KEY,
  FEED_QUERY_STORAGE_KEY,
  feedQueryReducer,
  listFeedQuery,
  parseStoredFeedQueries,
  serializeFeedQueries,
  systemFeedQueries,
  type FeedQueryDefinition,
  type FeedQuerySort,
  type FeedQuerySource,
} from "@/lib/feed-queries";
import {
  activeSocialMention,
  replaceActiveSocialMention,
  type ActiveSocialMention,
} from "@/lib/social-mention-composer";

export interface TimelinePost extends SocialPost {
  avatarUrl?: string;
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  /* How many follow the author. Absent on feeds that are not D1-backed. */
  authorFollowerCount?: number;
  viewerReaction: EngagementSummary["viewerReaction"];
  viewerRepostId?: string | null;
  referenced?: { label: string; title: string; body: string; href: string; contextLabel?: string; avatarUrl?: string; avatarLabel?: string } | null;
}

export interface TimelineThreadResponse extends ThreadPost {
  threadTitle: string;
  authorAvatarUrl?: string;
  authorHandle?: string;
  engagement: EngagementSummary;
}

type TimelineListFeedItem =
  | { kind: "social"; createdAt: string; post: TimelinePost }
  | { kind: "thread-response"; createdAt: string; response: TimelineThreadResponse };

interface TimelineClientProps {
  authenticated?: boolean;
  locale: HubLocale;
  initialTab?: TimelineTab;
  posts: TimelinePost[];
  threadResponses: TimelineThreadResponse[];
  currentUserDisplayName: string;
  currentUserAvatarUrl?: string;
  currentProfileId: string;
  follows: FollowRelation[];
  lists: Array<UserList & {
    profileItems?: Array<{ id: string; displayName: string; handle: string }>;
    threadItems?: Array<{ id: string; title: string }>;
  }>;
  inlineAd?: React.ReactNode;
  adFirstAfterItem?: number;
}

type TimelineTab = "recommended" | "latest" | "popular" | "following" | "lists";
type ActivityPubRecommendation = {
  id: string;
  url: string;
  content: string;
  published?: string;
  sourceHost: string;
  actor: { name: string; handle: string; url: string };
};
type AtProtocolRecommendation = {
  uri: string;
  cid: string;
  author: { did: string; handle: string; displayName: string };
  text: string;
  createdAt: string;
  indexedAt: string;
  replyCount: number;
  repostCount: number;
  likeCount: number;
};
const FEED_BATCH_SIZE = 12;
const HOME_LAST_SEEN_POST_KEY = "hub.home.last-seen-post-id";
const NEW_POST_POLL_INTERVAL_MS = 45_000;
/*
 * Comfortably inside the idle window that was closing the connection, and
 * cheap: the reply is produced by the runtime, not by the object waking up.
 */
const FEED_REALTIME_HEARTBEAT_MS = 30_000;
/* Retries back off to this and stay there rather than growing without end. */
const FEED_REALTIME_RETRY_CEILING_MS = 60_000;
const SOCIAL_POST_CREATED_EVENT = "hub:social-post-created";
const SOCIAL_POST_MAX_LENGTH = HUB_SOCIAL_POST_MAX_CHARACTERS;
type StoredComposeDraft = { body: string; audience: "public" | "followers"; scheduledAt: string; imageAltTexts: string[]; clientRequestId?: string };
type MentionSuggestion = { id: string; handle: string; displayName: string };

type InertSnapshot = {
  element: HTMLElement;
  hadInertAttribute: boolean;
};

function isolateModalBranch(dialog: HTMLElement): () => void {
  const snapshots: InertSnapshot[] = [];
  let branch: HTMLElement = dialog;

  while (branch.parentElement) {
    const parent = branch.parentElement;
    for (const sibling of Array.from(parent.children)) {
      if (
        sibling === branch
        || !(sibling instanceof HTMLElement)
        || sibling.hasAttribute("data-mobile-compose-backdrop")
      ) {
        continue;
      }
      snapshots.push({
        element: sibling,
        hadInertAttribute: sibling.hasAttribute("inert"),
      });
      sibling.setAttribute("inert", "");
    }
    if (parent === document.body) break;
    branch = parent;
  }

  return () => {
    for (const snapshot of snapshots) {
      if (!snapshot.hadInertAttribute) snapshot.element.removeAttribute("inert");
    }
  };
}

function focusableDialogElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => !element.hasAttribute("inert") && element.getAttribute("aria-hidden") !== "true");
}

function MentionSuggestionList({
  id,
  locale,
  suggestions,
  selectedIndex,
  onChoose,
}: {
  id: string;
  locale: HubLocale;
  suggestions: MentionSuggestion[];
  selectedIndex: number;
  onChoose: (suggestion: MentionSuggestion) => void;
}) {
  if (!suggestions.length) return null;
  return (
    <div className="home-compose__mention-suggestions" id={id} role="listbox" aria-label={locale === "en" ? "Mention a user" : "ユーザーをメンション"}>
      {suggestions.map((suggestion, index) => (
        <button
          type="button"
          id={`${id}-${index}`}
          key={suggestion.id}
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(suggestion)}
        >
          <span aria-hidden="true">{avatarChar(suggestion.displayName)}</span>
          <strong>{suggestion.displayName}</strong>
          <small>@{suggestion.handle}</small>
        </button>
      ))}
    </div>
  );
}

function useMentionComposer(
  value: string,
  setValue: React.Dispatch<React.SetStateAction<string>>,
  inputRef: React.RefObject<HTMLTextAreaElement | null>,
  listId: string,
) {
  const [active, setActive] = useState<ActiveSocialMention | null>(null);
  const [suggestions, setSuggestions] = useState<MentionSuggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    if (!active?.query) {
      setSuggestions([]);
      setSelectedIndex(0);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/social/mention-suggestions?q=${encodeURIComponent(active.query)}`, {
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload = await response.json() as { suggestions?: MentionSuggestion[] };
        setSuggestions((payload.suggestions ?? []).slice(0, 5));
        setSelectedIndex(0);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) setSuggestions([]);
      }
    }, 150);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [active?.query]);

  const choose = (suggestion: MentionSuggestion) => {
    if (!active) return;
    const replacement = replaceActiveSocialMention(value, active, suggestion.handle);
    setValue(replacement.text);
    setActive(null);
    setSuggestions([]);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(replacement.caret, replacement.caret);
    });
  };

  const onChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(event.target.value);
    setActive(activeSocialMention(event.target.value, event.target.selectionStart));
  };

  const handleSuggestionKey = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions.length) return false;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelectedIndex((index) => (index + 1) % suggestions.length);
      return true;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelectedIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const suggestion = suggestions[selectedIndex];
      if (suggestion) choose(suggestion);
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setActive(null);
      setSuggestions([]);
      return true;
    }
    return false;
  };

  return {
    choose,
    handleSuggestionKey,
    inputProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": suggestions.length > 0,
      "aria-controls": suggestions.length > 0 ? listId : undefined,
      "aria-activedescendant": suggestions.length > 0 ? `${listId}-${selectedIndex}` : undefined,
      onChange,
    },
    selectedIndex,
    suggestions,
  };
}

function isTimelinePost(value: unknown): value is TimelinePost {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TimelinePost>;
  return typeof candidate.id === "string"
    && typeof candidate.body === "string"
    && typeof candidate.displayName === "string"
    && typeof candidate.createdAt === "string";
}

function feedViewKey(tab: TimelineTab, listId: string) {
  return tab === "lists" ? `lists:${listId}` : tab;
}

function scheduleFeedPositionRestore(main: HTMLElement, position: HomeFeedViewPosition) {
  let settle = 0;
  const restore = window.requestAnimationFrame(() => {
    settle = window.requestAnimationFrame(() => {
      const anchor = position.anchorPostId
        ? [...main.querySelectorAll<HTMLElement>(".tweet[data-post-context-id]")]
          .find((item) => item.dataset.postContextId === position.anchorPostId)
        : null;
      if (anchor) {
        const mainTop = main.getBoundingClientRect().top;
        const anchorTop = anchor.getBoundingClientRect().top;
        main.scrollTo({
          top: Math.max(0, main.scrollTop + anchorTop - mainTop - position.anchorOffset),
          left: 0,
          behavior: "instant",
        });
      } else {
        main.scrollTo({ top: position.scrollTop, left: 0, behavior: "instant" });
      }
    });
  });
  return () => {
    window.cancelAnimationFrame(restore);
    if (settle) window.cancelAnimationFrame(settle);
  };
}

function publishCreatedSocialPost(post: unknown) {
  if (typeof window === "undefined" || !isTimelinePost(post)) return;
  window.dispatchEvent(new CustomEvent<TimelinePost>(SOCIAL_POST_CREATED_EVENT, {
    detail: post,
  }));
}

function relativeTime(iso: string, locale: HubLocale): string {
  const copy = hubUi(locale).tweet;
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return copy.now;
  if (mins < 60) return `${mins}${copy.minute}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}${copy.hour}`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}${copy.day}`;
  return new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "ja-JP", { month: "short", day: "numeric" });
}

function avatarChar(name: string): string {
  return (name?.[0] ?? "?").toUpperCase();
}

const IconReply = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.5 9.7 9.7 0 0 1-4.1-.9L3 20.5l1.4-4.2A8.5 8.5 0 1 1 21 11.5Z" />
  </svg>
);

const IconRepost = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11V9a3 3 0 0 1 3-3h15" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v2a3 3 0 0 1-3 3H3" />
  </svg>
);

const IconLike = ({ active }: { active: boolean }) => (
  <svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill={active ? "currentColor" : "none"}
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    data-heart-state={active ? "filled" : "outline"}
  >
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z" />
  </svg>
);

const IconBookmark = ({ active }: { active: boolean }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill={active ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-bookmark-state={active ? "filled" : "outline"}>
    <path d="M6 3.5h12a1 1 0 0 1 1 1v16l-7-4.5-7 4.5v-16a1 1 0 0 1 1-1Z" />
  </svg>
);

const IconShare = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 16V3m0 0L7.5 7.5M12 3l4.5 4.5" />
    <path d="M5 12v6.25A2.75 2.75 0 0 0 7.75 21h8.5A2.75 2.75 0 0 0 19 18.25V12" />
  </svg>
);

function formatCount(n: number, locale: HubLocale): string {
  if (n <= 0) return "";
  if (n < 10000) return String(n);
  if (locale !== "en") {
    if (n >= 100000000) return `${Number((n / 100000000).toFixed(1))}億`;
    return `${Number((n / 10000).toFixed(1))}万`;
  }
  if (n >= 1000000) return `${Number((n / 1000000).toFixed(1))}M`;
  return `${Math.round(n / 1000)}k`;
}

async function getResponseError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as {
    error?: string | { message?: string };
  } | null;
  return typeof payload?.error === "string"
    ? payload.error
    : payload?.error?.message ?? fallback;
}

type ComposeImage = { sourceFile: File; file: File; thumbnail: File; previewUrl: string; width: number; height: number; thumbnailWidth: number; thumbnailHeight: number; altText: string };

type ImageCrop = "original" | "square" | "portrait" | "landscape";

const IMAGE_CROP_RATIOS: Record<Exclude<ImageCrop, "original">, number> = { square: 1, portrait: 4 / 5, landscape: 16 / 9 };

async function renderComposeImage(sourceFile: File, crop: ImageCrop, altText = ""): Promise<ComposeImage> {
  const bitmap = await createImageBitmap(sourceFile);
  const targetRatio = crop === "original" ? bitmap.width / bitmap.height : IMAGE_CROP_RATIOS[crop];
  const sourceRatio = bitmap.width / bitmap.height;
  let sourceWidth = bitmap.width; let sourceHeight = bitmap.height; let sourceX = 0; let sourceY = 0;
  if (sourceRatio > targetRatio) { sourceWidth = Math.round(bitmap.height * targetRatio); sourceX = Math.round((bitmap.width - sourceWidth) / 2); }
  else if (sourceRatio < targetRatio) { sourceHeight = Math.round(bitmap.width / targetRatio); sourceY = Math.round((bitmap.height - sourceHeight) / 2); }
  const scale = Math.min(1, 1600 / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) { bitmap.close(); throw new Error("画像を処理できませんでした。"); }
  context.drawImage(bitmap, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height); bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.82));
  if (!blob) throw new Error("画像を処理できませんでした。");
  const thumbnailScale = Math.min(1, 480 / Math.max(width, height));
  const thumbnailWidth = Math.max(1, Math.round(width * thumbnailScale));
  const thumbnailHeight = Math.max(1, Math.round(height * thumbnailScale));
  canvas.width = thumbnailWidth; canvas.height = thumbnailHeight;
  const thumbnailContext = canvas.getContext("2d");
  if (!thumbnailContext) throw new Error("画像を処理できませんでした。");
  const processedBitmap = await createImageBitmap(blob);
  thumbnailContext.drawImage(processedBitmap, 0, 0, thumbnailWidth, thumbnailHeight); processedBitmap.close();
  const thumbnailBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.72));
  if (!thumbnailBlob) throw new Error("画像を処理できませんでした。");
  const processed = new File([blob], `${sourceFile.name.replace(/\.[^.]+$/, "") || "image"}.webp`, { type: "image/webp" });
  const thumbnail = new File([thumbnailBlob], `${sourceFile.name.replace(/\.[^.]+$/, "") || "image"}.thumb.webp`, { type: "image/webp" });
  return { sourceFile, file: processed, thumbnail, previewUrl: URL.createObjectURL(processed), width, height, thumbnailWidth, thumbnailHeight, altText };
}

async function prepareComposeImage(file: File): Promise<ComposeImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("JPEG、PNG、WebP画像だけ選択できます。");
  if (file.size > 5 * 1024 * 1024) throw new Error("画像は1枚5MB以下にしてください。");
  return renderComposeImage(file, "original");
}

const BLOCKED_PROFILES_KEY = "hub.blockedProfileIds";
const MUTED_PROFILES_KEY = "hub.mutedProfileIds";
const PROFILE_CONTROL_EVENT = "hub-profile-controls-changed";
const SOCIAL_POST_DELETED_EVENT = "hub:social-post-deleted";
const SOCIAL_POST_ENGAGEMENT_EVENT = "hub:social-post-engagement-changed";
const SOCIAL_POST_EDITED_EVENT = "hub:social-post-edited";

type SocialPostEngagement = {
  replyCount: number;
  repostCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: EngagementSummary["viewerReaction"];
  viewerRepostId: string | null;
};

type SocialPostEngagementEventDetail = {
  postId: string;
  engagement: SocialPostEngagement;
};

type SocialPostEditedEventDetail = {
  postId: string;
  body: string;
};

function publishDeletedSocialPost(postId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(SOCIAL_POST_DELETED_EVENT, { detail: postId }));
}

function publishSocialPostEngagement(postId: string, engagement: SocialPostEngagement) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SocialPostEngagementEventDetail>(
    SOCIAL_POST_ENGAGEMENT_EVENT,
    { detail: { postId, engagement } },
  ));
}

function publishEditedSocialPost(postId: string, body: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<SocialPostEditedEventDetail>(
    SOCIAL_POST_EDITED_EVENT,
    { detail: { postId, body } },
  ));
}

function readProfileControl(key: string, profileId?: string | null): boolean {
  if (!profileId || typeof window === "undefined") return false;
  try {
    const ids = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    return Array.isArray(ids) && ids.includes(profileId);
  } catch {
    return false;
  }
}

function writeProfileControl(key: string, profileId: string, enabled: boolean) {
  const current = new Set<string>();
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
    if (Array.isArray(stored)) for (const id of stored) if (typeof id === "string") current.add(id);
  } catch {
    // Replace malformed device-local state.
  }
  if (enabled) current.add(profileId);
  else current.delete(profileId);
  localStorage.setItem(key, JSON.stringify([...current]));
  window.dispatchEvent(new CustomEvent(PROFILE_CONTROL_EVENT));
}

function useMasonryItem(enabled: boolean) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const item = ref.current;
    if (!enabled || !item || typeof ResizeObserver === "undefined") return;

    const updateSpan = () => {
      const grid = item.parentElement;
      if (!grid) return;
      const styles = getComputedStyle(grid);
      const rowHeight = Number.parseFloat(styles.gridAutoRows);
      const columnCount = styles.gridTemplateColumns.split(/\s+/).filter(Boolean).length;
      if (!Number.isFinite(rowHeight) || columnCount < 2) {
        item.style.removeProperty("grid-row-end");
        return;
      }
      const parsedRowGap = Number.parseFloat(styles.rowGap);
      const rowGap = Number.isFinite(parsedRowGap) ? parsedRowGap : 10;
      const span = Math.max(1, Math.ceil((item.getBoundingClientRect().height + rowGap) / (rowHeight + rowGap)));
      item.style.gridRowEnd = `span ${span}`;
    };

    updateSpan();
    const observer = new ResizeObserver(updateSpan);
    observer.observe(item);
    return () => {
      observer.disconnect();
      item.style.removeProperty("grid-row-end");
    };
  }, [enabled]);

  return ref;
}

export function TweetCard({ post, locale, viewerProfileId, masonry = false, recommendation }: { post: TimelinePost; locale: HubLocale; viewerProfileId?: string; masonry?: boolean; recommendation?: "follow" | "interest" | "popular" | "new" }) {
  const router = useRouter();
  const copy = hubUi(locale).tweet;
  const masonryRef = useMasonryItem(masonry);
  const [engagement, setEngagement] = useState({
    replyCount: post.replyCount,
    repostCount: post.repostCount + post.quoteRepostCount,
    likeCount: post.likeCount,
    score: post.score,
    bookmarked: post.bookmarked,
    viewerReaction: post.viewerReaction,
    viewerRepostId: post.viewerRepostId ?? null,
  });
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const replyInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [repostMenuOpen, setRepostMenuOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteBody, setQuoteBody] = useState("");
  const quoteInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editBody, setEditBody] = useState(post.body);
  const [savedBody, setSavedBody] = useState(post.body);
  const [actionBusy, setActionBusy] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStatus, setDeleteStatus] = useState<"confirming" | "submitting" | "failed">("confirming");
  const deleteConfirmRef = useRef<HTMLButtonElement | null>(null);
  const editOperationRef = useRef<{ body: string; id: string } | null>(null);
  const deleteOperationIdRef = useRef<string | null>(null);
  const createAttemptsRef = useRef(new Map<string, { fingerprint: string; requestId: string }>());
  const createInFlightRef = useRef(new Set<string>());
  const [moreOpen, setMoreOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [reportSendToOrigin, setReportSendToOrigin] = useState(false);
  const [reportStatus, setReportStatus] = useState<"idle" | "submitting" | "succeeded">("idle");
  const reportInitialFocusRef = useRef<HTMLSelectElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [hiddenByPreference, setHiddenByPreference] = useState(false);
  const [isPending, startTransition] = useTransition();
  const replyMention = useMentionComposer(replyBody, setReplyBody, replyInputRef, `reply-mention-${post.id}`);
  const quoteMention = useMentionComposer(quoteBody, setQuoteBody, quoteInputRef, `quote-mention-${post.id}`);

  const isRepost = Boolean(post.repostOfTargetId && !post.quoteOfTargetId);
  const displayedBody = withoutExternalCardUrl(savedBody);
  const isOwnPost = Boolean(viewerProfileId && post.authorProfileId === viewerProfileId);
  const canShowPostMenu = Boolean(post.authorProfileId);

  useEffect(() => {
    const sync = () => {
      setBlocked(readProfileControl(BLOCKED_PROFILES_KEY, post.authorProfileId));
      setMuted(readProfileControl(MUTED_PROFILES_KEY, post.authorProfileId));
    };
    sync();
    window.addEventListener(PROFILE_CONTROL_EVENT, sync);
    return () => window.removeEventListener(PROFILE_CONTROL_EVENT, sync);
  }, [post.authorProfileId]);

  useEffect(() => {
    const removeDeletedPost = (event: Event) => {
      if (event instanceof CustomEvent && event.detail === post.id) setDeleted(true);
    };
    window.addEventListener(SOCIAL_POST_DELETED_EVENT, removeDeletedPost);
    return () => window.removeEventListener(SOCIAL_POST_DELETED_EVENT, removeDeletedPost);
  }, [post.id]);

  useEffect(() => {
    const syncEngagement = (event: Event) => {
      const detail = (event as CustomEvent<SocialPostEngagementEventDetail>).detail;
      if (detail.postId === post.id) setEngagement(detail.engagement);
    };
    window.addEventListener(SOCIAL_POST_ENGAGEMENT_EVENT, syncEngagement);
    return () => window.removeEventListener(SOCIAL_POST_ENGAGEMENT_EVENT, syncEngagement);
  }, [post.id]);

  useEffect(() => {
    const syncEditedPost = (event: Event) => {
      const detail = (event as CustomEvent<SocialPostEditedEventDetail>).detail;
      if (detail.postId !== post.id) return;
      setSavedBody(detail.body);
      if (!editOpen) setEditBody(detail.body);
    };
    window.addEventListener(SOCIAL_POST_EDITED_EVENT, syncEditedPost);
    return () => window.removeEventListener(SOCIAL_POST_EDITED_EVENT, syncEditedPost);
  }, [editOpen, post.id]);

  useEffect(() => {
    if (!deleteOpen) return;
    deleteConfirmRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && deleteStatus !== "submitting") setDeleteOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [deleteOpen, deleteStatus]);

  useEffect(() => {
    if (!reportOpen) return;
    reportInitialFocusRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && reportStatus !== "submitting") setReportOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [reportOpen, reportStatus]);

  const openPost = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target;
    if (event.defaultPrevented || !(target instanceof Element)) return;
    if (target.closest("a, button, iframe, input, textarea, select, [contenteditable='true']")) return;
    if (window.getSelection()?.toString()) return;

    setRepostMenuOpen(false);
    rememberPost(window.localStorage, post.id);
    router.push(`/posts/${post.id}`);
  };

  const beginCreateAttempt = (kind: "reply" | "repost" | "quote", fingerprint: string) => {
    if (createInFlightRef.current.has(kind)) return null;
    const existing = createAttemptsRef.current.get(kind);
    const attempt = existing?.fingerprint === fingerprint
      ? existing
      : { fingerprint, requestId: crypto.randomUUID() };
    createAttemptsRef.current.set(kind, attempt);
    createInFlightRef.current.add(kind);
    return attempt;
  };

  const finishCreateAttempt = (kind: "reply" | "repost" | "quote", succeeded: boolean) => {
    createInFlightRef.current.delete(kind);
    if (succeeded) createAttemptsRef.current.delete(kind);
  };

  const submitReaction = (kind: "like") => {
    setError("");
    const previous = engagement;
    const activating = previous.viewerReaction !== kind;
    const optimistic = { ...previous, likeCount: Math.max(0, previous.likeCount + (activating ? 1 : -1)), score: Math.max(0, previous.score + (activating ? 1 : -1)), viewerReaction: activating ? kind : null };
    setEngagement(optimistic);
    publishSocialPostEngagement(post.id, optimistic);
    startTransition(async () => {
      try {
        const res = await fetch("/api/engagements/reaction", {
          method: activating ? "PUT" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_type: "social_post",
            target_id: post.id,
            kind,
            active: activating,
          })
        });
        if (!res.ok) {
          setEngagement(previous);
          publishSocialPostEngagement(post.id, previous);
          setError(await getResponseError(res, copy.updateFailed));
          return;
        }
        const payload = (await res.json()) as { summary: EngagementSummary };
        const confirmed = {
          ...optimistic,
          likeCount: payload.summary.likeCount,
          score: payload.summary.score,
          viewerReaction: payload.summary.viewerReaction
        };
        setEngagement(confirmed);
        publishSocialPostEngagement(post.id, confirmed);
      } catch (reactionError) {
        setEngagement(previous);
        publishSocialPostEngagement(post.id, previous);
        setError(reactionError instanceof Error ? reactionError.message : copy.updateFailed);
      }
    });
  };

  const submitBookmark = () => {
    setError("");
    const previous = engagement;
    const activating = !previous.bookmarked;
    const optimistic = { ...previous, score: Math.max(0, previous.score + (activating ? 4 : -4)), bookmarked: activating };
    setEngagement(optimistic);
    publishSocialPostEngagement(post.id, optimistic);
    startTransition(async () => {
      try {
        const res = await fetch("/api/engagements/bookmark", {
          method: activating ? "PUT" : "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target_type: "social_post",
            target_id: post.id,
            active: activating,
          })
        });
        if (!res.ok) {
          setEngagement(previous);
          publishSocialPostEngagement(post.id, previous);
          setError(await getResponseError(res, copy.updateFailed));
          return;
        }
        const payload = (await res.json()) as { summary: EngagementSummary };
        const confirmed = {
          ...optimistic,
          score: payload.summary.score,
          bookmarked: payload.summary.bookmarked
        };
        setEngagement(confirmed);
        publishSocialPostEngagement(post.id, confirmed);
      } catch {
        setEngagement(previous);
        publishSocialPostEngagement(post.id, previous);
        setError(copy.updateFailed);
      }
    });
  };

  const submitRepost = () => {
    if (engagement.viewerRepostId) {
      const previous = engagement;
      const repostId = engagement.viewerRepostId;
      const optimistic = {
        ...previous,
        repostCount: Math.max(0, previous.repostCount - 1),
        score: Math.max(0, previous.score - 5),
        viewerRepostId: null,
      };
      setError("");
      setRepostMenuOpen(false);
      setEngagement(optimistic);
      publishSocialPostEngagement(post.id, optimistic);
      startTransition(async () => {
        try {
          const response = await fetch(`/api/social/posts/${encodeURIComponent(repostId)}`, {
            method: "DELETE",
          });
          if (!response.ok) {
            setEngagement(previous);
            publishSocialPostEngagement(post.id, previous);
            setError(await getResponseError(response, copy.updateFailed));
            return;
          }
          router.refresh();
        } catch {
          setEngagement(previous);
          publishSocialPostEngagement(post.id, previous);
          setError(copy.updateFailed);
        }
      });
      return;
    }

    const attempt = beginCreateAttempt("repost", post.id);
    if (!attempt) return;
    setError("");
    setRepostMenuOpen(false);
    const previous = engagement;
    const optimistic = { ...previous, repostCount: previous.repostCount + 1, score: previous.score + 5 };
    setEngagement(optimistic);
    publishSocialPostEngagement(post.id, optimistic);
    startTransition(async () => {
      try {
        const res = await fetch("/api/social/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: "",
            identity_mode: "account",
            repost_of_target_type: "social_post",
            repost_of_target_id: post.id,
            client_request_id: attempt.requestId,
          })
        });
        if (!res.ok) {
          setEngagement(previous);
          publishSocialPostEngagement(post.id, previous);
          setError(await getResponseError(res, copy.updateFailed));
          finishCreateAttempt("repost", false);
          return;
        }
        const payload = await res.json() as { post?: TimelinePost };
        publishCreatedSocialPost(payload.post);
        const confirmed = {
          ...optimistic,
          viewerRepostId: payload.post?.id ?? null,
        };
        setEngagement(confirmed);
        publishSocialPostEngagement(post.id, confirmed);
        finishCreateAttempt("repost", true);
      } catch {
        setEngagement(previous);
        publishSocialPostEngagement(post.id, previous);
        setError(copy.updateFailed);
        finishCreateAttempt("repost", false);
      }
    });
  };

  const submitQuote = () => {
    const normalizedBody = quoteBody.trim();
    if (!normalizedBody) return;
    const attempt = beginCreateAttempt("quote", normalizedBody);
    if (!attempt) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/social/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: normalizedBody,
            identity_mode: "account",
            quote_of_target_type: "social_post",
            quote_of_target_id: post.id,
            client_request_id: attempt.requestId,
          })
        });
        if (!res.ok) {
          setError(await getResponseError(res, copy.updateFailed));
          finishCreateAttempt("quote", false);
          return;
        }
        const payload = await res.json() as { post?: TimelinePost };
        publishCreatedSocialPost(payload.post);
        const confirmed = {
          ...engagement,
          repostCount: engagement.repostCount + 1,
          score: engagement.score + 6
        };
        setEngagement(confirmed);
        publishSocialPostEngagement(post.id, confirmed);
        setQuoteBody("");
        setQuoteOpen(false);
        finishCreateAttempt("quote", true);
      } catch {
        setError(copy.updateFailed);
        finishCreateAttempt("quote", false);
      }
    });
  };

  const submitReply = () => {
    const normalizedBody = replyBody.trim();
    if (!normalizedBody) return;
    const attempt = beginCreateAttempt("reply", normalizedBody);
    if (!attempt) return;
    setError("");
    startTransition(async () => {
      try {
        const res = await fetch("/api/social/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            body: normalizedBody,
            identity_mode: "account",
            reply_to_post_id: post.id,
            client_request_id: attempt.requestId,
          })
        });
        if (!res.ok) {
          setError(await getResponseError(res, copy.updateFailed));
          finishCreateAttempt("reply", false);
          return;
        }
        const confirmed = {
          ...engagement,
          replyCount: engagement.replyCount + 1,
          score: engagement.score + 3
        };
        setEngagement(confirmed);
        publishSocialPostEngagement(post.id, confirmed);
        setReplyBody("");
        setReplyOpen(false);
        finishCreateAttempt("reply", true);
      } catch {
        setError(copy.updateFailed);
        finishCreateAttempt("reply", false);
      }
    });
  };

  const sharePost = async () => {
    const url = `${window.location.origin}/posts/${post.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: locale === "en" ? `${post.displayName}'s post` : `${post.displayName}のポスト`,
          text: savedBody || undefined,
          url
        });
      } else {
        await navigator.clipboard.writeText(url);
      }
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(copy.shareFailed);
    }
  };

  const copyPostLink = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/posts/${post.id}`);
      setError(locale === "en" ? "Post link copied." : "ポストのリンクをコピーしました。");
    } catch {
      setError(copy.shareFailed);
    }
    setMoreOpen(false);
  };

  const savePostEdit = async () => {
    const normalizedBody = editBody.trim();
    if (!normalizedBody || normalizedBody.length > SOCIAL_POST_MAX_LENGTH || actionBusy) return;
    const previousBody = savedBody;
    setActionBusy(true);
    setError("");
    setSavedBody(normalizedBody);
    publishEditedSocialPost(post.id, normalizedBody);
    try {
      const operation = editOperationRef.current?.body === normalizedBody
        ? editOperationRef.current
        : { body: normalizedBody, id: crypto.randomUUID() };
      editOperationRef.current = operation;
      await recordPersonalNodeEventOnce("hub.post.update", operation.id, {
        postId: post.id,
        body: normalizedBody,
      });
      const response = await fetch(`/api/social/posts/${post.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: normalizedBody, operation_id: operation.id }),
      });
      if (!response.ok) {
        setSavedBody(previousBody);
        publishEditedSocialPost(post.id, previousBody);
        setError(await getResponseError(response, copy.updateFailed));
        return;
      }
      const payload = await response.json().catch(() => null) as { post?: { body?: unknown } } | null;
      const confirmedBody = typeof payload?.post?.body === "string" ? payload.post.body : normalizedBody;
      editOperationRef.current = null;
      setSavedBody(confirmedBody);
      setEditBody(confirmedBody);
      publishEditedSocialPost(post.id, confirmedBody);
      setEditOpen(false);
    } catch (editError) {
      setSavedBody(previousBody);
      publishEditedSocialPost(post.id, previousBody);
      setError(editError instanceof Error ? editError.message : copy.updateFailed);
    } finally {
      setActionBusy(false);
    }
  };

  const deleteOwnPost = async () => {
    if (actionBusy || deleteStatus === "submitting") return;
    setActionBusy(true);
    setDeleteStatus("submitting");
    setError("");
    try {
      const operationId = deleteOperationIdRef.current ?? crypto.randomUUID();
      deleteOperationIdRef.current = operationId;
      await recordPersonalNodeEventOnce("hub.post.delete", operationId, { postId: post.id });
      const response = await fetch(`/api/social/posts/${post.id}`, {
        method: "DELETE",
        headers: { "x-hub-operation-id": operationId },
      });
      if (!response.ok) {
        setDeleteStatus("failed");
        return;
      }
      deleteOperationIdRef.current = null;
      setDeleteOpen(false);
      setDeleted(true);
      publishDeletedSocialPost(post.id);
    } catch {
      setDeleteStatus("failed");
    } finally {
      setActionBusy(false);
    }
  };

  const setAuthorControl = async (kind: "block" | "mute", enabled: boolean) => {
    if (!post.authorProfileId) return;
    const previousBlocked = blocked;
    const previousMuted = muted;
    if (kind === "block") {
      writeProfileControl(BLOCKED_PROFILES_KEY, post.authorProfileId, enabled);
      if (enabled) writeProfileControl(MUTED_PROFILES_KEY, post.authorProfileId, true);
      setBlocked(enabled);
      if (enabled) setMuted(true);
    } else {
      writeProfileControl(MUTED_PROFILES_KEY, post.authorProfileId, enabled);
      setMuted(enabled);
    }
    setMoreOpen(false);
    setActionBusy(true);
    setError("");
    try {
      const response = await fetch("/api/profile/safety", {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetProfileId: post.authorProfileId, action: kind, enabled }),
      });
      const payload = await response.json().catch(() => null) as {
        control?: { muted: boolean; blocked: boolean };
        error?: string;
      } | null;
      if (!response.ok || !payload?.control) throw new Error(payload?.error ?? copy.updateFailed);
      writeProfileControl(BLOCKED_PROFILES_KEY, post.authorProfileId, payload.control.blocked);
      writeProfileControl(MUTED_PROFILES_KEY, post.authorProfileId, payload.control.muted);
      setBlocked(payload.control.blocked);
      setMuted(payload.control.muted);
      router.refresh();
    } catch (controlError) {
      writeProfileControl(BLOCKED_PROFILES_KEY, post.authorProfileId, previousBlocked);
      writeProfileControl(MUTED_PROFILES_KEY, post.authorProfileId, previousMuted);
      setBlocked(previousBlocked);
      setMuted(previousMuted);
      setError(controlError instanceof Error ? controlError.message : copy.updateFailed);
    } finally {
      setActionBusy(false);
    }
  };

  const submitReport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (reportStatus !== "idle") return;
    setReportStatus("submitting");
    setError("");
    try {
      const response = await fetch(`/api/social/posts/${encodeURIComponent(post.id)}/report`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reportReason, details: reportDetails.trim(), ...(post.remote ? { sendToOrigin: reportSendToOrigin } : {}) }),
      });
      if (!response.ok) throw new Error(await getResponseError(response, locale === "en" ? "Could not submit report." : "通報を送信できませんでした。"));
      setReportStatus("succeeded");
    } catch (reportError) {
      setReportStatus("idle");
      setError(reportError instanceof Error ? reportError.message : (locale === "en" ? "Could not submit report." : "通報を送信できませんでした。"));
    }
  };

  if (deleted) return null;

  if (blocked || muted || hiddenByPreference) {
    const label = hiddenByPreference ? (locale === "en" ? "Preference" : "おすすめ調整") : blocked ? copy.blocked : copy.muted;
    return (
      <div className="tweet-placeholder" ref={masonryRef as React.RefObject<HTMLDivElement | null>}>
        <span>{label}{copy.hiddenPost}</span>
        <button
          type="button"
          onClick={() => {
            if (hiddenByPreference) setHiddenByPreference(false);
            if (post.authorProfileId && blocked) void setAuthorControl("block", false);
            else if (post.authorProfileId && muted) void setAuthorControl("mute", false);
          }}
        >
          {copy.reveal}
        </button>
      </div>
    );
  }

  return (
    <div
      ref={masonryRef as React.RefObject<HTMLDivElement | null>}
      className={`tweet tweet--clickable${masonry ? " tweet--masonry" : ""}${post.images?.length ? " tweet--media" : ""}${moreOpen || repostMenuOpen ? " tweet--menu-open" : ""}`}
      data-hubpedia-context={savedBody}
      data-post-context-id={post.id}
      onClick={openPost}
    >
      {post.authorProfileId ? (
        post.handle ? (
          <a href={`/profile/${post.handle}`} className="tweet__avatar" aria-label={`${post.displayName}${copy.profile}`}>
            {post.avatarUrl ? <img src={post.avatarUrl} alt="" className="tweet__avatar-image" /> : avatarChar(post.displayName)}
          </a>
        ) : (
          <div className="tweet__avatar" aria-hidden="true">
            {post.avatarUrl ? <img src={post.avatarUrl} alt="" className="tweet__avatar-image" /> : avatarChar(post.displayName)}
          </div>
        )
      ) : (
        <div className="tweet__avatar tweet__avatar--anonymous" aria-hidden="true">
          {avatarChar(post.displayName)}
        </div>
      )}

      <PostContentFrame>
        <PostAuthorRow
          name={post.handle ? (
            <a href={`/profile/${post.handle}`} className="tweet__name">{post.displayName}</a>
          ) : (
            <span className="tweet__name">{post.displayName}</span>
          )}
          handle={post.handle ? <a href={`/profile/${post.handle}`} className="tweet__handle">@{post.handle}</a> : null}
          meta={(
            <>
              {post.imported ? (
                <span
                  className="tweet__remote"
                  title={locale === "en"
                    ? `Imported from another Hub. Originally posted ${post.imported.originalPublishedAt}.${post.imported.verified ? "" : " Origin not verified."}`
                    : `他のハブから移転した投稿です。元の投稿日時: ${post.imported.originalPublishedAt}。${post.imported.verified ? "" : "出自は未確認です。"}`}
                >
                  {locale === "en" ? "Before the move" : "移転前の投稿"}{post.imported.verified ? "" : locale === "en" ? " (unverified)" : "（出自未確認）"}
                </span>
              ) : null}
              {post.remote ? (
                <a
                  href={post.remote.objectUrl ?? post.remote.actorUrl}
                  className="tweet__remote"
                  target="_blank"
                  rel="noopener noreferrer"
                  title={locale === "en" ? `From ${post.remote.host}. Open the original post.` : `${post.remote.host} のポスト。元のポストを開く`}
                  onClick={(event) => event.stopPropagation()}
                >
                  {post.remote.host}
                </a>
              ) : null}
              <a
                href={`/posts/${post.id}`}
                className="tweet__time"
                aria-label={locale === "en" ? `Open post from ${relativeTime(post.createdAt, locale)}` : `${relativeTime(post.createdAt, locale)}のポストを開く`}
                onClick={() => rememberPost(window.localStorage, post.id)}
              >
                {relativeTime(post.createdAt, locale)}
              </a>
            </>
          )}
          contextActions={<PostContextActions body={savedBody} targetId={post.id} targetType="social_post" href={`/posts/${post.id}`} locale={locale} />}
          menu={canShowPostMenu ? <div className="tweet__more" onClick={(event) => event.stopPropagation()}>
              <button
                type="button"
                className="tweet__more-trigger"
                aria-label={copy.menu}
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((open) => !open)}
              >
                <span aria-hidden="true">•••</span>
              </button>
              {moreOpen ? (
                <div className="tweet__more-menu" role="menu">
                  {isOwnPost ? <>
                    <button type="button" role="menuitem" onClick={() => { setEditOpen(true); setMoreOpen(false); }}>
                      <Pencil aria-hidden="true" />
                      {locale === "en" ? "Edit post" : "ポストを編集"}
                    </button>
                    <button type="button" role="menuitem" onClick={() => router.push(`/posts/${post.id}`)}>
                      <ExternalLink aria-hidden="true" />
                      {locale === "en" ? "Open post" : "ポストを開く"}
                    </button>
                    <button type="button" role="menuitem" onClick={() => { void copyPostLink(); }}>
                      <Link2 aria-hidden="true" />
                      {locale === "en" ? "Copy post link" : "ポストのリンクをコピー"}
                    </button>
                    <button type="button" role="menuitem" className="tweet__more-danger" disabled={actionBusy} onClick={() => { setMoreOpen(false); setDeleteStatus("confirming"); setDeleteOpen(true); }}>
                      <Trash2 aria-hidden="true" />
                      {locale === "en" ? "Delete post" : "ポストを削除"}
                    </button>
                  </> : <>
                    <button type="button" role="menuitem" onClick={() => { setMoreOpen(false); router.push(`/posts/${post.id}`); }}>
                      <ExternalLink aria-hidden="true" />
                      {locale === "en" ? "Open post" : "ポストを開く"}
                    </button>
                    <button type="button" role="menuitem" onClick={() => { hideFeedItem(window.localStorage, post.id); setHiddenByPreference(true); setMoreOpen(false); }}>
                      {locale === "en" ? "Show fewer posts like this" : "この投稿を減らす"}
                    </button>
                    <button type="button" role="menuitem" onClick={() => { hideFeedItem(window.localStorage, post.id, primaryPostTopic(post.body)); setHiddenByPreference(true); setMoreOpen(false); }}>
                      {locale === "en" ? "Hide this topic" : "この話題を表示しない"}
                    </button>
                    <button type="button" role="menuitem" disabled={actionBusy} onClick={() => { void setAuthorControl("mute", !muted); }}>
                      {locale === "en" ? `${copy.mute}${post.handle ?? post.displayName}` : `@${post.handle ?? post.displayName}${copy.mute}`}
                    </button>
                    <button type="button" role="menuitem" className="tweet__more-danger" disabled={actionBusy} onClick={() => { void setAuthorControl("block", !blocked); }}>
                      {locale === "en" ? `${copy.block}${post.handle ?? post.displayName}` : `@${post.handle ?? post.displayName}${copy.block}`}
                    </button>
                    <button type="button" role="menuitem" className="tweet__more-danger tweet__report-menu-item" onClick={() => { setReportOpen(true); setMoreOpen(false); setReportStatus("idle"); }}>
                      {locale === "en" ? "Report post" : "ポストを通報"}
                    </button>
                  </>}
                </div>
              ) : null}
            </div> : null}
        />

        {isRepost && post.referenced ? (
          <div className="tweet__repost-label">
            <IconRepost />
            <span>{post.referenced.href.startsWith("/community")
              ? (locale === "en" ? "Shared from a community" : "コミュニティから共有")
              : (locale === "en" ? `Reposted ${post.referenced.title}` : `${post.referenced.title} をリポスト`)}</span>
          </div>
        ) : null}

        {editOpen ? (
          <div className="tweet__reply-form" onClick={(event) => event.stopPropagation()}>
            <textarea
              className="tweet__reply-textarea"
              value={editBody}
              maxLength={SOCIAL_POST_MAX_LENGTH}
              disabled={actionBusy}
              aria-label={locale === "en" ? "Edit post" : "ポストを編集"}
              onChange={(event) => setEditBody(event.target.value)}
            />
            <div className="tweet__reply-footer">
              <button type="button" disabled={actionBusy} onClick={() => { setEditBody(savedBody); setEditOpen(false); }}>
                {locale === "en" ? "Cancel" : "キャンセル"}
              </button>
              <button type="button" disabled={actionBusy || !editBody.trim() || editBody.trim() === savedBody} onClick={() => void savePostEdit()}>
                {actionBusy ? (locale === "en" ? "Saving…" : "保存中…") : (locale === "en" ? "Save" : "保存")}
              </button>
            </div>
          </div>
        ) : displayedBody && !isRepost ? <TranslatedText className="tweet__text" locale={locale} targetId={post.id} targetType="social_post" text={displayedBody} /> : null}
        {!isRepost ? <ContentTagLinks tags={post.tags} /> : null}
        {savedBody && !isRepost ? <ExternalLinkCard body={savedBody} /> : null}
        {post.images?.length ? <div className={`post-image-grid post-image-grid--${post.images.length}`}>
          {post.images.map((image) => <a href={image.url} target="_blank" rel="noreferrer" className="post-image-grid__item" key={image.id} onClick={(event) => event.stopPropagation()}>
            <img src={image.url} alt={image.altText} width={image.width} height={image.height} loading="lazy" />
          </a>)}
        </div> : null}

        {post.referenced ? (
          <a href={post.referenced.href} className="tweet__quote tweet__quote--link">
            {post.referenced.href.startsWith("/community") ? (
              <span className="tweet__quote-context">{post.referenced.contextLabel ?? (locale === "en" ? "Community post" : "コミュニティ投稿")}</span>
            ) : null}
            <div className="tweet__quote-header">
              <span className="tweet__quote-avatar" aria-hidden="true">
                {post.referenced.avatarUrl
                  ? <img src={post.referenced.avatarUrl} alt="" className="tweet__avatar-image" />
                  : avatarChar(post.referenced.avatarLabel ?? post.referenced.title)}
              </span>
              <span className="tweet__quote-name">{post.referenced.title}</span>
            </div>
            <p className="tweet__quote-body">{post.referenced.body}</p>
          </a>
        ) : null}

        <PostActionRow
          reply={<button
            className={`tweet__action${replyOpen ? " tweet__action--active" : ""}`}
            onClick={() => {
              setReplyOpen((open) => !open);
              setRepostMenuOpen(false);
              setQuoteOpen(false);
            }}
            disabled={isPending}
            title={copy.reply}
            aria-label={copy.reply}
            aria-expanded={replyOpen}
          >
            <span className="tweet__action-icon"><IconReply /></span>
            {engagement.replyCount > 0 ? <span className="tweet__action-count">{formatCount(engagement.replyCount, locale)}</span> : null}
          </button>}
          repost={<div className="tweet__repost-control">
            <button
              className={`tweet__action tweet__action--repost${repostMenuOpen || engagement.viewerRepostId ? " tweet__action--active" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                setRepostMenuOpen((open) => !open);
                setReplyOpen(false);
                setQuoteOpen(false);
              }}
              disabled={isPending}
              title={copy.repost}
              aria-label={copy.repost}
              aria-expanded={repostMenuOpen}
              aria-haspopup="menu"
              aria-pressed={Boolean(engagement.viewerRepostId)}
            >
              <span className="tweet__action-icon"><IconRepost /></span>
              {engagement.repostCount > 0 ? <span className="tweet__action-count">{formatCount(engagement.repostCount, locale)}</span> : null}
            </button>

            {repostMenuOpen ? (
              <div className="tweet__repost-menu" role="menu" onClick={(event) => event.stopPropagation()}>
                <button className="tweet__repost-menu-item" role="menuitem" onClick={submitRepost} disabled={isPending}>
                  <IconRepost /> {engagement.viewerRepostId
                    ? (locale === "en" ? "Undo repost" : "リポストを取り消す")
                    : copy.repost}
                </button>
                <button
                  className="tweet__repost-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setRepostMenuOpen(false);
                    setQuoteOpen(true);
                  }}
                  disabled={isPending}
                >
                  {copy.quote}
                </button>
              </div>
            ) : null}
          </div>}
          like={<button
            className={`tweet__action tweet__action--like${engagement.viewerReaction === "like" ? " tweet__action--active" : ""}`}
            onClick={() => submitReaction("like")}
            disabled={isPending}
            title={engagement.viewerReaction === "like" ? "いいねを取り消す" : copy.like}
            aria-label={engagement.viewerReaction === "like" ? "いいねを取り消す" : copy.like}
            aria-pressed={engagement.viewerReaction === "like"}
          >
            <span className="tweet__action-icon"><IconLike active={engagement.viewerReaction === "like"} /></span>
            {engagement.likeCount > 0 ? <span className="tweet__action-count">{formatCount(engagement.likeCount, locale)}</span> : null}
          </button>}
          bookmark={<button
            className={`tweet__action tweet__action--bookmark${engagement.bookmarked ? " tweet__action--active" : ""}`}
            onClick={submitBookmark}
            disabled={isPending}
            title={engagement.bookmarked ? "ブックマークを解除" : copy.bookmark}
            aria-label={engagement.bookmarked ? "ブックマークを解除" : copy.bookmark}
            aria-pressed={engagement.bookmarked}
          >
            <span className="tweet__action-icon"><IconBookmark active={engagement.bookmarked} /></span>
          </button>}
          share={<button
            className="tweet__action tweet__action--share"
            onClick={(event) => {
              event.stopPropagation();
              void sharePost();
            }}
            disabled={isPending}
            title={copy.share}
            aria-label={copy.share}
          >
            <span className="tweet__action-icon"><IconShare /></span>
          </button>}
        />

        {error ? <p className="inline-error">{error}</p> : null}

        {replyOpen ? (
          <div className="tweet__reply-form" onClick={(event) => event.stopPropagation()}>
            <textarea
              ref={replyInputRef}
              className="tweet__reply-textarea"
              placeholder={copy.replyPlaceholder}
              value={replyBody}
              maxLength={SOCIAL_POST_MAX_LENGTH}
              {...replyMention.inputProps}
              onKeyDown={(event) => {
                if (replyMention.handleSuggestionKey(event)) return;
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submitReply();
              }}
              disabled={isPending}
              autoFocus
            />
            <MentionSuggestionList
              id={`reply-mention-${post.id}`}
              locale={locale}
              suggestions={replyMention.suggestions}
              selectedIndex={replyMention.selectedIndex}
              onChoose={replyMention.choose}
            />
            <ExternalLinkCard body={replyBody} />
            <div className="tweet__reply-footer">
              <span className="tl-compose__identity">{copy.account}</span>
              <button
                type="button"
                className="button tweet__composer-cancel"
                onClick={() => setReplyOpen(false)}
              >
                {hubUi(locale).common.cancel}
              </button>
              <AsyncActionButton type="button" className="tl-compose__submit" onClick={submitReply} pending={isPending} pendingLabel="送信中…" disabled={!replyBody.trim()}>
                {copy.submitReply}
              </AsyncActionButton>
            </div>
          </div>
        ) : null}

        {quoteOpen ? (
          <div className="tweet__reply-form" onClick={(event) => event.stopPropagation()}>
            <div className="tweet__quote tweet__quote--composer">
              <div className="tweet__quote-header">
                <span className="tweet__quote-name">
                  {post.displayName}
                  {post.handle ? ` @${post.handle}` : ""}
                </span>
              </div>
              <p className="tweet__quote-body">{post.body}</p>
            </div>
            <textarea
              ref={quoteInputRef}
              className="tweet__reply-textarea"
              placeholder={copy.quotePlaceholder}
              value={quoteBody}
              maxLength={SOCIAL_POST_MAX_LENGTH}
              {...quoteMention.inputProps}
              onKeyDown={(event) => {
                if (quoteMention.handleSuggestionKey(event)) return;
                if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submitQuote();
              }}
              disabled={isPending}
              autoFocus
            />
            <MentionSuggestionList
              id={`quote-mention-${post.id}`}
              locale={locale}
              suggestions={quoteMention.suggestions}
              selectedIndex={quoteMention.selectedIndex}
              onChoose={quoteMention.choose}
            />
            <ExternalLinkCard body={quoteBody} />
            <div className="tweet__reply-footer">
              <button
                type="button"
                className="button tweet__composer-cancel"
                onClick={() => setQuoteOpen(false)}
              >
                {hubUi(locale).common.cancel}
              </button>
              <AsyncActionButton type="button" className="tl-compose__submit" onClick={submitQuote} pending={isPending} pendingLabel="送信中…" disabled={!quoteBody.trim()}>
                {copy.submitPost}
              </AsyncActionButton>
            </div>
          </div>
        ) : null}
      </PostContentFrame>
      {deleteOpen ? (
        <div
          className="tweet-report-dialog__backdrop"
          role="presentation"
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget && deleteStatus !== "submitting") setDeleteOpen(false);
          }}
        >
          <section
            className="tweet-report-dialog tweet-delete-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`delete-title-${post.id}`}
            aria-describedby={`delete-description-${post.id}`}
            onClick={(event) => event.stopPropagation()}
          >
            <header>
              <div>
                <h2 id={`delete-title-${post.id}`}>{locale === "en" ? "Delete post?" : "ポストを削除しますか？"}</h2>
                <p id={`delete-description-${post.id}`}>
                  {locale === "en"
                    ? "This post will disappear from feeds and conversations. This cannot be undone."
                    : "このポストはフィードと会話から表示されなくなります。この操作は元に戻せません。"}
                </p>
              </div>
            </header>
            <div className="tweet-delete-dialog__preview">
              <strong>{post.displayName}</strong>
              <p>{savedBody || (locale === "en" ? "Post without text" : "本文のないポスト")}</p>
            </div>
            {deleteStatus === "failed" ? (
              <p className="inline-error" role="alert">
                {locale === "en" ? "Could not confirm deletion. Try again." : "削除を確認できませんでした。もう一度お試しください。"}
              </p>
            ) : null}
            <footer>
              <UiButton type="button" disabled={deleteStatus === "submitting"} onClick={() => setDeleteOpen(false)}>
                {locale === "en" ? "Cancel" : "キャンセル"}
              </UiButton>
              <UiButton
                ref={deleteConfirmRef}
                type="button"
                tone="danger"
                className="tweet-report-dialog__submit"
                pending={deleteStatus === "submitting"}
                pendingLabel={locale === "en" ? "Deleting…" : "削除中…"}
                onClick={() => void deleteOwnPost()}
              >
                {locale === "en" ? "Delete post" : "ポストを削除"}
              </UiButton>
            </footer>
          </section>
        </div>
      ) : null}
      {reportOpen ? (
        <div className="tweet-report-dialog__backdrop" role="presentation" onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget && reportStatus !== "submitting") setReportOpen(false); }}>
          <section className="tweet-report-dialog" role="dialog" aria-modal="true" aria-labelledby={`report-title-${post.id}`} onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h2 id={`report-title-${post.id}`}>{locale === "en" ? "Report post" : "ポストを通報"}</h2>
                <p>{locale === "en" ? "Reports are reviewed by Hub moderators. The author is not told who reported it." : "Hubの管理者が内容を確認します。通報者の情報は投稿者へ表示されません。"}</p>
              </div>
              <button type="button" aria-label={locale === "en" ? "Close" : "閉じる"} disabled={reportStatus === "submitting"} onClick={() => setReportOpen(false)}>×</button>
            </header>
            {reportStatus === "succeeded" ? (
              <div className="tweet-report-dialog__receipt" role="status">
                <strong>{locale === "en" ? "Report received" : "通報を受け付けました"}</strong>
                <p>{locale === "en" ? "You do not need to submit the same report again." : "同じ内容を再送する必要はありません。"}</p>
                <button type="button" onClick={() => setReportOpen(false)}>{locale === "en" ? "Done" : "完了"}</button>
              </div>
            ) : (
              <form onSubmit={submitReport}>
                <label>
                  <span>{locale === "en" ? "Reason" : "通報理由"}</span>
                  <select ref={reportInitialFocusRef} value={reportReason} disabled={reportStatus === "submitting"} onChange={(event) => setReportReason(event.target.value)}>
                    <option value="spam">{locale === "en" ? "Spam" : "スパム"}</option>
                    <option value="sexual">{locale === "en" ? "Sexual content" : "性的な内容"}</option>
                    <option value="violence">{locale === "en" ? "Violence" : "暴力的な内容"}</option>
                    <option value="privacy">{locale === "en" ? "Privacy" : "プライバシー侵害"}</option>
                    <option value="copyright">{locale === "en" ? "Copyright" : "著作権侵害"}</option>
                    <option value="other">{locale === "en" ? "Other" : "その他"}</option>
                  </select>
                </label>
                <label>
                  <span>{locale === "en" ? "Details (optional)" : "詳細（任意）"}</span>
                  <textarea value={reportDetails} maxLength={500} disabled={reportStatus === "submitting"} onChange={(event) => setReportDetails(event.target.value)} />
                  <small>{reportDetails.length}/500</small>
                </label>
                {post.remote ? (
                  <label>
                    <span>
                      <input type="checkbox" checked={reportSendToOrigin} disabled={reportStatus === "submitting"} onChange={(event) => setReportSendToOrigin(event.target.checked)} />{" "}
                      {locale === "en" ? `Also send this report to ${post.remote.host}` : `${post.remote.host} にも通報を送る`}
                    </span>
                    <small>{locale === "en" ? "Only the post link and the reason category are sent. Your account is not shared." : "送るのは投稿のURLと理由の分類だけです。あなたのアカウントは伝わりません。"}</small>
                  </label>
                ) : null}
                <footer>
                  <button type="button" disabled={reportStatus === "submitting"} onClick={() => setReportOpen(false)}>{locale === "en" ? "Cancel" : "キャンセル"}</button>
                  <button type="submit" className="tweet-report-dialog__submit" disabled={reportStatus === "submitting"}>
                    {reportStatus === "submitting" ? (locale === "en" ? "Submitting…" : "送信中…") : (locale === "en" ? "Submit report" : "通報を送信")}
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

export function ThreadResponseCard({ response, locale, masonry = false }: { response: TimelineThreadResponse; locale: HubLocale; masonry?: boolean }) {
  const copy = hubUi(locale).tweet;
  const masonryRef = useMasonryItem(masonry);
  return (
    <article ref={masonryRef as React.RefObject<HTMLElement | null>} className="tweet tweet--thread-response">
      {response.authorProfileId ? (
        response.authorHandle ? (
          <a href={`/profile/${response.authorHandle}`} className="tweet__avatar" aria-label={`${response.displayName}${copy.profile}`}>
            {response.authorAvatarUrl ? <img src={response.authorAvatarUrl} alt="" className="tweet__avatar-image" /> : avatarChar(response.displayName)}
          </a>
        ) : (
          <div className="tweet__avatar" aria-hidden="true">
            {response.authorAvatarUrl ? <img src={response.authorAvatarUrl} alt="" className="tweet__avatar-image" /> : avatarChar(response.displayName)}
          </div>
        )
      ) : null}
      <PostContentFrame>
        <PostAuthorRow
          name={response.authorHandle
            ? <a href={`/profile/${response.authorHandle}`} className="tweet__name">{response.displayName}</a>
            : <span className="tweet__name">{response.displayName}</span>}
          handle={response.authorHandle
            ? <a href={`/profile/${response.authorHandle}`} className="tweet__handle">@{response.authorHandle}</a>
            : null}
          meta={<span className="tweet__time">{relativeTime(response.createdAt, locale)}</span>}
          contextActions={<PostContextActions body={response.body} targetId={response.id} targetType="thread_post" href={`/threads/${response.threadId}#post-${response.no}`} locale={locale} />}
        />
        <a href={`/threads/${response.threadId}`} className="tweet__thread-context">
          <span>{copy.thread}</span>
          <strong>{response.threadTitle}</strong>
          <small>#{response.no}</small>
        </a>
        <TranslatedText className="tweet__text" locale={locale} targetId={response.id} targetType="thread_post" text={withoutExternalCardUrl(response.body)} />
        <ExternalLinkCard body={response.body} />
        <div className="tweet__thread-engagement">
          <EngagementBar summary={response.engagement} threadId={response.threadId} threadPostNo={response.no} />
        </div>
      </PostContentFrame>
    </article>
  );
}

function ActivityPubRecommendationCard({ item, locale }: { item: ActivityPubRecommendation; locale: HubLocale }) {
  const published = item.published
    ? new Intl.DateTimeFormat(locale === "en" ? "en" : "ja-JP", { dateStyle: "medium" }).format(new Date(item.published))
    : null;
  return (
    <article className="tweet tweet--masonry activitypub-recommendation">
      <header className="activitypub-recommendation__header">
        <a href={item.actor.url} target="_blank" rel="noopener noreferrer">
          <strong>{item.actor.name}</strong><span>{item.actor.handle}</span>
        </a>
        <span>{published}</span>
      </header>
      <a className="activitypub-recommendation__body" href={item.url} target="_blank" rel="noopener noreferrer">{item.content}</a>
      <footer className="activitypub-recommendation__footer">
        <span>{locale === "en" ? "From the federated network" : "外部ネットワークから"} · {item.sourceHost}</span>
        <ExternalLink aria-hidden="true" />
      </footer>
    </article>
  );
}

function atProtocolPostUrl(item: AtProtocolRecommendation) {
  const match = item.uri.match(/^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/u);
  return match
    ? `https://bsky.app/profile/${encodeURIComponent(match[1])}/post/${encodeURIComponent(match[2])}`
    : null;
}

function AtProtocolRecommendationCard({ item, locale }: { item: AtProtocolRecommendation; locale: HubLocale }) {
  const href = atProtocolPostUrl(item);
  const published = new Intl.DateTimeFormat(locale === "en" ? "en" : "ja-JP", {
    dateStyle: "medium",
  }).format(new Date(item.createdAt));
  return (
    <article className="tweet tweet--masonry activitypub-recommendation atproto-recommendation">
      <header className="activitypub-recommendation__header">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            <strong>{item.author.displayName || item.author.handle}</strong><span>@{item.author.handle}</span>
          </a>
        ) : (
          <span><strong>{item.author.displayName || item.author.handle}</strong> @{item.author.handle}</span>
        )}
        <span>{published}</span>
      </header>
      {href ? (
        <a className="activitypub-recommendation__body" href={href} target="_blank" rel="noopener noreferrer">{item.text}</a>
      ) : (
        <p className="activitypub-recommendation__body">{item.text}</p>
      )}
      <footer className="activitypub-recommendation__footer">
        <span>{locale === "en" ? "From AT Protocol" : "AT Protocolから"} · {item.author.handle}</span>
        <span>{locale === "en" ? "Replies" : "返信"} {item.replyCount} · {locale === "en" ? "Reposts" : "リポスト"} {item.repostCount} · {locale === "en" ? "Likes" : "いいね"} {item.likeCount}</span>
      </footer>
    </article>
  );
}

export function TimelineClient({
  authenticated = true,
  locale,
  initialTab = "recommended",
  posts: initialPosts,
  threadResponses,
  currentUserDisplayName,
  currentUserAvatarUrl,
  currentProfileId,
  follows,
  lists,
  inlineAd,
  adFirstAfterItem = 1,
}: TimelineClientProps) {
  const router = useRouter();
  const ui = hubUi(locale);
  const copy = ui.feed;
  const tabs = useMemo(() => systemFeedQueries(locale === "en" ? "en" : "ja"), [locale]);
  const [queryState, dispatchQuery] = useReducer(feedQueryReducer, {
    activeId: initialTab === "lists" && lists[0] ? `list-${lists[0].id}` : initialTab,
    custom: [],
  });
  const [queryEditorOpen, setQueryEditorOpen] = useState(false);
  /* The page-left column's phone drawer (the shared bbs-* column contract). */
  const [feedDirectoryOpen, setFeedDirectoryOpen] = useState(false);
  const [queryLabel, setQueryLabel] = useState("");
  const [queryKeyword, setQueryKeyword] = useState("");
  const [querySource, setQuerySource] = useState<Exclude<FeedQuerySource, "list">>("recommended");
  const [querySort, setQuerySort] = useState<FeedQuerySort>("relevance");
  const [activeTab, setActiveTab] = useState<TimelineTab>(initialTab);
  const [posts, setPosts] = useState(initialPosts);
  const [recommendedCandidates, setRecommendedCandidates] = useState(initialPosts);
  const [activityPubRecommendations, setActivityPubRecommendations] = useState<ActivityPubRecommendation[]>([]);
  const [atProtocolRecommendations, setAtProtocolRecommendations] = useState<AtProtocolRecommendation[]>([]);
  const [hasMoreRecommendedPosts, setHasMoreRecommendedPosts] = useState(initialPosts.length >= FEED_BATCH_SIZE);
  const [recommendedFeedLoaded, setRecommendedFeedLoaded] = useState(false);
  const [recommendedServerOffset, setRecommendedServerOffset] = useState(initialPosts.length);
  const [popularPosts, setPopularPosts] = useState(() => rankPopularFeed(initialPosts));
  const [popularServerOffset, setPopularServerOffset] = useState(initialPosts.length);
  const [hasMorePopularPosts, setHasMorePopularPosts] = useState(initialPosts.length >= FEED_BATCH_SIZE);
  const [popularFeedLoaded, setPopularFeedLoaded] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(initialPosts.length >= FEED_BATCH_SIZE);
  const [nextTimelineCursor, setNextTimelineCursor] = useState(() => {
    const lastPost = initialPosts.at(-1);
    return lastPost
      ? encodeTimelineCursor({ createdAt: lastPost.createdAt, id: lastPost.id })
      : null;
  });
  const [morePostsPending, setMorePostsPending] = useState(false);
  const [feedLoadError, setFeedLoadError] = useState(false);
  const [visibleItemCount, setVisibleItemCount] = useState(FEED_BATCH_SIZE);
  const postSentinelRef = useRef<HTMLDivElement | null>(null);
  const mobileComposeInputRef = useRef<HTMLTextAreaElement | null>(null);
  const mobileComposeDialogRef = useRef<HTMLDivElement | null>(null);
  const mobileComposeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const mobileComposeReturnFocusRef = useRef<HTMLElement | null>(null);
  const [selectedListId, setSelectedListId] = useState<string>(lists[0]?.id ?? "");
  const [listFeedState, setListFeedState] = useState<{
    listId: string;
    items: TimelineListFeedItem[];
    hasMore: boolean;
    nextCursor: string | null;
  }>({ listId: "", items: [], hasMore: false, nextCursor: null });
  const [mobileComposeOpen, setMobileComposeOpen] = useState(false);
  const [composeExpanded, setComposeExpanded] = useState(false);
  const [composeBody, setComposeBody] = useState("");
  const composeTags = useMemo(() => extractContentTags(composeBody), [composeBody]);
  const [composeImages, setComposeImages] = useState<ComposeImage[]>([]);
  const [composeAudience, setComposeAudience] = useState<"public" | "followers">("public");
  const [composeScheduledAt, setComposeScheduledAt] = useState("");
  const [composeOptionsOpen, setComposeOptionsOpen] = useState(false);
  const [isPreparingImages, setIsPreparingImages] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [composeError, setComposeError] = useState("");
  const [composeStatus, setComposeStatus] = useState("");
  const [composeCooldownSeconds, setComposeCooldownSeconds] = useState(0);
  const [composeRequestId, setComposeRequestId] = useState(() => crypto.randomUUID());
  const [crossPostDestinations, setCrossPostDestinations] = useState<SocialTextProvider[]>([]);
  const [crossPostConfirmed, setCrossPostConfirmed] = useState(false);
  const [crossPostRecovery, setCrossPostRecovery] = useState<{ previewId: string; destinations: SocialTextProvider[] } | null>(null);
  const [crossPostRecoveryPending, setCrossPostRecoveryPending] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const submissionInFlightRef = useRef(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const composeAudienceLabel = composeAudience === "followers"
    ? (locale === "en" ? "Followers" : "フォロワー")
    : (locale === "en" ? "Everyone" : "全員");
  const composeDestinationLabel = crossPostDestinations.length ? `Hub + ${crossPostDestinations.map((item) => item === "x" ? "X" : "Threads").join(" + ")}` : "Hub";
  const composeTimingLabel = composeScheduledAt
    ? composeScheduledAt.replace("T", " ")
    : (locale === "en" ? "Now" : "今すぐ");
  const composeSubmitLabel = composeScheduledAt
    ? (locale === "en" ? "Schedule on Hub" : "Hubで予約する")
    : crossPostDestinations.length
      ? (locale === "en" ? "Post to selected destinations" : "選択した送信先へ投稿")
      : composeAudience === "followers"
        ? (locale === "en" ? "Post to followers" : "フォロワーに投稿")
        : (locale === "en" ? "Post to Hub" : "Hubに投稿");
  const [postHistoryIds, setPostHistoryIds] = useState<string[]>([]);
  const [personalizationEnabled, setPersonalizationEnabled] = useState(true);
  const [rankingPreference, setRankingPreference] =
    useState<HubRankingPreference>("balanced");
  const [hiddenPostIds, setHiddenPostIds] = useState<string[]>([]);
  const [hiddenTopics, setHiddenTopics] = useState<string[]>([]);
  const [feedMotion, setFeedMotion] = useState<{ direction: "next" | "previous"; nonce: number } | null>(null);
  const [lastSeenItems, setLastSeenItems] = useState<HomeFeedReadState>({});
  const [pendingNewPosts, setPendingNewPosts] = useState<TimelinePost[]>([]);
  const [feedSessionProfileId, setFeedSessionProfileId] = useState("");
  const feedSessionReady = feedSessionProfileId === currentProfileId;
  const restoredScrollTopRef = useRef(0);
  const restoredAnchorRef = useRef({ postId: "", offset: 0 });
  const feedViewPositionsRef = useRef<Record<string, HomeFeedViewPosition>>({});
  const previousFeedViewRef = useRef<string | null>(null);
  const postsRef = useRef(posts);
  const queryStorageReadyRef = useRef(false);
  const composeMention = useMentionComposer(
    composeBody,
    setComposeBody,
    mobileComposeInputRef,
    "home-compose-mention-suggestions",
  );

  useEffect(() => {
    const syncRankingPreference = () =>
      setRankingPreference(readHubRankingPreference());
    syncRankingPreference();
    window.addEventListener(
      HUB_RANKING_PREFERENCE_EVENT,
      syncRankingPreference,
    );
    return () => window.removeEventListener(
      HUB_RANKING_PREFERENCE_EVENT,
      syncRankingPreference,
    );
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
    dispatchQuery({ type: "select", id: initialTab === "lists" && lists[0] ? `list-${lists[0].id}` : initialTab });
    setPosts(initialPosts);
    setPopularPosts(rankPopularFeed(initialPosts));
    setHasMorePopularPosts(initialPosts.length >= FEED_BATCH_SIZE);
    setPopularFeedLoaded(false);
    const followedIds = new Set(
      follows
        .filter((relation) => relation.followerProfileId === currentProfileId)
        .map((relation) => relation.followedProfileId),
    );
    const initialFollowing = initialPosts.filter((post) =>
      post.authorProfileId === currentProfileId
      || (post.authorProfileId ? followedIds.has(post.authorProfileId) : false)
    );
    setFollowingPosts(initialFollowing);
    setHasMoreFollowingPosts(initialPosts.length >= FEED_BATCH_SIZE);
    // The common timeline cannot provide a safe boundary for the dedicated
    // following feed. Its first server page must always start at the top.
    setNextFollowingCursor(null);
    setSelectedListId(lists[0]?.id ?? "");
    setVisibleItemCount(FEED_BATCH_SIZE);
    restoredScrollTopRef.current = 0;
    restoredAnchorRef.current = { postId: "", offset: 0 };
    feedViewPositionsRef.current = {};
    const restored = readHomeFeedSession(window.sessionStorage, currentProfileId, isTimelinePost);
    if (restored) {
      const validListId = lists.some((list) => list.id === restored.listId)
        ? restored.listId
        : lists[0]?.id ?? "";
      const restoredTab = restored.tab === "lists" && !validListId
        ? initialTab
        : restored.tab;
      setActiveTab(restoredTab);
      setSelectedListId(validListId);
      dispatchQuery({ type: "select", id: restoredTab === "lists" ? `list-${validListId}` : restoredTab });
      const restoredView = feedViewKey(restoredTab, validListId);
      const restoredPosition = restored.viewPositions[restoredView] ?? restored;
      feedViewPositionsRef.current = restored.viewPositions;
      setVisibleItemCount(restoredPosition.visibleItemCount);
      restoredScrollTopRef.current = restoredPosition.scrollTop;
      restoredAnchorRef.current = {
        postId: restoredPosition.anchorPostId,
        offset: restoredPosition.anchorOffset,
      };
      if (restored.posts.length) {
        setPosts((current) => {
          const byId = new Map(current.map((post) => [post.id, post]));
          restored.posts.forEach((post) => {
            if (!byId.has(post.id)) byId.set(post.id, post);
          });
          return [...byId.values()];
        });
      }
    } else {
      const savedListId = window.localStorage.getItem("hub.home.list");
      if (savedListId && lists.some((list) => list.id === savedListId)) {
        setSelectedListId(savedListId);
      }
    }
    setFeedSessionProfileId(currentProfileId);
  }, [currentProfileId, follows, initialPosts, initialTab, lists]);

  useEffect(() => {
    const queries = parseStoredFeedQueries(window.localStorage.getItem(FEED_QUERY_STORAGE_KEY));
    dispatchQuery({ type: "hydrate", queries });
    const savedActiveId = window.localStorage.getItem(FEED_ACTIVE_QUERY_STORAGE_KEY);
    const savedQuery = queries.find((query) => query.id === savedActiveId);
    if (savedQuery) {
      dispatchQuery({ type: "select", id: savedQuery.id });
      setActiveTab(savedQuery.source === "list" ? "lists" : savedQuery.source);
    }
    queryStorageReadyRef.current = true;
  }, []);

  useEffect(() => {
    if (!queryStorageReadyRef.current) return;
    window.localStorage.setItem(FEED_QUERY_STORAGE_KEY, serializeFeedQueries(queryState.custom));
  }, [queryState.custom]);

  useEffect(() => {
    if (!feedSessionReady) return;
    const main = document.querySelector<HTMLElement>(".main-content");
    if (!main) return;
    const restoredScrollTop = restoredScrollTopRef.current;
    const restoredAnchor = restoredAnchorRef.current;
    restoredScrollTopRef.current = 0;
    restoredAnchorRef.current = { postId: "", offset: 0 };
    return scheduleFeedPositionRestore(main, {
      visibleItemCount: FEED_BATCH_SIZE,
      scrollTop: restoredScrollTop,
      anchorPostId: restoredAnchor.postId,
      anchorOffset: restoredAnchor.offset,
    });
  }, [feedSessionReady]);

  useEffect(() => {
    if (!feedSessionReady) return;
    const main = document.querySelector<HTMLElement>(".main-content");
    if (!main) return;
    let timer: number | null = null;
    const persist = () => {
      const mainTop = main.getBoundingClientRect().top;
      const anchor = [...main.querySelectorAll<HTMLElement>(".tweet[data-post-context-id]")]
        .find((item) => item.getBoundingClientRect().bottom > mainTop + 1);
      const position: HomeFeedViewPosition = {
        visibleItemCount,
        scrollTop: main.scrollTop,
        anchorPostId: anchor?.dataset.postContextId ?? "",
        anchorOffset: anchor ? anchor.getBoundingClientRect().top - mainTop : 0,
      };
      const viewPositions = {
        ...feedViewPositionsRef.current,
        [feedViewKey(activeTab, selectedListId)]: position,
      };
      feedViewPositionsRef.current = viewPositions;
      writeHomeFeedSession(window.sessionStorage, {
        profileId: currentProfileId,
        tab: activeTab,
        listId: selectedListId,
        ...position,
        viewPositions,
        posts,
      });
    };
    const onScroll = () => {
      if (timer !== null) return;
      timer = window.setTimeout(() => {
        timer = null;
        persist();
      }, 200);
    };
    main.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", persist);
    persist();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      persist();
      main.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", persist);
    };
  }, [activeTab, currentProfileId, feedSessionReady, posts, selectedListId, visibleItemCount]);

  useEffect(() => {
    if (composeCooldownSeconds <= 0) return;
    const timer = window.setInterval(() => {
      setComposeCooldownSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [composeCooldownSeconds > 0]);

  useEffect(() => {
    setPostHistoryIds(readPostHistory(window.localStorage));
    setPersonalizationEnabled(window.localStorage.getItem(HUB_PERSONALIZATION_KEY) !== "off");
    setHiddenPostIds(readHiddenPostIds(window.localStorage));
    setHiddenTopics(readHiddenTopics(window.localStorage));
    const savedDraft = window.localStorage.getItem(`hub.post-draft.${currentProfileId || "guest"}`) ?? "";
    if (savedDraft) {
      let restored: StoredComposeDraft = { body: savedDraft, audience: "public", scheduledAt: "", imageAltTexts: [] };
      try { const parsed = JSON.parse(savedDraft) as StoredComposeDraft; if (typeof parsed.body === "string") restored = parsed; } catch { /* Legacy text-only draft. */ }
      setComposeBody(restored.body);
      setComposeAudience(restored.audience === "followers" ? "followers" : "public");
      setComposeScheduledAt(restored.scheduledAt ?? "");
      if (restored.clientRequestId) setComposeRequestId(restored.clientRequestId);
      setDraftRestored(true);
      setComposeExpanded(true);
    }
    const savedReadState = readHomeFeedReadState(window.localStorage, currentProfileId);
    const legacyLastSeenPostId = window.localStorage.getItem(HOME_LAST_SEEN_POST_KEY);
    if (!savedReadState.recommended && legacyLastSeenPostId) {
      savedReadState.recommended = { itemId: legacyLastSeenPostId, updatedAt: 0 };
    }
    setLastSeenItems(savedReadState);
    /*
     * Where the reader stopped is the reader's own, so a visitor with no
     * profile has nothing to ask for. Guests were sending it on every load
     * and getting 401 back, three times over with the two below.
     */
    if (!currentProfileId) return;
    const controller = new AbortController();
    void fetch("/api/feed/read-position", { credentials: "same-origin", cache: "no-store", signal: controller.signal })
      .then((response) => response.ok
        ? response.json() as Promise<{ lastSeenPostId?: string | null; positions?: unknown }>
        : null)
      .then((payload) => {
        if (!payload) return;
        const synchronized = normalizeHomeFeedReadState(payload.positions);
        if (!synchronized.recommended && payload.lastSeenPostId) {
          synchronized.recommended = { itemId: payload.lastSeenPostId, updatedAt: 0 };
        }
        setLastSeenItems((current) => {
          const next = { ...current };
          for (const [view, entry] of Object.entries(synchronized)) {
            if (!next[view] || entry.updatedAt > next[view].updatedAt) next[view] = entry;
          }
          writeHomeFeedReadState(window.localStorage, currentProfileId, next);
          return next;
        });
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [currentProfileId]);
  useEffect(() => {
    const updateConnection = () => setIsOnline(window.navigator.onLine);
    updateConnection();
    window.addEventListener("online", updateConnection);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", updateConnection);
      window.removeEventListener("offline", updateConnection);
    };
  }, []);
  useEffect(() => {
    const refreshPreferences = () => {
      setHiddenPostIds(readHiddenPostIds(window.localStorage));
      setHiddenTopics(readHiddenTopics(window.localStorage));
    };
    window.addEventListener(FEED_PREFERENCES_EVENT, refreshPreferences);
    return () => window.removeEventListener(FEED_PREFERENCES_EVENT, refreshPreferences);
  }, []);
  useEffect(() => {
    const draftKey = `hub.post-draft.${currentProfileId || "guest"}`;
    if (composeBody || composeScheduledAt) window.localStorage.setItem(draftKey, JSON.stringify({ body: composeBody, audience: composeAudience, scheduledAt: composeScheduledAt, imageAltTexts: composeImages.map((image) => image.altText), clientRequestId: composeRequestId } satisfies StoredComposeDraft));
    else window.localStorage.removeItem(draftKey);
  }, [composeAudience, composeBody, composeImages, composeRequestId, composeScheduledAt, currentProfileId]);
  /*
   * The composer is only reachable as a dialog, and the controls that open it
   * live outside the timeline: the sidebar's compose button when the feed is
   * already mounted, and the same button's href when arriving from elsewhere.
   */
  useEffect(() => {
    if (!authenticated) return;
    const open = () => {
      mobileComposeReturnFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      setMobileComposeOpen(true);
    };
    const openFromHash = () => {
      if (window.location.hash !== HUB_COMPOSE_HASH) return;
      // Clear the hash so a reload does not reopen a composer nobody asked for.
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
      open();
    };
    openFromHash();
    window.addEventListener(HUB_COMPOSE_OPEN_EVENT, open);
    window.addEventListener("hashchange", openFromHash);
    return () => {
      window.removeEventListener(HUB_COMPOSE_OPEN_EVENT, open);
      window.removeEventListener("hashchange", openFromHash);
    };
  }, [authenticated]);
  useEffect(() => {
    document.documentElement.toggleAttribute("data-mobile-compose-open", mobileComposeOpen);
    if (mobileComposeOpen) {
      const dialog = mobileComposeDialogRef.current;
      const returnFocusTarget = mobileComposeReturnFocusRef.current;
      const restoreModalIsolation = dialog ? isolateModalBranch(dialog) : () => undefined;
      const focusTimer = window.setTimeout(() => mobileComposeInputRef.current?.focus(), 0);
      return () => {
        window.clearTimeout(focusTimer);
        restoreModalIsolation();
        document.documentElement.removeAttribute("data-mobile-compose-open");
        window.setTimeout(() => {
          if (returnFocusTarget?.isConnected) returnFocusTarget.focus();
        }, 0);
      };
    }
    return () => document.documentElement.removeAttribute("data-mobile-compose-open");
  }, [mobileComposeOpen]);
  const orderedLists = lists;
  const selectedList = orderedLists.find((entry) => entry.id === selectedListId) ?? orderedLists[0];
  const queryTabs = useMemo(
    () => [
      ...tabs,
      ...orderedLists.map((list) => listFeedQuery(list.id, list.name)),
      ...queryState.custom,
    ],
    [orderedLists, queryState.custom, tabs],
  );
  const activeQuery = queryTabs.find((query) => query.id === queryState.activeId) ?? tabs[0];

  const selectQuery = (query: FeedQueryDefinition) => {
    dispatchQuery({ type: "select", id: query.id });
    window.localStorage.setItem(FEED_ACTIVE_QUERY_STORAGE_KEY, query.id);
    if (query.source === "list") {
      setSelectedListId(query.listId ?? "");
      setActiveTab("lists");
      window.localStorage.setItem("hub.home.list", query.listId ?? "");
      window.localStorage.setItem("hub.home.feed", "lists");
      document.cookie = "hub.home.feed=lists; Path=/; Max-Age=31536000; SameSite=Lax";
      return;
    }
    setActiveTab(query.source);
    window.localStorage.setItem("hub.home.feed", query.source);
    document.cookie = `hub.home.feed=${query.source}; Path=/; Max-Age=31536000; SameSite=Lax`;
  };

  useEffect(() => {
    const moveFeed = (event: Event) => {
      const currentIndex = queryTabs.findIndex((query) => query.id === queryState.activeId);
      const direction = (event as CustomEvent<"next" | "previous">).detail;
      const normalizedIndex = Math.max(currentIndex, 0);
      if (direction === "previous" && normalizedIndex === 0) return;
      event.preventDefault();
      const nextIndex = direction === "previous"
        ? normalizedIndex - 1
        : Math.min(normalizedIndex + 1, queryTabs.length - 1);
      const next = queryTabs[nextIndex];
      if (!next) return;
      setFeedMotion((current) => ({ direction, nonce: (current?.nonce ?? 0) + 1 }));
      selectQuery(next);
    };
    window.addEventListener("hub:feed-swipe", moveFeed);
    return () => window.removeEventListener("hub:feed-swipe", moveFeed);
  }, [queryState.activeId, queryTabs]);

  const followedProfileIds = useMemo(
    () =>
      new Set(
        follows
          .filter((relation) => relation.followerProfileId === currentProfileId)
          .map((relation) => relation.followedProfileId)
      ),
    [currentProfileId, follows]
  );
  const [followingPosts, setFollowingPosts] = useState<TimelinePost[]>(() =>
    initialPosts.filter((post) =>
      post.authorProfileId === currentProfileId
      || (post.authorProfileId ? followedProfileIds.has(post.authorProfileId) : false)
    )
  );
  const [hasMoreFollowingPosts, setHasMoreFollowingPosts] = useState(initialPosts.length >= FEED_BATCH_SIZE);
  // This cursor is established only by the following endpoint itself.
  const [nextFollowingCursor, setNextFollowingCursor] = useState<string | null>(null);
  const interest = useMemo(() => recommendedInterest(posts, postHistoryIds), [postHistoryIds, posts]);
  useEffect(() => {
    if (interest) {
      recordHubInterests("feed", [interest], 2);
    }
  }, [interest]);

  const discardComposeDraft = () => {
    composeImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    setComposeBody("");
    setComposeImages([]);
    setComposeAudience("public");
    setComposeScheduledAt("");
    setComposeOptionsOpen(false);
    setComposeError("");
    setComposeStatus("");
    setComposeRequestId(crypto.randomUUID());
    setCrossPostDestinations([]);
    setCrossPostConfirmed(false);
    setDraftRestored(false);
    setComposeExpanded(false);
    setMobileComposeOpen(false);
    window.localStorage.removeItem(`hub.post-draft.${currentProfileId || "guest"}`);
  };

  const submitPost = () => {
    if (submissionInFlightRef.current || composeCooldownSeconds > 0 || (!composeBody.trim() && composeImages.length === 0)) return;
    if (composeBody.length > SOCIAL_POST_MAX_LENGTH) {
      setComposeError(locale === "en" ? `Your post is over the ${SOCIAL_POST_MAX_LENGTH} character limit.` : `ポストは${SOCIAL_POST_MAX_LENGTH}文字以内で入力してください。`);
      return;
    }
    if (composeScheduledAt && composeImages.length > 0) {
      setComposeError(locale === "en"
        ? "Scheduled posts support text only. Remove the images or clear the scheduled time."
        : "予約投稿は本文のみ対応しています。画像を削除するか、予約日時を解除してください。");
      return;
    }
    if (crossPostDestinations.length && composeScheduledAt) {
      setComposeError(locale === "en" ? "Cross-posting is immediate. Clear the scheduled time or external destinations." : "外部への同時投稿は即時送信です。予約日時を解除するか、外部送信先を外してください。");
      return;
    }
    if (crossPostDestinations.length && (!composeBody.trim() || !crossPostConfirmed)) {
      setComposeError(locale === "en" ? "Check every exact external preview and confirm it before posting." : "外部へ送るすべての本文と送信先を確認し、確認欄をオンにしてください。");
      return;
    }
    if (!window.navigator.onLine) {
      setComposeError(locale === "en" ? "You are offline. Your draft is saved on this device." : "オフラインです。下書きはこの端末に保存されています。");
      return;
    }
    submissionInFlightRef.current = true;
    setComposeError("");
    setComposeStatus("");

    startTransition(async () => {
      try {
        const wasScheduled = Boolean(composeScheduledAt);
        const externalPreview = crossPostDestinations.length ? await prepareTextCrossPost(composeRequestId, composeBody.trim(), crossPostDestinations) : null;
        const imageIds: string[] = [];
        for (const selected of composeImages) {
          const form = new FormData();
          form.append("image", selected.file); form.append("thumbnail", selected.thumbnail); form.append("width", String(selected.width));
          form.append("height", String(selected.height)); form.append("altText", selected.altText);
          form.append("thumbnailWidth", String(selected.thumbnailWidth)); form.append("thumbnailHeight", String(selected.thumbnailHeight));
          const upload = await fetch("/api/media/images", { method: "POST", body: form });
          if (!upload.ok) { setComposeError(await getResponseError(upload, "画像をアップロードできませんでした。")); return; }
          const payload = await upload.json() as { image: { id: string } };
          imageIds.push(payload.image.id);
        }
        if (!wasScheduled) {
          await recordPersonalNodeEventOnce("hub.post.create", composeRequestId, {
            canonicalPostId: `urn:uuid:${composeRequestId}`,
            body: composeBody.trim(),
            audience: composeAudience,
            imageIds,
          });
        }
        const res = await fetch("/api/social/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ body: composeBody.trim(), identity_mode: "account", image_ids: imageIds, audience: composeAudience, scheduled_at: composeScheduledAt ? new Date(composeScheduledAt).toISOString() : null, client_request_id: composeRequestId })
        });

        if (!res.ok) {
          if (res.status === 429) {
            const retryAfter = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
            if (Number.isFinite(retryAfter) && retryAfter > 0) {
              setComposeCooldownSeconds(Math.min(3_600, retryAfter));
            }
          }
          setComposeError(await getResponseError(res, copy.postFailed));
          return;
        }

        const payload = await res.json() as { post?: TimelinePost; scheduled?: unknown };
        if (payload.post && isTimelinePost(payload.post)) {
          setPosts((current) => current.some((item) => item.id === payload.post!.id)
            ? current
            : [payload.post!, ...current]);
          setFollowingPosts((current) => current.some((item) => item.id === payload.post!.id)
            ? current
            : [payload.post!, ...current]);
          setRecommendedCandidates((current) => current.some((item) => item.id === payload.post!.id)
            ? current
            : [payload.post!, ...current]);
          setVisibleItemCount((current) => current + 1);
        }

        let crossPostStatus = "";
        if (externalPreview) {
          try {
            const receipts = await commitTextCrossPost(externalPreview.previewId, crossPostDestinations);
            const failed = receipts.filter((receipt) => receipt.status === "failed").map((receipt) => receipt.destination as SocialTextProvider);
            const unresolved = receipts.filter((receipt) => receipt.status !== "succeeded");
            setCrossPostRecovery(failed.length ? { previewId: externalPreview.previewId, destinations: crossPostDestinations } : null);
            crossPostStatus = unresolved.length === 0
              ? (locale === "en" ? "Published to Hub and every selected destination." : "Hubと選択したすべての送信先に投稿しました。")
              : (locale === "en" ? "Published to Hub. Some external results need review." : "Hubへの投稿は完了しました。一部の外部送信結果は確認が必要です。");
          } catch (error) {
            setCrossPostRecovery(null);
            crossPostStatus = error instanceof Error ? error.message : (locale === "en" ? "Published to Hub, but external delivery could not be confirmed." : "Hubへの投稿は完了しましたが、外部送信の結果を確認できませんでした。");
          }
        }

        setComposeBody("");
        composeImages.forEach((image) => URL.revokeObjectURL(image.previewUrl));
        setComposeImages([]);
        setComposeAudience("public");
        setComposeScheduledAt("");
        setComposeOptionsOpen(false);
        setComposeRequestId(crypto.randomUUID());
        setCrossPostDestinations([]);
        setCrossPostConfirmed(false);
        window.localStorage.removeItem(`hub.post-draft.${currentProfileId || "guest"}`);
        setDraftRestored(false);
        setComposeExpanded(false);
        setMobileComposeOpen(false);
        setComposeStatus(crossPostStatus || (wasScheduled
          ? (locale === "en" ? "Scheduled post saved." : "予約投稿を保存しました。")
          : (locale === "en" ? "Post published." : "ポストしました。")));
      } catch {
        setComposeError(copy.connectionFailed);
      } finally {
        submissionInFlightRef.current = false;
      }
    });
  };

  const openMobileComposer = (event: React.MouseEvent<HTMLButtonElement>) => {
    mobileComposeReturnFocusRef.current = event.currentTarget;
    setMobileComposeOpen(true);
  };

  const closeMobileComposer = () => {
    setMobileComposeOpen(false);
  };

  const handleMobileComposerKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobileComposer();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = mobileComposeDialogRef.current;
    if (!dialog) return;
    const focusable = focusableDialogElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1)!;
    const active = document.activeElement;
    if (!dialog.contains(active)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const filteredPosts = useMemo(() => {
    const hiddenIds = new Set(hiddenPostIds);
    const sourcePosts = activeTab === "following"
      ? followingPosts
      : activeTab === "popular"
        ? popularPosts
        : activeTab === "recommended"
          ? recommendedCandidates
          : posts;
    /*
     * One sourcing stage for every tab. The exclusions used to be written
     * inline here and the popular tab got only these two, while the
     * recommended tab got a second, richer set inside buildRecommendedFeed.
     */
    const chronological = activeTab === "following" || activeTab === "lists";
    const preferenceFiltered = sourceFeedCandidates(sourcePosts, {
      hiddenPostIds: hiddenIds,
      hiddenTopics,
      seenPostIds: chronological ? undefined : postHistoryIds,
      bodyOf: (post) => post.body,
    }).candidates;

    /*
     * An author whose post the reader hid is damped, not removed. The reader
     * dismissed one post; that is not the same as asking never to see the
     * person again, and the Hub had no way to say the weaker thing.
     */
    const dampenedAuthorIds = new Set(
      sourcePosts
        .filter((post) => hiddenIds.has(post.id) && post.authorProfileId)
        .map((post) => post.authorProfileId as string),
    );
    const seenIds = new Set(postHistoryIds);
    const newAuthorIds = newAuthorProfileIds(preferenceFiltered);
    const signalsFor = (post: TimelinePost): FeedRankSignals => ({
      notInterested: Boolean(post.authorProfileId && dampenedAuthorIds.has(post.authorProfileId)),
      outOfNetwork: !(post.authorProfileId && followedProfileIds.has(post.authorProfileId)),
      newAuthor: Boolean(post.authorProfileId && newAuthorIds.has(post.authorProfileId)),
      skipped: seenIds.has(post.id) ? 1 : 0,
    });
    const applyActiveQuery = (items: TimelinePost[]) => {
      const keyword = activeQuery.keyword.trim().toLocaleLowerCase(locale);
      const matching = keyword
        ? items.filter((post) => `${post.displayName} ${post.handle} ${post.body}`.toLocaleLowerCase(locale).includes(keyword))
        : items;
      if (activeQuery.sort === "popular") {
        return rankPopularFeed(matching, Date.now(), rankingPreference, signalsFor);
      }
      if (activeQuery.sort === "newest") return sortNewestFeed(matching);
      return matching;
    };
    if (activeTab === "recommended") {
      return applyActiveQuery(personalizationEnabled
        ? personalizePosts(preferenceFiltered, followedProfileIds, postHistoryIds)
        : rankPopularFeed(preferenceFiltered, Date.now(), rankingPreference, signalsFor));
    }

    if (activeTab === "popular") {
      return applyActiveQuery(
        rankPopularFeed(preferenceFiltered, Date.now(), rankingPreference, signalsFor),
      );
    }

    if (activeTab === "following") {
      return applyActiveQuery(sortNewestFeed(preferenceFiltered.filter(
        (post) =>
          post.authorProfileId === currentProfileId ||
          (post.authorProfileId ? followedProfileIds.has(post.authorProfileId) : false)
      )));
    }

    if (activeTab === "lists") {
      if (!selectedList) return [];
      return preferenceFiltered.filter(
        (post) => post.authorProfileId && selectedList.profileIds.includes(post.authorProfileId)
      );
    }

    return applyActiveQuery(preferenceFiltered);
  }, [activeQuery, activeTab, currentProfileId, followedProfileIds, followingPosts, hiddenPostIds, hiddenTopics, locale, personalizationEnabled, popularPosts, postHistoryIds, posts, rankingPreference, recommendedCandidates, selectedList]);
  const initialListFeedItems = useMemo(() => {
    if (!selectedList) return [];

    const socialItems = posts
      .filter((post) => post.authorProfileId && selectedList.profileIds.includes(post.authorProfileId))
      .map((post) => ({ kind: "social" as const, createdAt: post.createdAt, post }));
    const responseItems = threadResponses
      .filter((response) => selectedList.threadIds.includes(response.threadId))
      .map((response) => ({ kind: "thread-response" as const, createdAt: response.createdAt, response }));

    return [...socialItems, ...responseItems].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [posts, selectedList, threadResponses]);
  const listFeedItems = listFeedState.listId === selectedList?.id
    ? listFeedState.items
    : initialListFeedItems;
  const currentFeedLength = activeTab === "lists" ? listFeedItems.length : filteredPosts.length;
  const visibleListFeedItems = listFeedItems.slice(0, visibleItemCount);
  const visiblePosts = filteredPosts.slice(0, visibleItemCount);
  const currentFeedViewKey = feedViewKey(activeTab, selectedListId);
  const lastSeenItemId = lastSeenItems[currentFeedViewKey]?.itemId ?? null;
  const unreadBoundaryIndex = lastSeenItemId
    ? visiblePosts.findIndex((post) => post.id === lastSeenItemId)
    : -1;
  const listUnreadBoundaryIndex = lastSeenItemId
    ? visibleListFeedItems.findIndex((item) =>
      (item.kind === "social" ? item.post.id : `thread:${item.response.id}`) === lastSeenItemId)
    : -1;
  const currentFirstItemId = activeTab === "lists"
    ? (listFeedItems[0]?.kind === "social"
      ? listFeedItems[0].post.id
      : listFeedItems[0] ? `thread:${listFeedItems[0].response.id}` : "")
    : (filteredPosts[0]?.id ?? "");
  const hasLocallyHiddenItems = visibleItemCount < currentFeedLength;

  useEffect(() => {
    postsRef.current = posts;
  }, [posts]);

  useEffect(() => {
    if (!currentFirstItemId) return;
    const view = currentFeedViewKey;
    const itemId = currentFirstItemId;
    const rememberReadPosition = () => {
      setLastSeenItems((current) => {
        if (current[view]?.itemId === itemId) return current;
        const next = { ...current, [view]: { itemId, updatedAt: Date.now() } };
        writeHomeFeedReadState(window.localStorage, currentProfileId, next);
        return next;
      });
      if (view === "recommended") window.localStorage.setItem(HOME_LAST_SEEN_POST_KEY, itemId);
      void fetch("/api/feed/read-position", {
        method: "PATCH",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ view, itemId }),
      }).catch(() => undefined);
    };
    window.addEventListener("pagehide", rememberReadPosition);
    return () => {
      rememberReadPosition();
      window.removeEventListener("pagehide", rememberReadPosition);
    };
  }, [currentFeedViewKey, currentFirstItemId, currentProfileId]);

  useEffect(() => {
    const addCreatedPost = (event: Event) => {
      const post = (event as CustomEvent<TimelinePost>).detail;
      if (postsRef.current.some((item) => item.id === post.id)) return;
      postsRef.current = [post, ...postsRef.current];
      setPosts(postsRef.current);
      if (
        post.authorProfileId === currentProfileId
        || (post.authorProfileId ? followedProfileIds.has(post.authorProfileId) : false)
      ) {
        setFollowingPosts((current) => current.some((item) => item.id === post.id)
          ? current
          : [post, ...current]);
      }
      setVisibleItemCount((current) => current + 1);
    };
    const removeDeletedPost = (event: Event) => {
      const postId = (event as CustomEvent<string>).detail;
      if (!postsRef.current.some((item) => item.id === postId)) return;
      postsRef.current = postsRef.current.filter((item) => item.id !== postId);
      setPosts(postsRef.current);
      setFollowingPosts((current) => current.filter((item) => item.id !== postId));
      setVisibleItemCount((current) => Math.max(0, current - 1));
    };
    window.addEventListener(SOCIAL_POST_CREATED_EVENT, addCreatedPost);
    window.addEventListener(SOCIAL_POST_DELETED_EVENT, removeDeletedPost);
    return () => {
      window.removeEventListener(SOCIAL_POST_CREATED_EVENT, addCreatedPost);
      window.removeEventListener(SOCIAL_POST_DELETED_EVENT, removeDeletedPost);
    };
  }, [currentProfileId, followedProfileIds]);

  useEffect(() => {
    if (activeTab === "lists") return;
    let cancelled = false;
    const checkForNewPosts = async () => {
      try {
        const query = new URLSearchParams({
          view: "timeline",
          limit: "10",
          offset: "0",
        });
        if (activeTab === "following") query.set("feed", "following");
        if (activeTab === "popular") query.set("feed", "popular");
        if (activeTab === "recommended") query.set("feed", "recommended");
        const response = await fetch(`/api/social/posts?${query.toString()}`, { credentials: "same-origin", cache: "no-store" });
        if (!response.ok) return;
        setFeedLoadError(false);
        const payload = await response.json() as { posts?: TimelinePost[] };
        if (cancelled) return;
        if (activeTab === "popular") {
          setPopularPosts(payload.posts ?? []);
          setPopularFeedLoaded(true);
          return;
        }
        if (activeTab === "recommended") {
          const fresh = payload.posts ?? [];
          setRecommendedCandidates((current) => {
            const freshIds = new Set(fresh.map((post) => post.id));
            return [...fresh, ...current.filter((post) => !freshIds.has(post.id))];
          });
          return;
        }
        const knownIds = new Set(postsRef.current.map((post) => post.id));
        setPendingNewPosts((payload.posts ?? []).filter((post) => !knownIds.has(post.id)));
      } catch {
        setFeedLoadError(true);
      }
    };
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let heartbeat: number | null = null;
    let attempt = 0;
    let reopen: number | null = null;
    const stopFallbackPolling = () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    };
    const startFallbackPolling = () => {
      if (timer !== null || cancelled) return;
      void checkForNewPosts();
      timer = window.setInterval(() => void checkForNewPosts(), NEW_POST_POLL_INTERVAL_MS);
    };
    const connect = () => {
      if (cancelled) return;
      try {
      const storedShard = window.sessionStorage.getItem(FEED_REALTIME_STORAGE_KEY);
      const shard = storedShard === null
        ? Math.floor(Math.random() * FEED_REALTIME_SHARDS)
        : normalizeFeedRealtimeShard(storedShard);
      window.sessionStorage.setItem(FEED_REALTIME_STORAGE_KEY, String(shard));
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/feed/live?shard=${encodeURIComponent(shard)}`);
      socket.addEventListener("open", () => {
        stopFallbackPolling();
        attempt = 0;
        /*
         * The server answers "ping" with "pong" — setWebSocketAutoResponse
         * in feed-realtime-object — and the handler below already skips that
         * reply. Nothing ever sent the ping, so the connection went quiet and
         * was closed from the other end. Measured on staging: the page fell
         * back at 67s and then asked for the timeline every 45 seconds for as
         * long as the tab stayed open, which is rows read on every one.
         */
        heartbeat = window.setInterval(() => {
          if (socket?.readyState === WebSocket.OPEN) socket.send("ping");
        }, FEED_REALTIME_HEARTBEAT_MS);
      });
      socket.addEventListener("message", (event) => {
        if (event.data === "pong") return;
        if (!parseFeedRealtimeEvent(event.data)) return;
        void checkForNewPosts();
      });
      /*
       * A dropped connection used to mean polling for the rest of the visit:
       * there was one `new WebSocket` in the file and nothing tried again.
       * Polling covers the gap, and each attempt waits longer than the last
       * so a server that is genuinely down is not hammered.
       */
      const onLost = () => {
        if (heartbeat !== null) window.clearInterval(heartbeat);
        heartbeat = null;
        startFallbackPolling();
        if (cancelled || reopen !== null) return;
        attempt += 1;
        const wait = Math.min(FEED_REALTIME_RETRY_CEILING_MS, 2_000 * 2 ** (attempt - 1));
        reopen = window.setTimeout(() => { reopen = null; connect(); }, wait);
      };
      socket.addEventListener("close", onLost);
      socket.addEventListener("error", onLost);
      } catch {
        socket = null;
        startFallbackPolling();
      }
    };
    connect();
    const connectionTimeout = window.setTimeout(() => {
      if (socket?.readyState !== WebSocket.OPEN) startFallbackPolling();
    }, 5_000);
    return () => {
      cancelled = true;
      socket?.close();
      window.clearTimeout(connectionTimeout);
      if (reopen !== null) window.clearTimeout(reopen);
      if (heartbeat !== null) window.clearInterval(heartbeat);
      stopFallbackPolling();
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "recommended" || recommendedFeedLoaded) return;
    let cancelled = false;
    setMorePostsPending(true);
    setFeedLoadError(false);
    void fetch(`/api/social/posts?view=timeline&feed=recommended&limit=${FEED_BATCH_SIZE}&offset=0`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("recommended_feed_unavailable");
        return response.json() as Promise<{ posts?: TimelinePost[]; hasMore?: boolean; nextOffset?: number }>;
      })
      .then((payload) => {
        if (cancelled) return;
        const received = payload.posts ?? [];
        setRecommendedCandidates(received);
        setRecommendedServerOffset(payload.nextOffset ?? received.length);
        setHasMoreRecommendedPosts(Boolean(payload.hasMore));
        setRecommendedFeedLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setFeedLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setMorePostsPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, recommendedFeedLoaded]);

  useEffect(() => {
    if (activeTab !== "recommended" || !currentProfileId) return;
    const controller = new AbortController();
    void fetch("/api/federation/recommendations", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return null;
      return response.json() as Promise<{ items?: ActivityPubRecommendation[] }>;
    }).then((payload) => {
      if (payload?.items) setActivityPubRecommendations(payload.items);
    }).catch(() => {
      // Federation is optional. Keep the local recommendation feed usable.
    });
    return () => controller.abort();
  }, [activeTab, currentProfileId]);

  useEffect(() => {
    if (activeTab !== "recommended" || !currentProfileId) return;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 8_000);
    void fetch("/api/core/external-protocols/atproto/feed", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) return null;
      return response.json() as Promise<{ items?: AtProtocolRecommendation[] }>;
    }).then((payload) => {
      if (payload?.items) setAtProtocolRecommendations(payload.items.slice(0, 16));
    }).catch(() => {
      // AT Protocol is optional. Keep the Hub and ActivityPub feed usable.
    }).finally(() => window.clearTimeout(timeoutId));
    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [activeTab, currentProfileId]);

  useEffect(() => {
    if (activeTab !== "popular" || popularFeedLoaded) return;
    let cancelled = false;
    setMorePostsPending(true);
    setFeedLoadError(false);
    void fetch(`/api/social/posts?view=timeline&feed=popular&limit=${FEED_BATCH_SIZE}&offset=0`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("popular_feed_unavailable");
        return response.json() as Promise<{ posts?: TimelinePost[]; hasMore?: boolean; nextOffset?: number }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setPopularPosts(payload.posts ?? []);
        setPopularServerOffset(payload.nextOffset ?? payload.posts?.length ?? 0);
        setHasMorePopularPosts(Boolean(payload.hasMore));
        setPopularFeedLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setFeedLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setMorePostsPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, popularFeedLoaded]);

  useEffect(() => {
    if (activeTab !== "lists" || !selectedList?.id) return;
    let cancelled = false;
    setMorePostsPending(true);
    setFeedLoadError(false);
    void fetch(`/api/lists/${encodeURIComponent(selectedList.id)}/feed?limit=${FEED_BATCH_SIZE}`, {
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("list_feed_unavailable");
        return response.json() as Promise<{
          items?: TimelineListFeedItem[];
          hasMore?: boolean;
          nextCursor?: string | null;
        }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setListFeedState({
          listId: selectedList.id,
          items: payload.items ?? [],
          hasMore: Boolean(payload.hasMore),
          nextCursor: payload.nextCursor ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setFeedLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setMorePostsPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedList?.id]);

  const applyNewPosts = () => {
    if (pendingNewPosts.length === 0) return;
    const merge = (current: TimelinePost[]) =>
      [...pendingNewPosts, ...current.filter((post) => !pendingNewPosts.some((fresh) => fresh.id === post.id))];
    if (activeTab === "following") setFollowingPosts(merge);
    else setPosts(merge);
    setVisibleItemCount((current) => current + pendingNewPosts.length);
    setPendingNewPosts([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (!feedSessionReady) return;
    const view = feedViewKey(activeTab, selectedListId);
    if (previousFeedViewRef.current === null) {
      previousFeedViewRef.current = view;
      return;
    }
    if (previousFeedViewRef.current === view) return;
    previousFeedViewRef.current = view;
    const position = feedViewPositionsRef.current[view];
    const main = document.querySelector<HTMLElement>(".main-content");
    if (!position) {
      setVisibleItemCount(FEED_BATCH_SIZE);
      main?.scrollTo({ top: 0, left: 0, behavior: "instant" });
      return;
    }
    setVisibleItemCount(position.visibleItemCount);
    if (main) return scheduleFeedPositionRestore(main, position);
  }, [activeTab, feedSessionReady, selectedListId]);

  useEffect(() => {
    const sentinel = postSentinelRef.current;
    const canLoadFromServer = activeTab === "lists"
      ? Boolean(selectedList?.id)
        && listFeedState.listId === selectedList.id
        && listFeedState.hasMore
      : activeTab === "popular"
        ? hasMorePopularPosts
      : activeTab === "recommended"
        ? hasMoreRecommendedPosts
      : activeTab === "following"
        ? hasMoreFollowingPosts
        : hasMorePosts;
    if (!sentinel || (!hasLocallyHiddenItems && !canLoadFromServer) || morePostsPending || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (hasLocallyHiddenItems) {
        setVisibleItemCount((current) => Math.min(current + FEED_BATCH_SIZE, currentFeedLength));
        return;
      }

      setMorePostsPending(true);
      setFeedLoadError(false);
      if (activeTab === "lists" && selectedList?.id) {
        const query = new URLSearchParams({ limit: String(FEED_BATCH_SIZE) });
        if (listFeedState.nextCursor) query.set("cursor", listFeedState.nextCursor);
        void fetch(`/api/lists/${encodeURIComponent(selectedList.id)}/feed?${query.toString()}`, {
          credentials: "same-origin",
          cache: "no-store",
        })
          .then(async (response) => {
            if (!response.ok) throw new Error("list_feed_unavailable");
            return response.json() as Promise<{
              items?: TimelineListFeedItem[];
              hasMore?: boolean;
              nextCursor?: string | null;
            }>;
          })
          .then((payload) => {
            const received = payload.items ?? [];
            setListFeedState((current) => {
              if (current.listId !== selectedList.id) return current;
              const known = new Set(current.items.map((item) =>
                item.kind === "social" ? `social:${item.post.id}` : `thread:${item.response.id}`));
              return {
                listId: current.listId,
                items: [...current.items, ...received.filter((item) =>
                  !known.has(item.kind === "social" ? `social:${item.post.id}` : `thread:${item.response.id}`))],
                hasMore: canContinueTimelinePage({
                  hasMore: Boolean(payload.hasMore),
                  previousCursor: current.nextCursor,
                  nextCursor: payload.nextCursor,
                }),
                nextCursor: payload.nextCursor ?? null,
              };
            });
            setVisibleItemCount((current) => current + FEED_BATCH_SIZE);
          })
          .catch(() => setFeedLoadError(true))
          .finally(() => setMorePostsPending(false));
        return;
      }
      const query = new URLSearchParams({
        view: "timeline",
        limit: String(FEED_BATCH_SIZE),
      });
      if (activeTab === "popular") {
        query.set("feed", "popular");
        query.set("offset", String(popularServerOffset));
      }
      if (activeTab === "recommended") {
        query.set("feed", "recommended");
        query.set("offset", String(recommendedServerOffset));
      }
      const cursor = activeTab === "following"
        ? nextFollowingCursor
        : activeTab === "popular" || activeTab === "recommended"
          ? null
          : nextTimelineCursor;
      if (activeTab === "following") query.set("feed", "following");
      if (cursor) query.set("cursor", cursor);
      void fetch(`/api/social/posts?${query.toString()}`, { credentials: "same-origin", cache: "no-store" })
        .then(async (response) => {
          if (!response.ok) throw new Error("timeline_unavailable");
          return response.json() as Promise<{
            posts?: TimelinePost[];
            hasMore?: boolean;
            nextCursor?: string | null;
            nextOffset?: number;
          }>;
        })
        .then((payload) => {
          const received = payload.posts ?? [];
          const lastReceived = received.at(-1);
          const nextCursor = payload.nextCursor ?? (lastReceived
            ? encodeTimelineCursor({ createdAt: lastReceived.createdAt, id: lastReceived.id })
            : null);
          const mergeReceived = (current: TimelinePost[]) => {
            const byId = new Map(current.map((post) => [post.id, post]));
            for (const post of received) byId.set(post.id, post);
            return [...byId.values()];
          };
          if (activeTab === "following") setFollowingPosts(mergeReceived);
          else if (activeTab === "popular") {
            setPopularPosts(mergeReceived);
            if (typeof payload.nextOffset === "number") {
              setPopularServerOffset(payload.nextOffset);
            } else {
              setPopularServerOffset((current) => current + received.length);
            }
          }
          else if (activeTab === "recommended") {
            setRecommendedCandidates(mergeReceived);
            if (typeof payload.nextOffset === "number") {
              setRecommendedServerOffset(payload.nextOffset);
            } else {
              setRecommendedServerOffset((current) => current + received.length);
            }
          }
          else setPosts(mergeReceived);
          setVisibleItemCount((current) => current + FEED_BATCH_SIZE);
          if (activeTab === "following") {
            setHasMoreFollowingPosts(canContinueTimelinePage({
              hasMore: Boolean(payload.hasMore),
              previousCursor: nextFollowingCursor,
              nextCursor,
            }));
          } else if (activeTab === "popular") {
            setHasMorePopularPosts(canContinueTimelinePage({
              hasMore: Boolean(payload.hasMore),
              previousOffset: popularServerOffset,
              nextOffset: payload.nextOffset,
            }));
          } else if (activeTab === "recommended") {
            setHasMoreRecommendedPosts(canContinueTimelinePage({
              hasMore: Boolean(payload.hasMore),
              previousOffset: recommendedServerOffset,
              nextOffset: payload.nextOffset,
            }));
          } else {
            setHasMorePosts(canContinueTimelinePage({
              hasMore: Boolean(payload.hasMore),
              previousCursor: nextTimelineCursor,
              nextCursor,
            }));
          }
          if (activeTab === "following") setNextFollowingCursor(nextCursor);
          else setNextTimelineCursor(nextCursor);
        })
        .catch(() => setFeedLoadError(true))
        .finally(() => setMorePostsPending(false));
    }, { rootMargin: "300px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeTab, currentFeedLength, hasLocallyHiddenItems, hasMoreFollowingPosts, hasMorePopularPosts, hasMoreRecommendedPosts, hasMorePosts, listFeedState.hasMore, listFeedState.listId, listFeedState.nextCursor, morePostsPending, nextFollowingCursor, nextTimelineCursor, popularServerOffset, recommendedServerOffset, selectedList?.id, visibleItemCount]);

  /*
   * The feed queries used to be a tab strip over the column. The platform's
   * four-region layout puts every page's own switcher in the page-left
   * column instead — the same shared column contract (bbs-*) the settings
   * directory inherits, so the sticky width, the sub-1440px toggle and the
   * phone drawer all come along without being restated.
   */
  return (
    <div className="feed-directory-layout bbs-directory-layout tab-left-column-layout">
      <button
        type="button"
        className="bbs-directory-mobile-toggle"
        onClick={() => setFeedDirectoryOpen((open) => !open)}
        aria-controls="feed-directory"
        aria-expanded={feedDirectoryOpen}
      >
        {copy.feedLabel}
      </button>
      {feedDirectoryOpen ? (
        <button
          type="button"
          className="bbs-directory-backdrop"
          onClick={() => setFeedDirectoryOpen(false)}
          aria-label={locale === "en" ? "Close" : "閉じる"}
        />
      ) : null}
      <aside
        id="feed-directory"
        data-hub-page-left-column
        className={`feed-directory bbs-thread-directory tab-left-column${feedDirectoryOpen ? " bbs-thread-directory--open" : ""}`}
        aria-label={copy.feedLabel}
      >
        <header className="bbs-thread-directory__header tab-left-column__header">
          <div>
            <strong>{copy.feedHeading}</strong>
          </div>
          <button type="button" onClick={() => setFeedDirectoryOpen(false)} aria-label={locale === "en" ? "Close" : "閉じる"}>×</button>
        </header>
        <nav className="bbs-thread-directory__nav feed-directory__nav" role="tablist" aria-label={copy.feedLabel}>
          {queryTabs.map((query) => {
            const isActive = queryState.activeId === query.id;
            return (
              <button
                type="button"
                role="tab"
                key={query.id}
                title={query.keyword ? `${query.label}: ${query.keyword}` : query.label}
                className={`tl-tab${query.source === "list" ? " tl-tab--list" : ""}${isActive ? " tl-tab--active" : ""}`}
                aria-pressed={isActive}
                aria-selected={isActive}
                onClick={() => { selectQuery(query); setFeedDirectoryOpen(false); }}
              >
                {query.label}
              </button>
            );
          })}
          <button
            type="button"
            className="home-feed__query-trigger"
            aria-expanded={queryEditorOpen}
            onClick={() => setQueryEditorOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden="true" size={16} />
            {locale === "en" ? "Create a feed" : "フィードを作成"}
          </button>
        </nav>
      </aside>
      {/*
        検索は本体列の最上段に置く（2026-08-30の4列規格）。以前は中左列の
        ページ名の行に .shell-page-search として出ていたが、共有の検索欄
        ルールと width を奪い合って本体列を14pxはみ出していた。
        置き場所を規格へ寄せると、その競合ごと無くなる。
      */}
      <TabMainSearchHeader action="/search" ariaLabel="Hubを検索" placeholder="投稿・スレッド・人物を検索" />
      <div className="feed-directory-content bbs-directory-content">
    <div className="tl-page home-feed">
      {/*
        * The switcher lives in the page-left column, so this heading is the
        * screen's one name for readers who navigate by heading.
        */}
      <h1 className="sr-only">{copy.feedHeading}</h1>
      {queryEditorOpen ? (
        <form
          className="home-feed__query-editor"
          onSubmit={(event) => {
            event.preventDefault();
            if (!queryLabel.trim()) return;
            const query = createFeedQuery({
              label: queryLabel,
              keyword: queryKeyword,
              source: querySource,
              sort: querySort,
            });
            dispatchQuery({ type: "save", query });
            selectQuery(query);
            setQueryEditorOpen(false);
            setQueryLabel("");
            setQueryKeyword("");
          }}
        >
          <div className="home-feed__query-editor-heading">
            <strong>{locale === "en" ? "Create a feed" : "フィードを作成"}</strong>
            <span>{locale === "en" ? "Save a query as a tab." : "検索条件をタブとして保存します。"}</span>
          </div>
          <label>
            <span>{locale === "en" ? "Tab name" : "タブ名"}</span>
            <input value={queryLabel} maxLength={24} required onChange={(event) => setQueryLabel(event.target.value)} />
          </label>
          <label>
            <span>{locale === "en" ? "Keyword" : "キーワード"}</span>
            <input value={queryKeyword} maxLength={80} onChange={(event) => setQueryKeyword(event.target.value)} />
          </label>
          <label>
            <span>{locale === "en" ? "Source" : "取得元"}</span>
            <select value={querySource} onChange={(event) => setQuerySource(event.target.value as Exclude<FeedQuerySource, "list">)}>
              <option value="recommended">{locale === "en" ? "Recommended" : "おすすめ"}</option>
              <option value="latest">{locale === "en" ? "Latest" : "新着"}</option>
              <option value="popular">{locale === "en" ? "Popular" : "人気"}</option>
              <option value="following">{locale === "en" ? "Following" : "フォロー"}</option>
            </select>
          </label>
          <label>
            <span>{locale === "en" ? "Order" : "並び順"}</span>
            <select value={querySort} onChange={(event) => setQuerySort(event.target.value as FeedQuerySort)}>
              <option value="relevance">{locale === "en" ? "Relevant" : "関連順"}</option>
              <option value="popular">{locale === "en" ? "Popular" : "人気順"}</option>
              <option value="newest">{locale === "en" ? "Newest" : "新着順"}</option>
            </select>
          </label>
          <div className="home-feed__query-editor-actions">
            {activeQuery && !activeQuery.system ? (
              <button
                type="button"
                className="button"
                onClick={() => {
                  dispatchQuery({ type: "remove", id: activeQuery.id });
                  selectQuery(tabs[0]);
                  setQueryEditorOpen(false);
                }}
              >
                {locale === "en" ? "Delete current" : "現在のタブを削除"}
              </button>
            ) : null}
            <button type="submit" className="button button--primary">{locale === "en" ? "Save" : "保存"}</button>
          </div>
        </form>
      ) : null}

      {authenticated ? <>
      <button
        ref={mobileComposeTriggerRef}
        type="button"
        className="mobile-compose-fab"
        aria-label="投稿を作成"
        aria-expanded={mobileComposeOpen}
        aria-haspopup="dialog"
        onClick={openMobileComposer}
      >
        ＋
      </button>
      {mobileComposeOpen ? (
        <div
          className="mobile-compose-backdrop"
          data-mobile-compose-backdrop=""
          aria-hidden="true"
          onClick={closeMobileComposer}
        />
      ) : null}
      <div
        ref={mobileComposeDialogRef}
        className={`tl-compose home-compose hub-temporary-glass${composeExpanded || mobileComposeOpen ? " home-compose--expanded" : " home-compose--collapsed"}${mobileComposeOpen ? " home-compose--mobile-open" : ""}`}
        role={mobileComposeOpen ? "dialog" : undefined}
        aria-modal={mobileComposeOpen ? true : undefined}
        aria-labelledby={mobileComposeOpen ? "home-compose-dialog-title" : undefined}
        tabIndex={mobileComposeOpen ? -1 : undefined}
        onKeyDown={mobileComposeOpen ? handleMobileComposerKeyDown : undefined}
      >
        <div className="home-compose__layout">
          <span className="home-compose__avatar" aria-hidden="true">
            {currentUserAvatarUrl ? <img src={currentUserAvatarUrl} alt="" /> : avatarChar(currentUserDisplayName)}
          </span>
          <div className="tl-compose__body">
            <div className="home-compose__heading">
              <div>
                <strong id="home-compose-dialog-title">{locale === "en" ? "Create post" : "ポストを作成"}</strong>
                <span>{currentUserDisplayName}{copy.postAs}</span>
              </div>
              <button type="button" className="mobile-compose-close" aria-label="投稿画面を閉じる" onClick={closeMobileComposer}>×</button>
            </div>
          <textarea
            ref={mobileComposeInputRef}
            id="home-compose"
            className="tl-compose__input"
            placeholder={copy.placeholder}
            value={composeBody}
            maxLength={SOCIAL_POST_MAX_LENGTH}
            aria-describedby="home-compose-character-count"
            onFocus={() => setComposeExpanded(true)}
            {...composeMention.inputProps}
            onChange={(event) => {
              setComposeExpanded(true);
              setComposeStatus("");
              setCrossPostConfirmed(false);
              composeMention.inputProps.onChange(event);
            }}
            onKeyDown={(event) => {
              if (composeMention.handleSuggestionKey(event)) return;
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) submitPost();
            }}
            disabled={isPending}
          />
          {(composeExpanded || mobileComposeOpen) ? (
            <small id="home-compose-character-count" className="tl-compose__character-count" aria-live="polite">
              {locale === "en"
                ? `${(SOCIAL_POST_MAX_LENGTH - composeBody.length).toLocaleString()} characters remaining / ${SOCIAL_POST_MAX_LENGTH.toLocaleString()}`
                : `残り${(SOCIAL_POST_MAX_LENGTH - composeBody.length).toLocaleString()} / ${SOCIAL_POST_MAX_LENGTH.toLocaleString()}文字`}
            </small>
          ) : null}
          {(composeExpanded || mobileComposeOpen) ? <small className="home-compose__long-form-hint">
            {locale === "en" ? "For longer writing, " : "長文は"}
            <a href="/bbs">{locale === "en" ? "create a thread" : "スレッドで投稿"}</a>
            {locale === "en" ? "." : "できます。"}
          </small> : null}
          <MentionSuggestionList
            id="home-compose-mention-suggestions"
            locale={locale}
            suggestions={composeMention.suggestions}
            selectedIndex={composeMention.selectedIndex}
            onChoose={composeMention.choose}
          />
          {(composeExpanded || mobileComposeOpen) ? <ExternalLinkCard body={composeBody} /> : null}
          {composeImages.length ? <div className={`post-image-grid post-image-grid--${composeImages.length}`}>
            {composeImages.map((image, index) => <figure className="post-image-grid__item post-image-grid__item--editing" key={image.previewUrl}>
              <img src={image.previewUrl} alt="" />
              <button type="button" aria-label={`画像${index + 1}を削除`} onClick={() => { URL.revokeObjectURL(image.previewUrl); setComposeImages((current) => current.filter((_, itemIndex) => itemIndex !== index)); }}>×</button>
              <input value={image.altText} maxLength={300} placeholder="画像の説明（任意）" aria-label={`画像${index + 1}の説明`}
                onChange={(event) => setComposeImages((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, altText: event.target.value } : item))} />
              <select aria-label={`画像${index + 1}のトリミング`} defaultValue="original" disabled={isPreparingImages} onChange={async (event) => {
                const crop = event.target.value as ImageCrop; setComposeError(""); setIsPreparingImages(true);
                try { const reframed = await renderComposeImage(image.sourceFile, crop, image.altText); URL.revokeObjectURL(image.previewUrl); setComposeImages((current) => current.map((item, itemIndex) => itemIndex === index ? reframed : item)); }
                catch (error) { setComposeError(error instanceof Error ? error.message : "画像を処理できませんでした。"); }
                finally { setIsPreparingImages(false); }
              }}><option value="original">元の比率</option><option value="square">正方形</option><option value="portrait">縦長 4:5</option><option value="landscape">横長 16:9</option></select>
            </figure>)}
          </div> : null}
          {composeTags.length ? <ContentTagLinks tags={composeTags} /> : null}
          {(composeBody || composeImages.length > 0 || composeScheduledAt || composeAudience !== "public") ? <div className="tl-compose__draft-status">
            <small>{draftRestored ? "この端末に保存した下書きを復元しました。" : "下書きはこの端末だけに自動保存されます。共有端末では破棄してください。"}</small>
            <button type="button" className="compose-icon-button" aria-label="下書きを破棄" title="下書きを破棄" onClick={discardComposeDraft}>
              <Trash2 aria-hidden="true" />
            </button>
          </div> : null}
          {(composeExpanded || mobileComposeOpen) ? <section className="home-compose__delivery" aria-label={locale === "en" ? "Destination and visibility" : "送信先と公開範囲"}>
            <div className="home-compose__delivery-summary" aria-live="polite">
              <div><span>{locale === "en" ? "Destination" : "送信先"}</span><strong>{composeDestinationLabel}</strong></div>
              <div><span>{locale === "en" ? "Audience" : "公開範囲"}</span><strong>{composeAudienceLabel}</strong></div>
              <div><span>{locale === "en" ? "Timing" : "投稿日時"}</span><strong>{composeTimingLabel}</strong></div>
              <button type="button" className="home-compose__delivery-button" aria-label={locale === "en" ? "Edit destination and visibility" : "送信先と公開範囲を設定"} aria-expanded={composeOptionsOpen} onClick={() => setComposeOptionsOpen((open) => !open)}>
                <SlidersHorizontal aria-hidden="true" />
                <span>{composeOptionsOpen ? (locale === "en" ? "Close settings" : "設定を閉じる") : (locale === "en" ? "Edit" : "変更")}</span>
              </button>
            </div>
            {composeOptionsOpen ? <div className="home-compose__options">
              <div className="home-compose__options-heading"><strong>{locale === "en" ? "Publishing settings" : "公開と配信"}</strong><span>{locale === "en" ? "Review where, who, and when before posting." : "投稿先・公開相手・日時を確認できます。"}</span></div>
              <label><span>{locale === "en" ? "Audience" : "公開範囲"}</span><select value={composeAudience} onChange={(event) => { setComposeStatus(""); setComposeAudience(event.target.value === "followers" ? "followers" : "public"); }}><option value="public">{locale === "en" ? "Everyone" : "全員"}</option><option value="followers">{locale === "en" ? "Followers" : "フォロワー"}</option></select></label>
              <label><span>{locale === "en" ? "Schedule" : "予約投稿"}</span><input type="datetime-local" value={composeScheduledAt} min={new Date(Date.now() + 60_000).toISOString().slice(0, 16)} onChange={(event) => {
              const nextScheduledAt = event.target.value;
              setComposeStatus("");
              if (nextScheduledAt && composeImages.length > 0) {
                setComposeError(locale === "en"
                  ? "Scheduled posts support text only. Remove the images before choosing a time."
                  : "予約投稿は本文のみ対応しています。日時を指定する前に画像を削除してください。");
                return;
              }
              setComposeError("");
              setComposeScheduledAt(nextScheduledAt);
            }} /></label>
            <CrossPostControl
              body={composeBody}
              selected={crossPostDestinations}
              confirmed={crossPostConfirmed}
              disabled={isPending}
              locale={locale}
              onSelectedChange={setCrossPostDestinations}
              onConfirmedChange={setCrossPostConfirmed}
            />
            </div> : null}
          </section> : null}
          {(composeExpanded || mobileComposeOpen) ? <div className="tl-compose__footer">
            <div className="tl-compose__actions">
              <label
                className="post-image-picker"
                aria-label={composeScheduledAt ? "予約投稿には画像を追加できません" : isPreparingImages ? "画像を処理中" : "画像を追加"}
                title={composeScheduledAt ? "予約投稿には画像を追加できません" : isPreparingImages ? "画像を処理中" : "画像を追加"}
                aria-disabled={Boolean(composeScheduledAt)}
              >
                <ImageIcon aria-hidden="true" />
                <span className="hub-sr-only">{isPreparingImages ? "画像を処理中" : "画像を追加"}</span>
                <input type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={isPending || isPreparingImages || Boolean(composeScheduledAt) || composeImages.length >= 4}
                  onChange={async (event) => { const files = [...(event.target.files ?? [])].slice(0, 4 - composeImages.length); event.target.value = ""; setComposeError(""); setComposeStatus(""); setIsPreparingImages(true);
                    try { const prepared = await Promise.all(files.map(prepareComposeImage)); setComposeImages((current) => [...current, ...prepared].slice(0, 4)); }
                    catch (error) { setComposeError(error instanceof Error ? error.message : "画像を処理できませんでした。"); }
                    finally { setIsPreparingImages(false); } }} />
              </label>
              <a className="compose-icon-button" href="/community" aria-label={locale === "en" ? "Community post or poll" : "コミュニティ投稿・投票"} title={locale === "en" ? "Community post or poll" : "コミュニティ投稿・投票"}>
                <UsersRound aria-hidden="true" />
              </a>
              <small>{composeScheduledAt
                ? (locale === "en" ? "Scheduled posts support text only." : "予約投稿は本文のみ対応しています。")
                : copy.shortcut}</small>
            </div>
            <AsyncActionButton className="tl-compose__submit" onClick={submitPost} pending={isPending || isPreparingImages} pendingLabel={isPreparingImages ? "画像を処理中…" : copy.posting} disabled={!isOnline || composeCooldownSeconds > 0 || composeBody.length > SOCIAL_POST_MAX_LENGTH || Boolean(composeScheduledAt && composeImages.length > 0) || (!composeBody.trim() && composeImages.length === 0)}>
              <span className="desktop-compose-submit-label">{composeCooldownSeconds > 0 ? `${composeCooldownSeconds}秒後` : isPending ? copy.posting : composeSubmitLabel}</span>
              <span className="mobile-compose-submit-label">{composeCooldownSeconds > 0 ? `${composeCooldownSeconds}秒後` : isPending ? copy.posting : composeSubmitLabel}</span>
            </AsyncActionButton>
          </div> : null}
          {composeError ? <p className="inline-error" role="alert">{composeError}</p> : null}
          {composeStatus ? <p className="tl-compose__status" role="status">{composeStatus}</p> : null}
          {crossPostRecovery ? <button type="button" className="button" disabled={crossPostRecoveryPending} onClick={() => {
            setCrossPostRecoveryPending(true);
            void commitTextCrossPost(crossPostRecovery.previewId, crossPostRecovery.destinations).then((receipts) => {
              const unresolved = receipts.filter((receipt) => receipt.status !== "succeeded");
              if (unresolved.length === 0) {
                setCrossPostRecovery(null);
                setComposeStatus(locale === "en" ? "The existing Hub post was delivered to every selected destination." : "投稿済みのHubポストを選択したすべての送信先へ送りました。");
              } else {
                const hasFailed = unresolved.some((receipt) => receipt.status === "failed");
                setComposeStatus(locale === "en" ? "Some destinations are still unresolved." : "一部の送信先は未確定です。不明状態は二重投稿防止のため再送しません。");
                if (!hasFailed) setCrossPostRecovery(null);
              }
            }).catch((error) => {
              setCrossPostRecovery(null);
              setComposeStatus(error instanceof Error ? error.message : "外部送信の結果を確認できませんでした。");
            }).finally(() => setCrossPostRecoveryPending(false));
          }}>{crossPostRecoveryPending ? (locale === "en" ? "Retrying failed destinations…" : "失敗した送信先へ再送中…") : (locale === "en" ? "Retry failed destinations only" : "失敗した送信先だけ再試行")}</button> : null}
          </div>
        </div>
      </div>
      </> : null}

      <div className={`home-feed__stream${feedMotion ? ` home-feed__stream--swipe-${feedMotion.direction}-${feedMotion.nonce % 2}` : ""}`}>
        {activeTab === "recommended" && personalizationEnabled && interest ? <aside className="timeline-list-panel" aria-label="関連するおすすめ"><div className="timeline-list-panel__heading"><strong>「{interest}」からおすすめ</strong></div><div className="timeline-list-panel__actions"><a className="button" href={`/bbs?q=${encodeURIComponent(interest)}`}>スレッド</a><a className="button" href={`/hubpedia?q=${encodeURIComponent(interest)}`}>Hubpedia</a><a className="button" href={`/community?q=${encodeURIComponent(interest)}`}>コミュニティ</a></div></aside> : null}
        {pendingNewPosts.length > 0 ? <button type="button" className="home-feed__new-posts" onClick={applyNewPosts}>
          {locale === "en" ? `${pendingNewPosts.length} new post${pendingNewPosts.length === 1 ? "" : "s"}` : `新着${pendingNewPosts.length}件`}
        </button> : null}
        {feedLoadError ? <div className="home-feed__load-error" role="status"><span>新しい投稿を読み込めませんでした。表示中の投稿はそのまま利用できます。</span><UiButton size="compact" type="button" onClick={() => { setFeedLoadError(false); router.refresh(); }}>再試行</UiButton></div> : null}
        {activeTab === "lists" ? visibleListFeedItems.map((item, index) => <React.Fragment key={item.kind === "social" ? `social-${item.post.id}` : `thread-response-${item.response.id}`}>
          {listUnreadBoundaryIndex > 0 && index === listUnreadBoundaryIndex ? <div className="home-feed__unread-marker" role="separator"><span>{locale === "en" ? "Unread from here" : "ここから未読"}</span></div> : null}
          {item.kind === "social"
            ? <TweetCard post={item.post} locale={locale} viewerProfileId={currentProfileId} masonry />
            : <ThreadResponseCard response={item.response} locale={locale} masonry />}
          {inlineAd && shouldInsertRecurringAd(index, adFirstAfterItem) ? <div className="home-feed__inline-ad">{inlineAd}</div> : null}
        </React.Fragment>) : visiblePosts.map((post, index) => <React.Fragment key={post.id}>
          {unreadBoundaryIndex > 0 && index === unreadBoundaryIndex ? <div className="home-feed__unread-marker" role="separator"><span>{locale === "en" ? "Unread from here" : "ここから未読"}</span></div> : null}
          <TweetCard post={post} locale={locale} viewerProfileId={currentProfileId} masonry recommendation={activeTab === "recommended" ? recommendationReason(post, followedProfileIds, postHistoryIds) : undefined} />
          {activeTab === "recommended" && index % 4 === 3 && activityPubRecommendations[Math.floor(index / 4)]
            ? <ActivityPubRecommendationCard item={activityPubRecommendations[Math.floor(index / 4)]} locale={locale} />
            : null}
          {activeTab === "recommended" && index % 4 === 3 && atProtocolRecommendations[Math.floor(index / 4)]
            ? <AtProtocolRecommendationCard item={atProtocolRecommendations[Math.floor(index / 4)]} locale={locale} />
            : null}
          {inlineAd && shouldInsertRecurringAd(index, adFirstAfterItem)
            ? <div className="home-feed__inline-ad">{inlineAd}</div> : null}
        </React.Fragment>)}
        {(activeTab === "lists" ? listFeedItems.length === 0 : filteredPosts.length === 0) ? (
          <UiStatePanel
            className="timeline-empty"
            state="empty"
            title={activeTab === "following" ? copy.emptyFollowing : activeTab === "lists" ? copy.emptyList : copy.empty}
            description={activeTab === "following" ? copy.emptyFollowingHelp : activeTab === "lists" ? copy.emptyListHelp : copy.emptyHelp}
            action={activeTab === "following" ? <a href="/community">{copy.findMembers}</a> : undefined}
          />
        ) : null}
        {hasLocallyHiddenItems || (
          activeTab === "lists"
            ? listFeedState.listId === selectedList?.id && listFeedState.hasMore
            : activeTab === "popular" ? hasMorePopularPosts
              : activeTab === "recommended" ? hasMoreRecommendedPosts
            : activeTab === "following" ? hasMoreFollowingPosts : hasMorePosts
        ) ? (
          <div ref={postSentinelRef} aria-live="polite">
            {morePostsPending ? "読み込み中…" : null}
          </div>
        ) : null}
      </div>
    </div>
      </div>
    </div>
  );
}
