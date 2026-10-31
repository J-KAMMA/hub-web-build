"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { hubSurfacePath } from "@/lib/hub-surface-path";
import { lazy, Suspense, useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useHubUiSurface } from "@/lib/hub-surface-context";
import { useTranslationPreference } from "@/components/translation-preference-provider";
import { useAsideWorkspace } from "./v2-aside-workspace-context";
import { HUB_AI_CONTEXT_EVENT, normalizeHubAiContext, type HubAiContext } from "@/lib/ai-context";

import { V2Button } from "@/components/v2/v2-button";
import { V2_STRIP_SHAPES, V2Shapes } from "@/components/v2/v2-icons";
import { V2Skeleton } from "@/components/v2/v2-skeleton";
import { V2ColumnHead } from "@/components/v2/v2-columns";
import type { MessageConversation, Notification as DomainNotification, Profile } from "@/lib/domain";
import type { AppShellTimelinePost } from "@/lib/server/app-shell-data";
import { groupNotifications, groupedNotificationText, notificationLabel, type NotificationGroup } from "@/lib/v2-notifications";
import { Avatar } from "@/components/v2/ui/avatar";
import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";
import { AsideMusic } from "./v2-aside-music";
import { AsideDiscover } from "./v2-aside-discover";
import { AsideWallet } from "./v2-aside-wallet";

const AiRightRail = lazy(() => import("@/components/ai-right-rail").then((module) => ({ default: module.AiRightRail })));

/*
 * 右列。**本文を見ながら別のものを見るための場所**（旦那様、2026-09-02）。
 *
 * その役目から決まることが3つある。
 *   1. 切り替えられること。「別のもの」は一つではない
 *   2. 本文の幅を奪わないこと。奪うなら本文を見ながらにならない
 *   3. 見ていた場所を覚えること。切り替えて戻るたびに頭へ飛ぶなら、
 *      「見ながら」が成立しない（既存もビューごとにスクロール位置を持っていた）
 *
 * AIは既存Hubと同じ部品を使い、本文の横で会話・作業を行う。
 * 一度開いたAIは表示切替でも保持し、下書きや承認待ちを捨てない。
 */

/*
 * 帯の記号。既存のアイコンに合わせて fill: none / stroke: currentColor /
 * 太さ1.7 / 端は丸。図形はデスクトップの右列の帯と同じ（v2-icons.tsx の V2_STRIP_SHAPES、照合は v2-icons-desktop.test.tsx）。
 * 名前は消さず、読み上げと title に残す。
 * 記号だけにすると、初めての人には何の列か分からない。
 */
const MARKS: Record<ViewId, ReactNode> = Object.fromEntries(
  (Object.keys(V2_STRIP_SHAPES) as ViewId[]).map((id) => [id, <svg key={id} viewBox="0 0 24 24" aria-hidden="true"><V2Shapes shapes={V2_STRIP_SHAPES[id]} /></svg>]),
) as Record<ViewId, ReactNode>;

const VIEW_KEY = "hub.v2.aside-view";
/* 既存AppShellの hub.right-open とは別。v2 は既定で閉じ、"true" のときだけ開く（旦那様 2026-10-10）。 */
const OPEN_KEY = "hub.v2.aside-open";
/* 幅。既存の右列と同じ 280〜520px、既定 320px。左端の取っ手で変え、矢印で±16px、Home で既定へ、二度押しで既定へ。 */
const WIDTH_KEY = "hub.v2.aside-width";
const WIDTH_MIN = 280;
const WIDTH_MAX = 520;
const WIDTH_DEFAULT = 350;
const clampWidth = (value: number) => Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, Math.round(value)));

/*
 * 右列の各表示の中での戻る・進む（2026-10-18 所有者: 右列の上は、その表示の操作に。Hub Desktop と同じ）。
 * 一覧の行を押すと右列の中に詳細を出し（中央へは「中央で開く」で移る）、戻るで一覧へ、進むで詳細へ。
 * 表示ごとに別々に覚える。index が -1 のときは一覧。修飾キーつきのクリックは今までどおりリンクとして開く。
 */
const DETAIL_VIEWS: readonly string[] = ["search", "notifications", "messages", "community", "music"];
type AsideDetail = { title: string; body: string; href: string };
type AsideTrail = { entries: AsideDetail[]; index: number };

/*
 * 面ごとの既定ビュー（S6, 2026-10-30）。音楽の再生部は音楽の面だけが既定にする。
 * 他の面は、その面に関わる表示を既定にする。本人が選んだ表示（localStorage）が常に優先。
 */
export function defaultAsideView(pathname: string | null | undefined): ViewId {
  const path = (pathname ?? "").split("?")[0];
  const under = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  if (under("/v2/music")) return "music";
  if (under("/v2/community") || under("/v2/boards") || under("/v2/bbs") || under("/v2/threads")) return "community";
  if (under("/v2/messages")) return "messages";
  if (under("/v2/market") || under("/v2/wallet")) return "wallet";
  return "search";
}

type ViewId = "search" | "notifications" | "messages" | "community" | "music" | "wallet" | "ai";
const VIEW_IDS: ViewId[] = ["search", "notifications", "messages", "community", "music", "wallet", "ai"];

type Notification = DomainNotification;

type SearchHit = {
  title?: string;
  href?: string;
  description?: string;
};

export type V2AsideProps = {
  /** 互換のため受け取るが使わない。右列は投稿フィードを持たない。 */
  posts?: AppShellTimelinePost[];
  japanese: boolean;
  signedIn: boolean;
  title: string;
  viewerId?: string;
  initialView?: ViewId;
};

export function V2Aside(props: V2AsideProps) {
  const workspace = useAsideWorkspace();
  const host = useRef<HTMLDivElement>(null);
  const surface = useHubUiSurface();
  const translation = useTranslationPreference();
  const registration = useRef({ ...props, surface, translation });
  registration.current = { ...props, surface, translation };
  useLayoutEffect(() => {
    if (!workspace?.ready || !host.current) return;
    return workspace.mount(host.current, registration.current);
  }, [workspace?.ready, workspace?.mount]);
  useLayoutEffect(() => {
    if (workspace?.ready && host.current) workspace.update(host.current, registration.current);
  }, [workspace?.ready, workspace?.update, props.posts, props.japanese, props.signedIn, props.title, props.viewerId, props.initialView, surface, translation]);
  if (!workspace) return <V2AsideView {...props} />;
  return <div ref={host} className="v2__aside-slot">
    {!workspace.ready ? <>
      <p className="v2-sr" role="status">{props.japanese ? "作業を準備しています…" : "Preparing workspace…"}</p>
      <div className="v2__aside-strip" data-pending="true" />
    </> : null}
  </div>;
}

export function V2AsideView({
  japanese,
  signedIn,
  title,
  viewerId = "",
  initialView,
  connected = true,
  attached,
}: {
  posts?: AppShellTimelinePost[];
  japanese: boolean;
  signedIn: boolean;
  title: string;
  /* 会話の相手を選ぶのに要る。無ければ参加者の先頭を出す。 */
  viewerId?: string;
  /*
   * 面ごとの既定ビュー。本人が一度でも右列を切り替えると、
   * その選択（localStorage）がここより優先される。
   */
  initialView?: ViewId;
  connected?: boolean;
  attached?: () => boolean;
}) {
  const pathname = usePathname();
  const startView = initialView ?? defaultAsideView(pathname);
  const [view, setView] = useState<ViewId>(startView);
  const [open, setOpen] = useState(false);
  /* 本人が開閉を選んだか（null=未選択）。未選択なら ≥1280 の1列型の画面では既定で開く。 */
  const savedOpen = useRef<boolean | null>(null);
  const [aiMounted, setAiMounted] = useState(false);
  const [searchMounted, setSearchMounted] = useState(startView === "search");
  const [aiContextMemory, setAiContextMemory] = useState<{ scope: string; context: HubAiContext | null }>({ scope: "", context: null });
  const panelRef = useRef<HTMLDivElement>(null);
  const revealPanel = useRef(false);
  const panelId = useId();
  const [width, setWidth] = useState(WIDTH_DEFAULT);
  const drag = useRef<{ startX: number; startWidth: number } | null>(null);

  const applyWidth = (next: number) => {
    const clamped = clampWidth(next);
    setWidth(clamped);
    try {
      window.localStorage.setItem(WIDTH_KEY, String(clamped));
    } catch {
      /* 覚えられなくても、その場では効く。 */
    }
  };

  const onResizePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    /* 取っ手は列の左端。左へ引くほど広がる。 */
    applyWidth(drag.current.startWidth + (drag.current.startX - event.clientX));
  };
  const onResizePointerUp = () => { drag.current = null; };
  const onResizeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") { event.preventDefault(); applyWidth(width + 16); }
    else if (event.key === "ArrowRight") { event.preventDefault(); applyWidth(width - 16); }
    else if (event.key === "Home") { event.preventDefault(); applyWidth(WIDTH_DEFAULT); }
  };
  /*
   * 検索の入力と結果は親が持つ。子に置くと、投稿へ切り替えて戻った瞬間に
   * componentが外れて入力も結果も消える。**見ながら**が成立しない。
   */
  const [accountEpoch, setAccountEpoch] = useState(0);
  const epoch = useRef(0);
  const searchScope = `${signedIn}:${viewerId}:${accountEpoch}`;
  const currentSearchScope = useRef(searchScope);
  currentSearchScope.current = searchScope;
  const aiContext = aiContextMemory.scope === searchScope ? aiContextMemory.context : null;
  type SearchMemory = { scope: string; query: string; hits: SearchHit[] | null; state: "idle" | "loading" | "failed" };
  const emptySearch = (): SearchMemory => ({ scope: searchScope, query: "", hits: null, state: "idle" });
  const [search, setSearch] = useState<SearchMemory>(emptySearch);
  const memory = search.scope === searchScope ? search : emptySearch();
  const updateSearch = (patch: Partial<Omit<SearchMemory, "scope">>) => {
    if (currentSearchScope.current !== searchScope) return;
    setSearch(previous => ({ ...(previous.scope === searchScope ? previous : emptySearch()), ...patch }));
  };
  useEffect(() => {
    setSearch(previous => previous.scope === searchScope ? previous : emptySearch());
    setAiContextMemory(previous => previous.scope === searchScope ? previous : { scope: searchScope, context: null });
  }, [searchScope]);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const acceptAiShares = useCallback(() => connected && view === "ai" && open && attached?.() !== false, [connected, view, open, attached]);
  /* ビューごとのスクロール位置。切り替えて戻ったとき同じ場所に居られるように。 */
  const positions = useRef<Record<string, number>>({});
  const [trails, setTrails] = useState<{ scope: string; byView: Partial<Record<string, AsideTrail>> }>({ scope: searchScope, byView: {} });
  const trail = trails.scope === searchScope ? trails.byView[view] : undefined;
  const detail = trail && trail.index >= 0 ? trail.entries[trail.index] ?? null : null;
  const canBack = Boolean(trail && trail.index >= 0);
  const canForward = Boolean(trail && trail.index < trail.entries.length - 1);
  const stepTrail = (delta: number) => setTrails((previous) => {
    const current = previous.scope === searchScope ? previous.byView[view] : undefined;
    if (!current) return previous;
    const index = Math.max(-1, Math.min(current.entries.length - 1, current.index + delta));
    return { scope: searchScope, byView: { ...previous.byView, [view]: { ...current, index } } };
  });
  const openDetail = (entry: AsideDetail) => setTrails((previous) => {
    const byView = previous.scope === searchScope ? previous.byView : {};
    const current = byView[view] ?? { entries: [], index: -1 };
    const entries = [...current.entries.slice(0, current.index + 1), entry];
    return { scope: searchScope, byView: { ...byView, [view]: { entries, index: entries.length - 1 } } };
  });
  const onBodyClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!DETAIL_VIEWS.includes(view) || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a.v2-aside__item, a.v2-aside__item-text");
    const href = link?.getAttribute("href");
    if (!link || !href || !event.currentTarget.contains(link)) return;
    event.preventDefault();
    event.stopPropagation();
    openDetail({
      title: (link.querySelector(".v2-aside__item-name")?.textContent ?? link.textContent ?? "").trim(),
      body: (link.querySelector(".v2-aside__item-body")?.textContent ?? "").trim(),
      href,
    });
  };

  useEffect(() => {
    if (view === "ai" && open) setAiMounted(true);
    if (view === "search") setSearchMounted(true);
    if (open && revealPanel.current) {
      revealPanel.current = false;
      const panel = panelRef.current;
      (panel?.nextElementSibling ?? panel)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [view, open, aiContext]);

  useEffect(() => {
    const invalidate = () => {
      epoch.current++;
      currentSearchScope.current = `${signedIn}:${viewerId}:${epoch.current}`;
      setAccountEpoch(epoch.current);
      setSearch({ scope: currentSearchScope.current, query: "", hits: null, state: "idle" });
    };
    window.addEventListener("hub-account-changed", invalidate);
    return () => window.removeEventListener("hub-account-changed", invalidate);
  }, [signedIn, viewerId]);

  useEffect(() => {
    const receiveContext = (event: Event) => {
      if (!connected || attached?.() === false || currentSearchScope.current !== searchScope) return;
      const context = normalizeHubAiContext((event as CustomEvent<unknown>).detail);
      if (!context) return;
      setAiContextMemory({ scope: searchScope, context });
      revealPanel.current = true;
      setView("ai");
      setOpen(true);
      try {
        localStorage.setItem(VIEW_KEY, "ai");
        localStorage.setItem(OPEN_KEY, "true");
      } catch { /* A blocked preference store must not block this action. */ }
    };
    window.addEventListener(HUB_AI_CONTEXT_EVENT, receiveContext);
    return () => window.removeEventListener(HUB_AI_CONTEXT_EVENT, receiveContext);
  }, [connected, attached, searchScope]);

  useLayoutEffect(() => {
    try {
      const saved = window.localStorage.getItem(VIEW_KEY);
      if (VIEW_IDS.some((id) => id === saved)) setView(saved as ViewId);
      const savedWidth = Number(window.localStorage.getItem(WIDTH_KEY));
      if (Number.isFinite(savedWidth) && savedWidth > 0) setWidth(clampWidth(savedWidth));
      const storedOpen = window.localStorage.getItem(OPEN_KEY);
      savedOpen.current = storedOpen === null ? null : storedOpen === "true";
      if (savedOpen.current !== null) setOpen(savedOpen.current);
    } catch {
      /* 読めなくても既定のビューで動く。 */
    }
    const onOpenChange = (event: Event) => {
      setOpen(Boolean((event as CustomEvent<boolean>).detail));
    };
    window.addEventListener("hub:right-open-change", onOpenChange);
    return () => window.removeEventListener("hub:right-open-change", onOpenChange);
  }, []);

  const remember = (key: string, value: string) => {
    if (key === OPEN_KEY) savedOpen.current = value === "true";
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* 覚えられなくても、その場では動く。 */
    }
  };

  /* 表示内容を選ぶと開く。開いている表示をもう一度選ぶと閉じる（旦那様 2026-10-15。デスクトップの右端の帯と同じ）。 */
  const switchTo = (next: ViewId) => {
    if (bodyRef.current) positions.current[view] = bodyRef.current.scrollTop;
    if (open && next === view) {
      changeOpen(false);
      return;
    }

    revealPanel.current = true;
    setView(next);
    setOpen(true);
    remember(VIEW_KEY, next);
    remember(OPEN_KEY, "true");
  };

  const changeOpen = (next: boolean) => {
    if (next) revealPanel.current = true;
    setOpen(next);
    remember(OPEN_KEY, String(next));
  };

  /* 既定の開閉: 未選択なら、≥1280 かつ本文が1列型（タイムライン型）の画面でだけ開く。広い型（音楽・動画）では畳んだまま。 */
  useLayoutEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(min-width: 1280px)");
    const apply = () => {
      if (savedOpen.current !== null) return;
      const narrowMeasure = document.querySelector<HTMLElement>(".v2__frame")?.dataset.measure === "narrow";
      setOpen(media.matches && narrowMeasure);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [pathname]);

  useEffect(() => {
    const body = bodyRef.current;
    if (body) body.scrollTop = positions.current[view] ?? 0;
  }, [view]);

  const views: { id: ViewId; label: string }[] = japanese
    ? [
      { id: "search", label: "探す" },
      { id: "messages", label: "メッセージ" },
      { id: "music", label: "音楽" },
      { id: "community", label: "コミュニティ" },
      { id: "notifications", label: "通知" },
      { id: "ai", label: "AI" },
      { id: "wallet", label: "ウォレット" },
    ]
    : [
      { id: "search", label: "Explore" },
      { id: "messages", label: "Messages" },
      { id: "music", label: "Music" },
      { id: "community", label: "Communities" },
      { id: "notifications", label: "Notifications" },
      { id: "ai", label: "AI" },
      { id: "wallet", label: "Wallet" },
    ];

  return (
    <>
        <div className="v2__aside" ref={panelRef} id={panelId} hidden={!open} style={{ width: `${width}px` }}>
          <div
            className="v2-aside__resizer"
            role="separator"
            aria-orientation="vertical"
            aria-label={japanese ? "右の列の幅" : "Side column width"}
            aria-valuemin={WIDTH_MIN}
            aria-valuemax={WIDTH_MAX}
            aria-valuenow={width}
            tabIndex={0}
            title={japanese ? "引いて幅を変える。二度押しで既定へ" : "Drag to resize. Double-click to reset"}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerUp}
            onPointerCancel={onResizePointerUp}
            onDoubleClick={() => applyWidth(WIDTH_DEFAULT)}
            onKeyDown={onResizeKey}
          />
          {/* 頭はいま見ているものの名前（旦那様 2026-09-03「右列が使いづらそう」。「並べて見る」は何の列か分からなかった）。 */}
          {/* 机上幅では、この見出し行（戻る・進む・表示名）が上端の帯の右列の真上へ上がる（desktop-parity.css）。 */}
          <V2ColumnHead
            className="v2-aside__head"
            lead={<div className="v2-aside__history" role="group" aria-label={japanese ? "右列の戻る・進む" : "Side column history"}>
              <button type="button" className="v2-aside__history-button" disabled={!canBack} onClick={() => stepTrail(-1)}
                aria-label={japanese ? "右列で戻る" : "Back in side column"} title={japanese ? "戻る" : "Back"}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7" /></svg>
              </button>
              <button type="button" className="v2-aside__history-button" disabled={!canForward} onClick={() => stepTrail(1)}
                aria-label={japanese ? "右列で進む" : "Forward in side column"} title={japanese ? "進む" : "Forward"}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
              </button>
            </div>}
            title={views.find((item) => item.id === view)?.label ?? title}
          />
          <div className={`v2-aside__body${view === "ai" ? " v2-aside__body--ai" : ""}`} ref={bodyRef} onClickCapture={onBodyClickCapture}>
            {detail ? <section className="v2-aside__detail" aria-label={detail.title || (japanese ? "詳細" : "Detail")}>
              <h2 className="v2-aside__detail-title">{detail.title}</h2>
              {detail.body ? <p className="v2-aside__detail-body">{detail.body}</p> : null}
              <Link className="v2-aside__detail-open" href={detail.href}>{japanese ? "中央で開く" : "Open in main column"}</Link>
            </section> : null}
            <div className="v2-aside__lists" hidden={Boolean(detail)}>
            {aiMounted ? <div className="v2-aside__ai" hidden={view !== "ai"}>
              <Suspense fallback={<p role="status">{japanese ? "AIを開いています…" : "Opening AI…"}</p>}>
                <AiRightRail context={aiContext} showHeading={false} isActive={acceptAiShares} scope={`${signedIn}:${viewerId}`} />
              </Suspense>
            </div> : null}
            {searchMounted || view === "search" ? <div hidden={view !== "search"}>
              <AsideSearch
                key={searchScope}
                japanese={japanese}
                query={memory.query}
                setQuery={value => updateSearch({ query: value })}
                hits={memory.hits}
                setHits={value => updateSearch({ hits: value })}
                state={memory.state}
                setState={value => updateSearch({ state: value })}
              />
              {!memory.query.trim() ? <AsideDiscover japanese={japanese} signedIn={signedIn} scope={searchScope} /> : null}
            </div> : null}
            {connected && view === "notifications" ? <AsideNotifications key={searchScope} japanese={japanese} signedIn={signedIn} /> : null}
            {connected && view === "messages" ? <AsideMessages key={searchScope} japanese={japanese} signedIn={signedIn} viewerId={viewerId} /> : null}
            {view === "community" ? <AsideCommunities japanese={japanese} /> : null}
            {view === "music" ? <AsideMusic japanese={japanese} /> : null}
            {view === "wallet" ? <AsideWallet japanese={japanese} /> : null}
            </div>
          </div>
        </div>

      {/* 表示内容の切り替えは右列の右端の縦の帯だけ（列の上に切り替えは置かない。旦那様 2026-10-15）。順序はデスクトップと同じ。 */}
      <div className="v2__aside-strip" role="toolbar" aria-label={japanese ? "右の列の表示" : "Side column view"} aria-orientation="vertical">
        <div className="v2-aside__toggle-row">
          <button type="button" className="v2-toggle" data-column="aside" data-state={open ? "open" : "closed"}
            aria-label={japanese ? (open ? "右列を閉じる" : "右列を開く") : (open ? "Close side column" : "Open side column")}
            aria-expanded={open} aria-controls={panelId}
            title={japanese ? (open ? "右列を閉じる" : "右列を開く") : (open ? "Close side column" : "Open side column")}
            onClick={() => changeOpen(!open)}>
            <svg viewBox="0 0 24 24" aria-hidden="true" className="v2-toggle__mark">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M15 4v16" />
            </svg>
            <span className="v2-sr">{japanese ? (open ? "右列を閉じる" : "右列を開く") : (open ? "Close side column" : "Open side column")}</span>
          </button>
        </div>
        {views.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === "ai" ? "v2-aside__pick v2-aside__pick--bottom" : "v2-aside__pick"}
            aria-pressed={open && item.id === view}
            onClick={() => switchTo(item.id)}
            title={item.label}
          >
            {MARKS[item.id]}
            <span className="v2-sr">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

/*
 * 検索。本文を離れずに調べられることが、この列を置く理由そのもの。
 * 失敗しても本文は落とさない（既存の検索も、音楽やVaultが落ちても
 * 全体は出し続けていた）。
 */
function AsideSearch({
  japanese,
  query,
  setQuery,
  hits,
  setHits,
  state,
  setState,
}: {
  japanese: boolean;
  query: string;
  setQuery: (value: string) => void;
  hits: SearchHit[] | null;
  setHits: (value: SearchHit[] | null) => void;
  state: "idle" | "loading" | "failed";
  setState: (value: "idle" | "loading" | "failed") => void;
}) {
  const generation = useRef(0);
  const reader = useRef<AbortController | null>(null);
  useEffect(() => () => { generation.current++; reader.current?.abort(); }, []);
  const edit = (value: string) => {
    generation.current++;
    reader.current?.abort();
    setQuery(value);
    setHits(null);
    setState("idle");
  };
  const run = useCallback(async (value: string) => {
    const request = ++generation.current;
    reader.current?.abort();
    const controller = new AbortController();
    reader.current = controller;
    const current = () => generation.current === request;
    const trimmed = value.trim();
    if (!trimmed) {
      setHits(null);
      setState("idle");
      return;
    }
    setState("loading");
    setHits(null);
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      /* 開発サーバーの初回は 46秒かかったことがある。10秒で切ると常に失敗になる。 */
      const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as {
        coreEntities?: { title?: string; href?: string }[];
        posts?: { id: string; displayName?: string; body?: string }[];
        profiles?: { handle: string; displayName?: string; bio?: string }[];
        threads?: { id: string; title?: string; excerpt?: string }[];
        hubpedia?: { slug: string; title?: string; summary?: string }[];
      };
      if (!current()) return;
      if (controller.signal.aborted) throw new Error("search_timeout");
      /*
       * 種別ごとに行き先を組み立てる。APIは種別ごとの配列を返し、
       * **投稿やプロフィールの行には href も title も入っていない**
       * （投稿は id・displayName・body、プロフィールは handle・displayName）。
       * 題らしきものを拾うだけだと、押せない結果が並ぶ。
       * coreEntities だけは title と href を持っているので、そこから先に取る。
       */
      const collected: SearchHit[] = [];
      for (const entity of payload.coreEntities ?? []) {
        if (entity.title && entity.href) {
          /* API は既存と共有で、道は既存の形（/hubpedia/…）。ここは v2 なので同じ画面の v2 へ寄せる（2026-09-07）。 */
          collected.push({ title: entity.title, href: hubSurfacePath("/v2", entity.href) });
        }
      }
      const seen = new Set(collected.map((hit) => hit.href));
      for (const post of payload.posts ?? []) {
        const href = `/v2/posts/${post.id}`;
        if (seen.has(href)) continue;
        collected.push({ title: post.displayName ?? href, href, description: post.body });
        seen.add(href);
      }
      for (const profile of payload.profiles ?? []) {
        const href = `/v2/profile/${profile.handle}`;
        if (seen.has(href)) continue;
        collected.push({ title: profile.displayName ?? profile.handle, href, description: profile.bio });
        seen.add(href);
      }
      for (const thread of payload.threads ?? []) {
        const href = `/v2/threads/${thread.id}`;
        if (seen.has(href)) continue;
        collected.push({ title: thread.title ?? href, href, description: thread.excerpt });
        seen.add(href);
      }
      for (const article of payload.hubpedia ?? []) {
        const href = `/v2/hubpedia/${article.slug}`;
        if (seen.has(href)) continue;
        collected.push({ title: article.title ?? article.slug, href, description: article.summary });
        seen.add(href);
      }
      setHits(collected.slice(0, 20));
      setState("idle");
    } catch {
      if (!current()) return;
      setHits(null);
      setState("failed");
    } finally {
      clearTimeout(timer);
      if (reader.current === controller) reader.current = null;
    }
  }, [setHits, setState]);

  return (
    <>
      <form
        className="v2-aside__search"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          void run(query);
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(event) => edit(event.target.value)}
          placeholder={japanese ? "Hubを検索" : "Search Hub"}
          aria-label={japanese ? "Hubを検索" : "Search Hub"}
        />
      </form>

      {state === "loading" ? (
        <p className="v2-note">{japanese ? "探しています…" : "Searching…"}</p>
      ) : null}

      {state === "failed" ? (
        <p className="v2-error" role="alert">
          {japanese ? "検索できませんでした。" : "Search failed."}
        </p>
      ) : null}

      {hits && !hits.length && state === "idle" ? (
        <p className="v2-note">{japanese ? "一致するものがありません。" : "Nothing matched."}</p>
      ) : null}

      {hits?.length ? (
        <ul className="v2-aside__list">
          {hits.map((hit, index) => (
            <li key={`${hit.href ?? hit.title}-${index}`}>
              {hit.href ? (
                <Link className="v2-aside__item" href={hit.href}>
                  <span className="v2-aside__item-name">{hit.title}</span>
                  {hit.description ? <span className="v2-aside__item-body">{hit.description}</span> : null}
                </Link>
              ) : (
                <p className="v2-aside__item">
                  <span className="v2-aside__item-name">{hit.title}</span>
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

function AsideNotifications({ japanese, signedIn }: { japanese: boolean; signedIn: boolean }) {
  const [items, setItems] = useState<Notification[] | null>(null);
  const [actors, setActors] = useState<Map<string, Profile>>(() => new Map());
  const [state, setState] = useState<"loading" | "idle" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!signedIn) {
      setState("idle");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/notifications", { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { notifications?: Notification[]; profiles?: Profile[] };
        if (cancelled) return;
        setItems(payload.notifications ?? []);
        setActors(new Map((payload.profiles ?? []).map((profile) => [profile.id, profile])));
        setState("idle");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn, attempt]);

  if (!signedIn) {
    return <p className="v2-note">{japanese ? "ログインすると通知が出ます。" : "Sign in to see notifications."}</p>;
  }
  if (state === "loading") return <V2Skeleton kind="rows" count={4} japanese={japanese} />;
  if (state === "failed") {
    return (
      <p className="v2-error" role="alert">
        {japanese ? "通知を読み込めませんでした。" : "Could not load notifications."}{" "}
        <button type="button" className="v2-card__link" onClick={() => setAttempt((value) => value + 1)}>{japanese ? "再試行" : "Retry"}</button>
      </p>
    );
  }
  if (!items?.length) return <p className="v2-note">{japanese ? "通知はありません。" : "No notifications."}</p>;

  /*
   * 通知の画面と同じまとめ方（同じ投稿へのいいね等は1行）。行は「誰が」（顔と名前、まとめた行は
   * 「ほか n人」）・「何を」（本文）・いつ。顔の右下に種類の記号。行き先は通知の画面。
   * （2026-10-18：以前は「リアクション／あなたの投稿にいいねしました」が人も時刻も無く並んでいた。）
   */
  return (
    <ul className="v2-aside__list">
      {groupNotifications(items).slice(0, 20).map((group) => (
        <li key={group.key}>
          <AsideNotificationRow group={group} actors={actors} japanese={japanese} />
        </li>
      ))}
    </ul>
  );
}

const ASIDE_NOTIFICATION_ICON: Partial<Record<Notification["type"], V2IconName>> = {
  social_reaction: "heart",
  social_reply: "reply",
  thread_reply: "reply",
  social_repost: "repeat",
  social_bookmark: "bookmark",
  followed: "user",
  message_received: "mail",
  system: "bell",
};

function AsideNotificationRow({ group, actors, japanese }: { group: NotificationGroup; actors: Map<string, Profile>; japanese: boolean }) {
  const item = group.latest;
  const people = group.actorIds.map((id) => actors.get(id)).filter((profile): profile is Profile => Boolean(profile));
  const first = people[0];
  const others = Math.max(0, group.actorIds.length - 1);
  const who = first ? `${first.displayName}${others ? (japanese ? ` ほか${others}人` : ` and ${others} more`) : ""}` : notificationLabel(item, japanese);
  const kind = item.context === "mention" ? "mention" : item.type;
  const icon = ASIDE_NOTIFICATION_ICON[item.type] ?? "bell";
  const sentence = groupedNotificationText(group, people.map((profile) => profile.displayName), japanese);
  const excerpt = group.items.find((entry) => entry.excerpt)?.excerpt;
  return (
    <Link
      className={group.isRead ? "v2-aside__item v2-aside__item--face" : "v2-aside__item v2-aside__item--face v2-aside__item--unread"}
      href="/v2/notifications"
      aria-label={`${group.isRead ? "" : japanese ? "未読 " : "Unread "}${sentence}`}
    >
      <span className="v2-aside__face">
        {first ? <Avatar name={first.displayName} src={first.avatarUrl} size={32} /> : <span className="v2-aside__face-icon"><V2Icon name="bell" /></span>}
        {first ? <span className={`v2-aside__kind v2-aside__kind--${kind}`}><V2Icon name={item.context === "mention" ? "reply" : icon} /></span> : null}
      </span>
      <span className="v2-aside__item-text">
        <span className="v2-aside__item-head">
          <span className="v2-aside__item-name">{who}</span>
          <span className="v2-aside__item-time"><V2RelativeTime value={item.createdAt} locale={japanese ? "ja" : "en"} /></span>
        </span>
        <span className="v2-aside__item-body">{item.text || sentence}</span>
        {excerpt ? <span className="v2-aside__item-quote">{excerpt}</span> : null}
      </span>
      {!group.isRead ? <span className="v2-unread" aria-hidden="true" /> : null}
    </Link>
  );
}

/*
 * 残りの4面は同じ形: 1つの API を読み、行の一覧にする。読み込み中・失敗と再試行・
 * 空の3状態は共通。AIは一覧ではなく上記の会話・作業画面を共用する。
 */
function useRemote<T>(url: string | null, pick: (payload: unknown) => T, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "failed">(url ? "loading" : "idle");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!url) { setState("idle"); return; }
    let cancelled = false;
    setState("loading");
    void (async () => {
      try {
        const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(String(response.status));
        const payload: unknown = await response.json();
        if (cancelled) return;
        setData(pick(payload));
        setState("idle");
      } catch {
        if (!cancelled) setState("failed");
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, attempt, ...deps]);
  return { data, state, retry: () => setAttempt((value) => value + 1) };
}

function RemoteState({ state, retry, japanese, empty, children }: { state: "loading" | "idle" | "failed"; retry: () => void; japanese: boolean; empty: boolean; children: ReactNode }) {
  if (state === "loading") return <V2Skeleton kind="rows" count={4} japanese={japanese} />;
  if (state === "failed") {
    return (
      <p className="v2-error" role="alert">
        {japanese ? "読み込めませんでした。" : "Could not load."}{" "}
        <button type="button" className="v2-card__link" onClick={retry}>{japanese ? "再試行" : "Retry"}</button>
      </p>
    );
  }
  if (empty) return <p className="v2-note">{japanese ? "まだありません。" : "Nothing yet."}</p>;
  return <>{children}</>;
}

function AsideMessages({ japanese, signedIn, viewerId }: { japanese: boolean; signedIn: boolean; viewerId: string }) {
  const { data, state, retry } = useRemote(
    signedIn ? "/api/messages/conversations" : null,
    (payload) => {
      const body = payload as { conversations?: MessageConversation[]; profiles?: Profile[] };
      const profiles = new Map((body.profiles ?? []).map((profile) => [profile.id, profile]));
      return (body.conversations ?? [])
        .slice()
        .sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt))
        .map((conversation) => {
          const partnerId = conversation.participantIds.find((id) => id !== viewerId) ?? conversation.participantIds[0];
          const partner = partnerId ? profiles.get(partnerId) : undefined;
          return {
            id: conversation.id,
            name: partner?.displayName ?? (japanese ? "会話" : "Conversation"),
            avatarUrl: partner?.avatarUrl,
            handle: partner?.handle,
            unread: conversation.unreadCountByProfileId[viewerId] ?? 0,
            at: conversation.lastMessageAt,
          };
        });
    },
    [viewerId],
  );
  if (!signedIn) return <p className="v2-note">{japanese ? "ログインするとメッセージが出ます。" : "Sign in to see messages."}</p>;
  return (
    <RemoteState state={state} retry={retry} japanese={japanese} empty={!data?.length}>
      <ul className="v2-aside__list">
        {(data ?? []).slice(0, 20).map((item) => (
          <li key={item.id}>
            <Link className={item.unread ? "v2-aside__item v2-aside__item--face v2-aside__item--unread" : "v2-aside__item v2-aside__item--face"} href={`/v2/messages?conversation=${encodeURIComponent(item.id)}`}>
              <span className="v2-aside__face"><Avatar name={item.name} src={item.avatarUrl} size={32} /></span>
              <span className="v2-aside__item-text">
                <span className="v2-aside__item-head">
                  <span className="v2-aside__item-name">{item.name}</span>
                  <span className="v2-aside__item-time"><V2RelativeTime value={item.at} locale={japanese ? "ja" : "en"} /></span>
                </span>
                <span className="v2-aside__item-body">{item.handle ? `@${item.handle}` : ""}</span>
              </span>
              {item.unread ? <span className="v2-aside__count" aria-label={japanese ? `未読 ${item.unread}件` : `${item.unread} unread`}>{item.unread > 99 ? "99+" : item.unread}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </RemoteState>
  );
}

function AsideCommunities({ japanese }: { japanese: boolean }) {
  const { data, state, retry } = useRemote(
    "/api/communities",
    (payload) => {
      const body = payload as { communities?: { id: string; slug: string; name: string; description?: string; category?: string; imageUrl?: string | null; memberCount?: number }[] };
      return body.communities ?? [];
    },
    [],
  );
  return (
    <RemoteState state={state} retry={retry} japanese={japanese} empty={!data?.length}>
      <ul className="v2-aside__list">
        {(data ?? []).slice(0, 20).map((community) => (
          <li key={community.id}>
            <Link className="v2-aside__item v2-aside__item--face" href={`/v2/community?community=${encodeURIComponent(community.slug)}`}>
              <span className="v2-aside__face"><Avatar name={community.name} src={community.imageUrl} size={32} shape="place" /></span>
              <span className="v2-aside__item-text">
                <span className="v2-aside__item-head">
                  <span className="v2-aside__item-name">{community.name}</span>
                  {Number.isSafeInteger(community.memberCount) ? <span className="v2-aside__item-time">{japanese ? `${community.memberCount!.toLocaleString("ja-JP")}人` : `${community.memberCount!.toLocaleString("en-US")} members`}</span> : null}
                </span>
                <span className="v2-aside__item-body">{community.description || community.category || ""}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </RemoteState>
  );
}
