"use client";

import React, {
  Suspense,
  cloneElement,
  isValidElement,
  lazy,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NavIcon } from "@/components/sidebar";
import {
  HUB_AI_CONTEXT_EVENT,
  normalizeHubAiContext,
  type HubAiContext,
} from "@/lib/ai-context";
import { HUBPEDIA_CONTEXT_EVENT, type HubpediaContextDetail } from "@/lib/hubpedia-context";

const loadAiRightRail = () => import("@/components/ai-right-rail");
const loadMessagesRightRail = () => import("@/components/messages-right-rail");
const loadNotificationsRightRail = () => import("@/components/notifications-right-rail");
const loadCatalogRightRails = () => import("@/components/catalog-right-rails");
const loadMusicRightRail = () => import("@/components/music-right-rail");

const AiRightRail = lazy(() => loadAiRightRail().then((module) => ({ default: module.AiRightRail })));
const MessagesRightRail = lazy(() => loadMessagesRightRail().then((module) => ({ default: module.MessagesRightRail })));
const NotificationsRightRail = lazy(() => loadNotificationsRightRail().then((module) => ({ default: module.NotificationsRightRail })));
const CommunityRightRail = lazy(() => loadCatalogRightRails().then((module) => ({ default: module.CommunityRightRail })));
const MusicRightRail = lazy(() => loadMusicRightRail().then((module) => ({ default: module.MusicRightRail })));

// SSR では useEffect にフォールバック（useLayoutEffect はサーバーで動作しないため）
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const DRAWER_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[contenteditable='true']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

function useMediaQueryMatches(query: string) {
  const [matches, setMatches] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(query);
    const sync = () => setMatches(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, [query]);

  return matches;
}

function isRenderedForDrawerFocus(element: HTMLElement) {
  let current: HTMLElement | null = element;
  while (current) {
    const style = window.getComputedStyle(current);
    if (style.display === "none" || style.visibility === "hidden") return false;
    current = current.parentElement;
  }
  return true;
}

function focusableElementsWithin(containers: readonly (HTMLElement | null)[]) {
  const elements = new Set<HTMLElement>();
  containers.forEach((container) => {
    if (!container) return;
    if (container.matches(DRAWER_FOCUSABLE_SELECTOR)) elements.add(container);
    container.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE_SELECTOR).forEach((element) => elements.add(element));
  });
  return [...elements].filter((element) =>
    element.isConnected
    && !element.closest("[inert], [hidden], [aria-hidden='true']")
    && isRenderedForDrawerFocus(element)
  );
}

function useDrawerFocus({
  active,
  getFocusables,
  initialFocus,
  onDismiss,
}: {
  active: boolean;
  getFocusables: () => HTMLElement[];
  initialFocus: () => HTMLElement | null;
  onDismiss: () => void;
}) {
  const dismissRef = useRef(onDismiss);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const wasActiveRef = useRef(false);
  dismissRef.current = onDismiss;

  useIsomorphicLayoutEffect(() => {
    if (active && !wasActiveRef.current) {
      restoreFocusRef.current = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
      wasActiveRef.current = true;
      (initialFocus() ?? getFocusables()[0])?.focus();
      return;
    }
    if (!active && wasActiveRef.current) {
      const restoreTarget = restoreFocusRef.current;
      restoreFocusRef.current = null;
      wasActiveRef.current = false;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    }
  }, [active, getFocusables, initialFocus]);

  useEffect(() => () => {
    const restoreTarget = restoreFocusRef.current;
    restoreFocusRef.current = null;
    wasActiveRef.current = false;
    if (restoreTarget?.isConnected) restoreTarget.focus();
  }, []);

  useEffect(() => {
    if (!active) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = getFocusables();
      if (focusables.length === 0) {
        event.preventDefault();
        initialFocus()?.focus();
        return;
      }

      const focusedIndex = document.activeElement instanceof HTMLElement
        ? focusables.indexOf(document.activeElement)
        : -1;
      if (focusedIndex === -1) {
        event.preventDefault();
        focusables[event.shiftKey ? focusables.length - 1 : 0]?.focus();
      } else if (event.shiftKey && focusedIndex === 0) {
        event.preventDefault();
        focusables[focusables.length - 1]?.focus();
      } else if (!event.shiftKey && focusedIndex === focusables.length - 1) {
        event.preventDefault();
        focusables[0]?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [active, getFocusables, initialFocus]);
}

const LEFT_DEFAULT = 210;
const RIGHT_DEFAULT = 320;
const LEFT_COLLAPSED = 58;
const RIGHT_COLLAPSED = 58;
const LEFT_MIN = 190;
const LEFT_MAX = 420;
const RIGHT_MIN = 280;
const RIGHT_MAX = 520;
const DESKTOP_RAIL_BREAKPOINT = 1200;
const MIN_DESKTOP_CENTER_WIDTH = 640;
type RightView = "feed" | "messages" | "notifications" | "search" | "ai" | "hubpedia" | "community" | "music";
const RIGHT_VIEWS = new Set<RightView>(["feed", "messages", "notifications", "search", "ai", "hubpedia", "community", "music"]);
const RIGHT_VIEW_ORDER: readonly RightView[] = ["feed", "messages", "notifications", "search", "ai", "hubpedia", "community", "music"];
const RIGHT_VIEW_META: Record<RightView, { label: string; href: string }> = {
  feed: { label: "フィード", href: "/feed" },
  messages: { label: "メッセージ", href: "/messages" },
  search: { label: "検索", href: "/search" },
  notifications: { label: "通知", href: "/notifications" },
  ai: { label: "AI", href: "/ai" },
  hubpedia: { label: "Hubpedia", href: "/hubpedia" },
  community: { label: "コミュニティ", href: "/community" },
  music: { label: "音楽", href: "/music" },
};
const PAGE_LEFT_COLUMN_SELECTOR = "[data-hub-page-left-column]";

function boundedNumber(value: number, minimum: number, maximum: number, fallback: number) {
  return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

export function constrainDesktopRailWidths(viewportWidth: number, requestedLeft: number, requestedRight: number) {
  let left = boundedNumber(requestedLeft, LEFT_MIN, LEFT_MAX, LEFT_DEFAULT);
  let right = boundedNumber(requestedRight, RIGHT_MIN, RIGHT_MAX, RIGHT_DEFAULT);

  if (!Number.isFinite(viewportWidth) || viewportWidth < DESKTOP_RAIL_BREAKPOINT) {
    return { left, right };
  }

  const railBudget = Math.max(
    LEFT_MIN + RIGHT_MIN,
    Math.floor(viewportWidth - MIN_DESKTOP_CENTER_WIDTH),
  );
  if (left + right <= railBudget) return { left, right };

  // Preserve the navigation rail first and reduce the auxiliary rail. If its
  // minimum is not enough, reduce the navigation rail as well.
  right = Math.max(RIGHT_MIN, Math.min(right, railBudget - left));
  left = Math.max(LEFT_MIN, Math.min(left, railBudget - right));

  if (left + right > railBudget) {
    right = RIGHT_MIN;
    left = Math.max(LEFT_MIN, railBudget - right);
  }

  return { left, right };
}

function currentViewportWidth() {
  if (typeof window === "undefined") return DESKTOP_RAIL_BREAKPOINT;
  return document.documentElement.clientWidth || window.innerWidth;
}

function preloadRightView(view: RightView) {
  if (view === "ai") void loadAiRightRail();
  else if (view === "messages") void loadMessagesRightRail();
  else if (view === "notifications") void loadNotificationsRightRail();
  else if (view === "music") void loadMusicRightRail();
  else if (view === "community") void loadCatalogRightRails();
}

function RightRailLoading({ label }: { label: string }) {
  return <div className="right-rail-loading" role="status">{label}を読み込み中…</div>;
}

function systemPrefersDark() {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

interface ShellFrameProps {
  currentPath?: string;
  rightProfileId?: string;
  children: ReactNode;
  left: ReactNode;
  showTimelineRail: boolean;
  right?: ReactNode;
  wideContent?: boolean;
  shoppingContent?: boolean;
  forumContent?: boolean;
}

export function ShellFrame({ currentPath = "/", rightProfileId, children, left, showTimelineRail, right, wideContent = false, shoppingContent = false, forumContent = false }: ShellFrameProps) {
  const swipeStart = useRef<{ x: number; y: number; startedAt: number; cancelled: boolean } | null>(null);
  const [leftWidth, setLeftWidth] = useState(LEFT_DEFAULT);
  const [rightWidth, setRightWidth] = useState(RIGHT_DEFAULT);
  // Start closed so the installed app can never paint or restore an open
  // drawer before the surface contract is known. Desktop web opens it in the
  // layout effect below before paint.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pageLeftColumnOpen, setPageLeftColumnOpen] = useState(false);
  const [pageLeftColumnCollapsed, setPageLeftColumnCollapsed] = useState(false);
  const [hasPageLeftColumn, setHasPageLeftColumn] = useState(false);
  const [pageLeftColumnId, setPageLeftColumnId] = useState("hub-page-left-column");
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [rightView, setRightView] = useState<RightView>("feed");
  const [aiMounted, setAiMounted] = useState(false);
  const [messagesMounted, setMessagesMounted] = useState(false);
  useEffect(() => { if (rightView === "ai" && timelineOpen) setAiMounted(true); }, [rightView, timelineOpen]);
  useEffect(() => { if (rightView === "messages" && timelineOpen) setMessagesMounted(true); }, [rightView, timelineOpen]);
  const rightScrollPositions = useRef<Record<string, number>>({});
  const [aiContext, setAiContext] = useState<HubAiContext | null>(null);
  const [hubpediaContext, setHubpediaContext] = useState("");
  const [hubpediaContextSource, setHubpediaContextSource] = useState<Pick<HubpediaContextDetail, "targetId" | "targetType"> | null>(null);
  const [contextTargetId, setContextTargetId] = useState("");
  const [isDark, setIsDark] = useState(true);
  const [surface, setSurface] = useState<"web" | "app">("web");
  // 初回レンダー時はインラインスタイルを適用しない。
  // layout.tsx のインラインスクリプトが html 要素に設定した CSS 変数を継承させることで
  // サーバーレンダリング時の幅フラッシュを防ぐ。
  const [ready, setReady] = useState(false);
  const leftWidthRef = useRef(LEFT_DEFAULT);
  const rightWidthRef = useRef(RIGHT_DEFAULT);
  const leftRailRef = useRef<HTMLDivElement>(null);
  const leftToggleRef = useRef<HTMLButtonElement>(null);
  const rightRailRef = useRef<HTMLDivElement>(null);
  const rightToggleRef = useRef<HTMLButtonElement>(null);
  const rightSwitcherRef = useRef<HTMLDivElement>(null);
  const compactLeftDrawer = useMediaQueryMatches("(max-width: 1023px)");
  const compactRightDrawer = useMediaQueryMatches("(max-width: 1199px)");
  const leftDrawerActive = ready && surface === "app" && compactLeftDrawer && sidebarOpen;
  const rightDrawerActive = ready && surface === "web" && compactRightDrawer && timelineOpen;
  const closeSidebarDrawer = useCallback(() => setSidebarOpen(false), []);
  const closeTimelineDrawer = useCallback(() => {
    setTimelineOpen(false);
    window.localStorage.setItem("hub.right-open", "false");
  }, []);
  const getLeftDrawerFocusables = useCallback(
    () => focusableElementsWithin([leftRailRef.current, leftToggleRef.current]),
    [],
  );
  const getRightDrawerFocusables = useCallback(
    () => focusableElementsWithin([rightRailRef.current, rightToggleRef.current, rightSwitcherRef.current]),
    [],
  );
  const focusLeftDrawerToggle = useCallback(() => leftToggleRef.current, []);
  const focusRightDrawerToggle = useCallback(() => rightToggleRef.current, []);

  useDrawerFocus({
    active: leftDrawerActive,
    getFocusables: getLeftDrawerFocusables,
    initialFocus: focusLeftDrawerToggle,
    onDismiss: closeSidebarDrawer,
  });
  useDrawerFocus({
    active: rightDrawerActive,
    getFocusables: getRightDrawerFocusables,
    initialFocus: focusRightDrawerToggle,
    onDismiss: closeTimelineDrawer,
  });
  useIsomorphicLayoutEffect(() => {
    if (
      !timelineOpen
      && document.activeElement instanceof HTMLElement
      && rightRailRef.current?.contains(document.activeElement)
    ) {
      rightToggleRef.current?.focus();
    }
  }, [timelineOpen]);

  const applyRailWidths = useCallback((
    requestedLeft: number,
    requestedRight: number,
    options: { persist?: boolean; viewportWidth?: number } = {},
  ) => {
    const constrained = constrainDesktopRailWidths(
      options.viewportWidth ?? currentViewportWidth(),
      requestedLeft,
      requestedRight,
    );
    leftWidthRef.current = constrained.left;
    rightWidthRef.current = constrained.right;
    setLeftWidth(constrained.left);
    setRightWidth(constrained.right);
    if (options.persist) {
      window.localStorage.setItem("hub.left-width", String(constrained.left));
      window.localStorage.setItem("hub.right-width", String(constrained.right));
    }
    return constrained;
  }, []);

  useIsomorphicLayoutEffect(() => {
    const appSurface = document.documentElement.dataset.hubSurface === "app";
    const compactViewport =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1023px)").matches;
    const compactTimelineViewport =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1199px)").matches;
    setSurface(appSurface ? "app" : "web");
    if (appSurface || compactViewport) {
      setSidebarOpen(false);
      setPageLeftColumnOpen(false);
    } else {
      setSidebarOpen(true);
    }
    setPageLeftColumnCollapsed(
      !compactViewport && window.localStorage.getItem("hub.page-left-column-collapsed") === "true",
    );
    if (appSurface) {
      setTimelineOpen(false);
    }
    const savedTheme = window.localStorage.getItem("hub.theme");
    const dark = savedTheme === "dark" || (savedTheme !== "light" && (savedTheme !== "auto" || systemPrefersDark()));
    setIsDark(dark);
    document.documentElement.dataset.theme = dark ? "dark" : "light";

    const savedLeft = window.localStorage.getItem("hub.left-width");
    const savedRight = window.localStorage.getItem("hub.right-width");
    RIGHT_VIEW_ORDER.forEach((view) => window.localStorage.removeItem(`hub.right-width.${view}`));

    const storedLeft = savedLeft ? Number(savedLeft) : LEFT_DEFAULT;
    const storedRight = savedRight ? Number(savedRight) : RIGHT_DEFAULT;
    applyRailWidths(
      storedLeft === 252 ? LEFT_DEFAULT : storedLeft,
      storedRight,
      { persist: Boolean(savedLeft || savedRight) },
    );

    const savedRightView = window.localStorage.getItem("hub.right-view");
    const savedFeedMode = window.localStorage.getItem("hub.right-feed-mode");
    let restoredRightView: RightView = "feed";
    if (!appSurface && savedRightView === "feed" && savedFeedMode === "posts") restoredRightView = "search";
    else if (!appSurface && savedRightView === "feed" && savedFeedMode === "hubpedia") restoredRightView = "hubpedia";
    else if (!appSurface && savedRightView === "threads") restoredRightView = "search";
    else if (!appSurface && savedRightView && RIGHT_VIEWS.has(savedRightView as RightView)) restoredRightView = savedRightView as RightView;
    setRightView(restoredRightView);

    if (!appSurface && !compactTimelineViewport && showTimelineRail) {
      const restoredOpen = window.localStorage.getItem("hub.right-open") !== "false";
      setTimelineOpen(restoredOpen);
      if (restoredOpen) preloadRightView(restoredRightView);
    } else {
      setTimelineOpen(false);
    }

    setReady(true);
  }, [applyRailWidths, showTimelineRail]);

  useEffect(() => {
    const syncSurface = () => {
      const nextSurface = document.documentElement.dataset.hubSurface === "app" ? "app" : "web";
      setSurface(nextSurface);
      if (nextSurface === "app") {
        setSidebarOpen(false);
        setTimelineOpen(false);
      }
    };
    syncSurface();
    window.addEventListener("hub:surface-change", syncSurface);
    return () => window.removeEventListener("hub:surface-change", syncSurface);
  }, []);

  useEffect(() => {
    const resetColumnWidths = () => {
      applyRailWidths(LEFT_DEFAULT, RIGHT_DEFAULT, { persist: true });
    };
    window.addEventListener("hub:column-width-reset", resetColumnWidths);
    return () => window.removeEventListener("hub:column-width-reset", resetColumnWidths);
  }, [applyRailWidths]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const keepCenterReadable = () => {
      const viewportWidth = currentViewportWidth();
      if (viewportWidth < DESKTOP_RAIL_BREAKPOINT) {
        setTimelineOpen(false);
        return;
      }
      applyRailWidths(leftWidthRef.current, rightWidthRef.current, {
        persist: true,
        viewportWidth,
      });
    };
    const restoreStoredWidth = (event: StorageEvent) => {
      if (event.key !== "hub.left-width" && event.key !== "hub.right-width") return;
      const requestedLeft = event.key === "hub.left-width"
        ? event.newValue === null ? LEFT_DEFAULT : Number(event.newValue)
        : leftWidthRef.current;
      const requestedRight = event.key === "hub.right-width"
        ? event.newValue === null ? RIGHT_DEFAULT : Number(event.newValue)
        : rightWidthRef.current;
      applyRailWidths(requestedLeft, requestedRight, { persist: true });
    };

    keepCenterReadable();
    window.addEventListener("resize", keepCenterReadable);
    window.addEventListener("storage", restoreStoredWidth);
    return () => {
      window.removeEventListener("resize", keepCenterReadable);
      window.removeEventListener("storage", restoreStoredWidth);
    };
  }, [applyRailWidths]);

  useEffect(() => {
    if (!showTimelineRail || typeof window.matchMedia !== "function") return;
    const compact = window.matchMedia("(max-width: 1199px)");
    const prioritizeCenter = (event: MediaQueryListEvent | MediaQueryList) => {
      if (event.matches) setTimelineOpen(false);
    };
    prioritizeCenter(compact);
    compact.addEventListener("change", prioritizeCenter);
    return () => compact.removeEventListener("change", prioritizeCenter);
  }, [showTimelineRail]);

  useEffect(() => {
    if (surface === "app") {
      setSidebarOpen(false);
      setTimelineOpen(false);
    }
  }, [surface]);

  useEffect(() => {
    const handleNativeEdgeBack = (event: Event) => {
      if (!isAppSurface()) return;
      event.preventDefault();
      setTimelineOpen(false);
      if (sidebarOpen) {
        setSidebarOpen(false);
        return;
      }
      if (pageLeftColumnOpen) {
        setPageLeftColumnOpen(false);
        return;
      }
      if (pageHasLeftColumn()) {
        setPageLeftColumnOpen(true);
        return;
      }
      setSidebarOpen(true);
    };
    window.addEventListener("hub:native-edge-back", handleNativeEdgeBack);
    return () => window.removeEventListener("hub:native-edge-back", handleNativeEdgeBack);
  }, [currentPath, pageLeftColumnOpen, sidebarOpen]);

  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".main-content");
    if (typeof main?.scrollTo === "function") {
      main.scrollTo({ top: 0, left: 0, behavior: "instant" });
    }
    if (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 1023px)").matches
    ) {
      setSidebarOpen(false);
      setPageLeftColumnOpen(false);
    }
  }, [currentPath]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const compact = window.matchMedia("(max-width: 1023px)");
    const keepCenterReadable = (event: MediaQueryListEvent | MediaQueryList) => {
      if (!event.matches) return;
      setSidebarOpen(false);
      setPageLeftColumnOpen(false);
      setPageLeftColumnCollapsed(false);
    };
    keepCenterReadable(compact);
    compact.addEventListener("change", keepCenterReadable);
    return () => compact.removeEventListener("change", keepCenterReadable);
  }, []);

  const isAppSurface = () => document.documentElement.dataset.hubSurface === "app";
  const ignoreSwipeTarget = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest("input, textarea, select, button, a, [contenteditable='true'], [data-no-shell-swipe]"));
  const pageHasLeftColumn = () => Boolean(document.querySelector(`.main-content ${PAGE_LEFT_COLUMN_SELECTOR}`));

  useEffect(() => {
    const main = document.querySelector<HTMLElement>(".main-content");
    const syncPageLeftColumn = () => {
      const column = main?.querySelector<HTMLElement>(PAGE_LEFT_COLUMN_SELECTOR) ?? null;
      if (column && !column.id) column.id = "hub-page-left-column";
      setHasPageLeftColumn(Boolean(column));
      setPageLeftColumnId(column?.id || "hub-page-left-column");
    };

    syncPageLeftColumn();
    if (!main || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(syncPageLeftColumn);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [currentPath]);

  const handleTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isAppSurface() || event.touches.length !== 1 || ignoreSwipeTarget(event.target)) return;
    const touch = event.touches[0];
    swipeStart.current = { x: touch.clientX, y: touch.clientY, startedAt: performance.now(), cancelled: false };
  };

  const handleTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    if (!start || event.touches.length !== 1) return;
    const touch = event.touches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    if (Math.abs(deltaY) > 18 && Math.abs(deltaY) > Math.abs(deltaX) * .7) {
      start.cancelled = true;
    }
  };

  const handleTouchEnd = (event: React.TouchEvent<HTMLDivElement>) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.cancelled || !isAppSurface() || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const elapsed = performance.now() - start.startedAt;
    const velocity = Math.abs(deltaX) / Math.max(elapsed, 1);
    if (elapsed > 700 || Math.abs(deltaX) < 96 || velocity < .18 || Math.abs(deltaX) < Math.abs(deltaY) * 1.8) return;

    if (deltaX > 0) {
      setTimelineOpen(false);
      if (pageHasLeftColumn() && start.x <= 48) {
        setSidebarOpen(false);
        setPageLeftColumnOpen(true);
        return;
      }
      const swipeEvent = new CustomEvent("hub:feed-swipe", { detail: "previous", cancelable: true });
      window.dispatchEvent(swipeEvent);
      if (!swipeEvent.defaultPrevented && start.x <= 28) setSidebarOpen(true);
    } else {
      if (pageLeftColumnOpen) {
        setPageLeftColumnOpen(false);
        return;
      }
      setSidebarOpen(false);
      window.dispatchEvent(new CustomEvent("hub:feed-swipe", { detail: "next" }));
    }
  };

  useEffect(() => {
    if (!pageLeftColumnOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPageLeftColumnOpen(false);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pageLeftColumnOpen]);

  useEffect(() => {
    if (surface !== "app") {
      delete document.documentElement.dataset.hubDrawerOpen;
      return;
    }

    document.documentElement.dataset.hubDrawerOpen =
      sidebarOpen || pageLeftColumnOpen ? "true" : "false";

    return () => {
      delete document.documentElement.dataset.hubDrawerOpen;
    };
  }, [pageLeftColumnOpen, sidebarOpen, surface]);

  useEffect(() => {
    setPageLeftColumnOpen(false);
  }, [currentPath]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncSystemTheme = () => {
      const savedTheme = window.localStorage.getItem("hub.theme");
      if (savedTheme !== "auto") return;
      const dark = media.matches;
      setIsDark(dark);
      document.documentElement.dataset.theme = dark ? "dark" : "light";
    };
    media.addEventListener("change", syncSystemTheme);
    return () => media.removeEventListener("change", syncSystemTheme);
  }, []);

  useEffect(() => {
    const handleThemeChange = (event: Event) => {
      setIsDark((event as CustomEvent<"dark" | "light">).detail === "dark");
    };
    const handleRightOpenChange = (event: Event) => {
      if (!showTimelineRail) return;
      const next = Boolean((event as CustomEvent<boolean>).detail);
      setTimelineOpen(next);
    };
    window.addEventListener("hub:theme-change", handleThemeChange);
    window.addEventListener("hub:right-open-change", handleRightOpenChange);
    return () => {
      window.removeEventListener("hub:theme-change", handleThemeChange);
      window.removeEventListener("hub:right-open-change", handleRightOpenChange);
    };
  }, [showTimelineRail]);

  useEffect(() => {
    const openContextInAi = (event: Event) => {
      if (!showTimelineRail) return;
      const detail = normalizeHubAiContext((event as CustomEvent<unknown>).detail);
      if (!detail) return;
      setAiContext(detail);
      setContextTargetId(detail?.targetId ?? "");
      setRightView("ai");
      setTimelineOpen(true);
      window.localStorage.setItem("hub.right-view", "ai");
      window.localStorage.setItem("hub.right-open", "true");
    };
    window.addEventListener(HUB_AI_CONTEXT_EVENT, openContextInAi);
    return () => window.removeEventListener(HUB_AI_CONTEXT_EVENT, openContextInAi);
  }, [showTimelineRail]);

  useEffect(() => {
    const openContextInHubpedia = (event: Event) => {
      if (!showTimelineRail) return;
      const detail = (event as CustomEvent<HubpediaContextDetail>).detail;
      const content = detail?.content?.trim();
      if (!content) return;
      setHubpediaContext(content.slice(0, 2000));
      setHubpediaContextSource({ targetId: detail.targetId, targetType: detail.targetType });
      setContextTargetId(detail?.targetId ?? "");
      setRightView("hubpedia");
      setTimelineOpen(true);
      window.localStorage.setItem("hub.right-view", "hubpedia");
      window.localStorage.setItem("hub.right-open", "true");
    };
    window.addEventListener(HUBPEDIA_CONTEXT_EVENT, openContextInHubpedia);
    return () => window.removeEventListener(HUBPEDIA_CONTEXT_EVENT, openContextInHubpedia);
  }, [showTimelineRail]);

  useEffect(() => {
    const posts = document.querySelectorAll<HTMLElement>("[data-post-context-id]");
    posts.forEach((post) => post.removeAttribute("data-context-selected"));
    if (!timelineOpen || (rightView !== "ai" && rightView !== "hubpedia") || !contextTargetId) return;
    const selected = [...posts].find((post) => post.dataset.postContextId === contextTargetId);
    selected?.setAttribute("data-context-selected", rightView);
    return () => selected?.removeAttribute("data-context-selected");
  }, [contextTargetId, rightView, timelineOpen]);

  const toggleTheme = () => {
    setIsDark((current) => {
      const next = !current;
      document.documentElement.dataset.theme = next ? "dark" : "light";
      window.localStorage.setItem("hub.theme", next ? "dark" : "light");
      return next;
    });
  };

  // ready になるまでインラインスタイルを設定しない。
  // これにより初回レンダー時は html 要素の CSS 変数（インラインスクリプトがセット）が
  // そのまま継承され、デフォルト幅へのフラッシュが発生しない。
  const shellStyle: CSSProperties = ready ? {
    ["--hub-left-open-width" as string]: `${leftWidth}px`,
    ["--left-width" as string]: `${surface === "app" ? 0 : (sidebarOpen ? leftWidth : LEFT_COLLAPSED)}px`,
    ["--right-width" as string]: `${
      surface === "app" ? 0 : (showTimelineRail ? (timelineOpen ? rightWidth : RIGHT_COLLAPSED) : 0)
    }px`
  } : {};

  const toggleSidebar = () => {
    setSidebarOpen((current) => !current);
  };

  const goHomeOrToggleSidebar = () => {
    if (isAppSurface()) {
      setPageLeftColumnOpen(false);
      setSidebarOpen((current) => !current);
      return;
    }
    toggleSidebar();
  };

  const togglePageLeftColumn = () => {
    if (compactLeftDrawer) {
      setSidebarOpen(false);
      setTimelineOpen(false);
      setPageLeftColumnOpen((current) => !current);
      return;
    }

    setPageLeftColumnOpen(false);
    setPageLeftColumnCollapsed((current) => {
      const next = !current;
      window.localStorage.setItem("hub.page-left-column-collapsed", String(next));
      return next;
    });
  };

  const toggleTimeline = () => {
    const next = !timelineOpen;
    setTimelineOpen(next);
    window.localStorage.setItem("hub.right-open", String(next));
  };

  useEffect(() => {
    if (!timelineOpen) return;
    const findScroller = () => document.querySelector<HTMLElement>(
      "#hub-right-rail .shell__right-body :is(.timeline-rail__list,.catalog-right-rail__list,.notifications-right-rail__list,.music-right-rail__library,.ai-workbench,.messages-right-rail__conversations)"
    );
    const frame = window.requestAnimationFrame(() => {
      const scroller = findScroller();
      if (scroller) scroller.scrollTop = rightScrollPositions.current[rightView] ?? 0;
    });
    return () => {
      window.cancelAnimationFrame(frame);
      const scroller = findScroller();
      if (scroller) rightScrollPositions.current[rightView] = scroller.scrollTop;
    };
  }, [rightView, timelineOpen]);

  const selectRightView = (view: RightView) => {
    setRightView(view);
    window.localStorage.setItem("hub.right-view", view);
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const showFeedRail = () => {
    setRightView("feed");
    window.localStorage.setItem("hub.right-view", "feed");
  };

  const openMusicRail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    preloadRightView("music");
    setRightView("music");
    window.localStorage.setItem("hub.right-view", "music");
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const openMessagesRail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    preloadRightView("messages");
    selectRightView("messages");
  };

  const openFeedRail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setRightView("feed");
    window.localStorage.setItem("hub.right-view", "feed");
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const openSearchRail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setRightView("search");
    window.localStorage.setItem("hub.right-view", "search");
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const openHubpediaRail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const selection = window.getSelection()?.toString().trim() ?? "";
    const candidates = [...document.querySelectorAll<HTMLElement>("[data-hubpedia-context]")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.bottom > 0 && rect.top < window.innerHeight;
      })
      .sort((left, right) => {
        const center = window.innerHeight / 2;
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return Math.abs((leftRect.top + leftRect.bottom) / 2 - center) - Math.abs((rightRect.top + rightRect.bottom) / 2 - center);
      });
    const focusedText = candidates[0]?.dataset.hubpediaContext?.trim() ?? "";
    const pageText = document.querySelector<HTMLElement>(".main-content")?.innerText.trim() ?? "";
    setHubpediaContext((selection || focusedText || pageText).slice(0, 2000));
    setRightView("hubpedia");
    window.localStorage.setItem("hub.right-view", "hubpedia");
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const openNotificationsRail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    preloadRightView("notifications");
    setRightView("notifications");
    window.localStorage.setItem("hub.right-view", "notifications");
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const openCatalogRail = (view: "community") => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    preloadRightView(view);
    setRightView(view);
    window.localStorage.setItem("hub.right-view", view);
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const openAiRail = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    preloadRightView("ai");
    setRightView("ai");
    window.localStorage.setItem("hub.right-view", "ai");
    setTimelineOpen(true);
    window.localStorage.setItem("hub.right-open", "true");
  };

  const resizeRightBy = (delta: number) => {
    applyRailWidths(leftWidthRef.current, rightWidthRef.current + delta, { persist: true });
  };

  const startDrag = (side: "left" | "right") => (event: ReactPointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const initial = side === "left" ? leftWidth : rightWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const next =
        side === "left"
          ? Math.min(LEFT_MAX, Math.max(LEFT_MIN, initial + delta))
          : Math.min(RIGHT_MAX, Math.max(RIGHT_MIN, initial - delta));

      if (side === "left") {
        applyRailWidths(next, rightWidthRef.current, { persist: true });
      } else {
        applyRailWidths(leftWidthRef.current, next, { persist: true });
      }
    };

    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const pageLeftColumnExpanded = compactLeftDrawer
    ? pageLeftColumnOpen
    : !pageLeftColumnCollapsed;
  const shellClassName = [
    "shell",
    showTimelineRail ? "shell--with-rail" : "",
    wideContent ? "shell--wide-content" : "",
    shoppingContent ? "shell--shopping" : "",
    sidebarOpen ? "" : "shell--left-collapsed",
    showTimelineRail && !timelineOpen ? "shell--right-collapsed" : "",
    pageLeftColumnCollapsed ? "shell--page-left-collapsed" : "",
  ].filter(Boolean).join(" ");
  const rightViewMeta = RIGHT_VIEW_META[rightView];

  return (
    <div data-surface={surface} className={`${shellClassName}${pageLeftColumnOpen ? " shell--page-left-open" : ""}`} style={shellStyle} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
      <div
        ref={leftRailRef}
        className="shell__left"
        data-shell-column="left"
        id="hub-left-rail"
        inert={surface === "app" && !sidebarOpen ? true : undefined}
        aria-hidden={surface === "app" && !sidebarOpen ? true : undefined}
      >
        {isValidElement(left)
          ? cloneElement(left as ReactElement<{ isOpen: boolean; onToggle: () => void; onNavigate: () => void; isDark: boolean; onToggleTheme: () => void }>, {
              isOpen: sidebarOpen,
              onToggle: toggleSidebar,
              onNavigate: () => setSidebarOpen(false),
              isDark,
              onToggleTheme: toggleTheme
            })
          : left}
      </div>
      <button
        ref={leftToggleRef}
        type="button"
        className="shell__rail-toggle shell__rail-toggle--left"
        onClick={goHomeOrToggleSidebar}
        aria-controls="hub-left-rail"
        aria-expanded={sidebarOpen}
        aria-label={sidebarOpen ? "左列を折りたたむ" : "左列を開く"}
        title={sidebarOpen ? "左列を折りたたむ" : "左列を開く"}
      ><span className="shell__mobile-hub-label">Hub</span><span className="shell__desktop-rail-label" aria-hidden="true">{sidebarOpen ? <ChevronLeft /> : <ChevronRight />}</span></button>
      {hasPageLeftColumn ? (
        <button
          type="button"
          className="shell__page-left-toggle"
          onClick={togglePageLeftColumn}
          aria-controls={pageLeftColumnId}
          aria-expanded={pageLeftColumnExpanded}
          aria-label={pageLeftColumnExpanded ? "内側左列を折りたたむ" : "内側左列を開く"}
          title={pageLeftColumnExpanded ? "内側左列を折りたたむ" : "内側左列を開く"}
        >
          {pageLeftColumnExpanded ? <ChevronLeft aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
        </button>
      ) : null}
      {sidebarOpen ? <button type="button" className="shell__mobile-drawer-backdrop" aria-label="左列を閉じる" onClick={closeSidebarDrawer} /> : null}
      {pageLeftColumnOpen ? <button type="button" className="shell__page-left-backdrop" aria-label="ページの左列を閉じる" onClick={() => setPageLeftColumnOpen(false)} /> : null}
      <main id="hub-main" tabIndex={-1} className={forumContent ? "main-content main-content--bbs" : "main-content"} data-shell-column="middle">{children}</main>
      {showTimelineRail ? (
        <>
          {timelineOpen ? (
            <button
              type="button"
              className="shell__right-drawer-backdrop"
              aria-label="右列を閉じる"
              onClick={closeTimelineDrawer}
            />
          ) : null}
          <div className="shell__right-resizer" onPointerDown={timelineOpen ? startDrag("right") : undefined} />
          <div
            ref={rightRailRef}
            className="shell__right"
            data-shell-column="right"
            id="hub-right-rail"
            inert={!timelineOpen ? true : undefined}
            aria-hidden={!timelineOpen ? true : undefined}
          >
            <div
              className="shell__right-resize-handle"
              onPointerDown={timelineOpen ? startDrag("right") : undefined}
              onDoubleClick={() => resizeRightBy(RIGHT_DEFAULT - rightWidth)}
              onKeyDown={(event) => {
                if (!timelineOpen) return;
                if (event.key === "ArrowLeft") { event.preventDefault(); resizeRightBy(16); }
                if (event.key === "ArrowRight") { event.preventDefault(); resizeRightBy(-16); }
                if (event.key === "Home") { event.preventDefault(); resizeRightBy(RIGHT_DEFAULT - rightWidth); }
              }}
              role="separator"
              aria-label="右列の幅を変更"
              aria-orientation="vertical"
              aria-valuemin={RIGHT_MIN}
              aria-valuemax={RIGHT_MAX}
              aria-valuenow={rightWidth}
              aria-hidden={compactRightDrawer ? true : undefined}
              tabIndex={timelineOpen && !compactRightDrawer ? 0 : -1}
            />
            {timelineOpen ? (
              <header className="shell__right-header" data-shell-column-header="right">
                <span className="shell__right-header-icon" aria-hidden="true">
                  <NavIcon href={rightViewMeta.href} />
                </span>
                <h2>{rightViewMeta.label}</h2>
                <span className="shell__right-header-balance" aria-hidden="true" />
              </header>
            ) : null}
            <div className="shell__right-body" data-right-view={rightView}>
            {aiMounted ? <div className="shell__ai-workspace" hidden={rightView !== "ai" || !timelineOpen}>
              <Suspense fallback={<RightRailLoading label="AI" />}><AiRightRail context={aiContext} /></Suspense>
            </div> : null}
            {messagesMounted ? <div hidden={rightView !== "messages" || !timelineOpen}>
              <Suspense fallback={<RightRailLoading label="メッセージ" />}><MessagesRightRail expectedProfileId={rightProfileId} /></Suspense>
            </div> : null}
            {rightView === "messages"
              ? null
              : rightView === "music"
              ? timelineOpen
                ? <Suspense fallback={<RightRailLoading label="音楽" />}><MusicRightRail /></Suspense>
                : null
              : rightView === "ai"
              ? null
              : rightView === "notifications"
              ? timelineOpen
                ? <Suspense fallback={<div className="notifications-right-rail__status">通知を読み込み中…</div>}>
                    <NotificationsRightRail onShowFeed={showFeedRail} />
                  </Suspense>
                : null
              : rightView === "community"
              ? timelineOpen ? <Suspense fallback={<RightRailLoading label="コミュニティ" />}><CommunityRightRail onShowFeed={showFeedRail} /></Suspense> : null
              : right
              ? isValidElement(right)
                ? cloneElement(right as ReactElement<{ isOpen: boolean; onToggle: () => void; requestedMode: "timeline" | "posts" | "hubpedia"; standaloneMode: boolean; contextText?: string; contextSource?: Pick<HubpediaContextDetail, "targetId" | "targetType"> | null }>, {
                    isOpen: timelineOpen,
                    onToggle: toggleTimeline,
                    requestedMode: rightView === "search" ? "posts" : rightView === "hubpedia" ? "hubpedia" : "timeline",
                    standaloneMode: true,
                    contextText: rightView === "hubpedia" ? hubpediaContext : "",
                    contextSource: rightView === "hubpedia" ? hubpediaContextSource : null
                  })
                : right
              : null}
            </div>
          </div>
          <button
            ref={rightToggleRef}
            type="button"
            className="shell__rail-toggle shell__rail-toggle--right"
            onClick={toggleTimeline}
            aria-controls="hub-right-rail"
            aria-expanded={timelineOpen}
            aria-label={timelineOpen ? "右列を折りたたむ" : "右列を開く"}
            title={timelineOpen ? "右列を折りたたむ" : "右列を開く"}
          >{timelineOpen ? <ChevronRight aria-hidden="true" /> : <ChevronLeft aria-hidden="true" />}</button>
          <div
            ref={rightSwitcherRef}
            className="shell__rail-switcher"
            role="toolbar"
            aria-orientation="vertical"
            aria-label="右列の表示を切り替え"
          >
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--feed"
              onClick={openFeedRail}
              aria-label="右列でフィードを開く"
              aria-pressed={timelineOpen && rightView === "feed"}
              title="フィード"
            ><span aria-hidden="true"><NavIcon href="/feed" /></span></button>
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--messages"
              onClick={openMessagesRail}
              onPointerEnter={() => preloadRightView("messages")}
              onFocus={() => preloadRightView("messages")}
              aria-label="右列でメッセージを開く"
              aria-pressed={timelineOpen && rightView === "messages"}
              title="メッセージ"
            ><span aria-hidden="true"><NavIcon href="/messages" /></span></button>
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--search"
              onClick={openSearchRail}
              aria-label="右列で検索を開く"
              aria-pressed={timelineOpen && rightView === "search"}
              title="検索"
            ><span aria-hidden="true"><NavIcon href="/search" /></span></button>
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--notifications"
              onClick={openNotificationsRail}
              onPointerEnter={() => preloadRightView("notifications")}
              onFocus={() => preloadRightView("notifications")}
              aria-label="右列で通知を開く"
              aria-pressed={timelineOpen && rightView === "notifications"}
              title="通知"
            ><span aria-hidden="true"><NavIcon href="/notifications" /></span></button>
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--ai"
              onClick={openAiRail}
              onPointerEnter={() => preloadRightView("ai")}
              onFocus={() => preloadRightView("ai")}
              aria-label="右列でAIを開く"
              aria-pressed={timelineOpen && rightView === "ai"}
              title="AI"
            ><span aria-hidden="true"><NavIcon href="/ai" /></span></button>
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--hubpedia"
              onClick={openHubpediaRail}
              aria-label="右列でHubpediaを開く"
              aria-pressed={timelineOpen && rightView === "hubpedia"}
              title="Hubpedia"
            ><span aria-hidden="true"><NavIcon href="/hubpedia" /></span></button>
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--community"
              onClick={openCatalogRail("community")}
              onPointerEnter={() => preloadRightView("community")}
              onFocus={() => preloadRightView("community")}
              aria-label="右列でコミュニティを開く"
              aria-pressed={timelineOpen && rightView === "community"}
              title="コミュニティ"
            ><span aria-hidden="true"><NavIcon href="/community" /></span></button>
            <button
              type="button"
              className="shell__rail-shortcut shell__rail-shortcut--music"
              onClick={openMusicRail}
              onPointerEnter={() => preloadRightView("music")}
              onFocus={() => preloadRightView("music")}
              aria-label="右列で音楽を開く"
              aria-pressed={timelineOpen && rightView === "music"}
              title="音楽"
            ><span aria-hidden="true"><NavIcon href="/music" /></span></button>
          </div>
        </>
      ) : null}
    </div>
  );
}
