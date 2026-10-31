"use client";

import React, {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Search } from "lucide-react";

import { BbsThreadDirectory } from "@/components/bbs-thread-directory";
import { LocalizedDateTime } from "@/components/localized-date-time";
import { TabMainSearchHeader } from "@/components/tab-main-search-header";
import type { ThreadSummary } from "@/lib/domain";
import type { ThreadTagSummary } from "@/lib/thread-tags";
import { getThreadType, THREAD_TYPE_LABELS } from "@/lib/thread-type";

type ThreadItem = ThreadSummary & {
  excerpt: string;
  searchText: string;
};

type ThreadView = "popular" | "latest" | "rising" | "unanswered" | "solved" | "quality";
const BBS_REQUEST_TIMEOUT_MS = 10_000;
const THREAD_VIEW_OPTIONS: readonly [ThreadView, string, string][] = [
  ["popular", "おすすめ", "Recommended"],
  ["rising", "最近活発", "Recently active"],
  ["latest", "新しい順", "Newest"],
  ["unanswered", "返信なし", "No replies"],
  ["solved", "解決済み", "Solved"],
  ["quality", "役立つ回答", "Helpful answers"],
];

class BbsRequestTimeoutError extends Error {
  constructor() {
    super("bbs_request_timeout");
    this.name = "TimeoutError";
  }
}

async function requestThreadPage(
  url: string,
  controller: AbortController,
): Promise<{ threads?: ThreadSummary[]; total?: number }> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<{
          threads?: ThreadSummary[];
          total?: number;
        }>;
      })(),
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort();
          reject(new BbsRequestTimeoutError());
        }, BBS_REQUEST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export function BbsContentBrowser({ tags, threads, initialView, initialQuery, initialTag = "", initialTotal, totalThreadCount, createPanel, english = false }: {
  tags: ThreadTagSummary[];
  threads: ThreadItem[];
  initialView: ThreadView;
  initialQuery: string;
  initialTag?: string;
  initialTotal?: number;
  totalThreadCount?: number;
  createPanel: ReactNode;
  english?: boolean;
}) {
  const [view, setView] = useState<ThreadView>(initialView);
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [activeTag, setActiveTag] = useState(initialTag);
  const [items, setItems] = useState(() => [...new Map(threads.map((thread) => [thread.id, thread])).values()]);
  const [total, setTotal] = useState(initialTotal ?? threads.length);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [loadMoreFailed, setLoadMoreFailed] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);
  const [debouncedRequestNonce, setDebouncedRequestNonce] = useState(0);
  const requestSequenceRef = useRef(0);
  const previousQueryRef = useRef(query);
  const activeRequestRef = useRef<{
    id: number;
    controller: AbortController;
  } | null>(null);

  const initialItemMap = useMemo(() => new Map(threads.map((thread) => [thread.id, thread])), [threads]);

  const normalizeApiItems = useCallback((apiThreads: ThreadSummary[]): ThreadItem[] => [...new Map(apiThreads.map((thread) => [thread.id, thread])).values()].map((thread) => {
    const initial = initialItemMap.get(thread.id);
    return {
      ...thread,
      excerpt: initial?.excerpt ?? "",
      searchText: initial?.searchText ?? (thread.tags?.join(" ") ?? ""),
    };
  }), [initialItemMap]);

  useEffect(() => {
    if (previousQueryRef.current === query) return;
    previousQueryRef.current = query;
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
    setLoading(true);
    setLoadError("");
    setLoadMoreFailed(false);
    const timer = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
      setDebouncedRequestNonce((value) => value + 1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    activeRequestRef.current?.controller.abort();
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller };
    const ownsRequest = () => activeRequestRef.current?.id === requestId;
    const params = new URLSearchParams({ view, limit: "50", offset: "0" });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (activeTag) params.set("tag", activeTag);
    setLoading(true);
    setLoadError("");
    setLoadMoreFailed(false);
    void requestThreadPage(`/api/bbs/threads?${params}`, controller)
      .then((payload) => {
        if (!ownsRequest()) return;
        setItems(normalizeApiItems(payload.threads ?? []));
        setTotal(Number(payload.total ?? payload.threads?.length ?? 0));
      })
      .catch((error: unknown) => {
        if (!ownsRequest()) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadError(
          error instanceof BbsRequestTimeoutError
            ? english
              ? "Threads are taking longer than expected to load."
              : "スレッドの読み込みに時間がかかっています。"
            : english
              ? "Could not load threads."
              : "スレッドを読み込めませんでした。",
        );
      })
      .finally(() => {
        if (!ownsRequest()) return;
        activeRequestRef.current = null;
        setLoading(false);
      });
    return () => {
      if (activeRequestRef.current?.id !== requestId) return;
      activeRequestRef.current = null;
      controller.abort();
    };
  }, [
    debouncedQuery,
    debouncedRequestNonce,
    english,
    normalizeApiItems,
    retryNonce,
    activeTag,
    view,
  ]);

  useEffect(() => () => {
    activeRequestRef.current?.controller.abort();
    activeRequestRef.current = null;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (view !== "popular") params.set("view", view);
    if (activeTag) params.set("tag", activeTag);
    const next = `/bbs${params.size ? `?${params}` : ""}`;
    window.history.replaceState(null, "", next);
  }, [activeTag, query, view]);

  const scopeLabel = activeTag ? `#${activeTag}` : (english ? "Thread list" : "スレッド一覧");
  const loadMore = () => {
    activeRequestRef.current?.controller.abort();
    const requestId = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestId;
    const controller = new AbortController();
    activeRequestRef.current = { id: requestId, controller };
    const ownsRequest = () => activeRequestRef.current?.id === requestId;
    const params = new URLSearchParams({
      view,
      limit: "50",
      offset: String(items.length),
    });
    if (debouncedQuery) params.set("q", debouncedQuery);
    if (activeTag) params.set("tag", activeTag);
    setLoading(true);
    setLoadError("");
    setLoadMoreFailed(false);
    void requestThreadPage(`/api/bbs/threads?${params}`, controller)
      .then((payload) => {
        if (!ownsRequest()) return;
        const knownIds = new Set(items.map((item) => item.id));
        const received = normalizeApiItems(payload.threads ?? [])
          .filter((thread) => !knownIds.has(thread.id));
        const nextItems = [...items, ...received];
        setItems(nextItems);
        const reportedTotal = Number(payload.total ?? nextItems.length);
        setTotal(received.length > 0
          ? Math.max(nextItems.length, reportedTotal)
          : nextItems.length);
      })
      .catch((error: unknown) => {
        if (!ownsRequest()) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setLoadMoreFailed(true);
        setLoadError(
          error instanceof BbsRequestTimeoutError
            ? english
              ? "More threads are taking longer than expected to load."
              : "追加のスレッドの読み込みに時間がかかっています。"
            : english
              ? "Could not load more threads."
              : "追加のスレッドを読み込めませんでした。",
        );
      })
      .finally(() => {
        if (!ownsRequest()) return;
        activeRequestRef.current = null;
        setLoading(false);
      });
  };

  return <BbsThreadDirectory
    tags={tags}
    totalCount={totalThreadCount ?? threads.length}
    currentTag={activeTag}
    onAllSelect={() => setActiveTag("")}
    onTagSelect={setActiveTag}
    mainSearch={<TabMainSearchHeader ariaLabel={english ? "Search threads" : "スレッドを検索"}>
      <form className="bbs-thread-search" role="search" onSubmit={(event) => event.preventDefault()}>
        <label htmlFor="bbs-thread-query">{english ? "Search threads" : "スレッドを検索"}</label>
        <div><Search aria-hidden="true" /><input id="bbs-thread-query" type="search" value={query} onChange={(event) => setQuery(event.target.value.slice(0, 100))} maxLength={100} placeholder={english ? "Search titles, tags, and posts" : "タイトル・タグ・投稿内容から検索"} />
        {query ? <button type="button" onClick={() => setQuery("")} aria-label={english ? "Clear search" : "検索をクリア"}>×</button> : null}</div>
      </form>
      {createPanel}
    </TabMainSearchHeader>}
  >
    <section className="bbs-browser">
      <section className="bbs-section bbs-thread-section">
        <div className="bbs-section__heading"><div><h2>{scopeLabel}</h2><p>{activeTag ? (english ? `Threads tagged ${activeTag}.` : `「${activeTag}」のスレッドを表示しています。`) : (english ? "Find questions, information, and experiences by tag or search." : "タグや検索で、質問・情報・体験談を探せます。")}</p></div><div className="bbs-section__tools"><small>{english ? `${total} threads` : `${total}件のスレッド`}</small></div></div>
        <nav className="bbs-view-tabs" aria-label={english ? "Choose which threads to show" : "表示するスレッドを選ぶ"}>
          {THREAD_VIEW_OPTIONS.map(([key, japanese, englishLabel]) => <button type="button" key={key} onClick={() => setView(key)} className={view === key ? "bbs-view-tabs__active" : ""} aria-pressed={view === key}>{english ? englishLabel : japanese}</button>)}
        </nav>
        {loading ? <div className="bbs-browser__status" role="status">{english ? "Loading…" : "読み込み中…"}</div> : null}
        {loadError ? <div className="bbs-browser__status bbs-browser__status--error" role="alert"><span>{loadError}</span><button type="button" onClick={() => loadMoreFailed ? loadMore() : setRetryNonce((value) => value + 1)}>{english ? "Try loading again" : "もう一度読み込む"}</button></div> : null}
        <div className="bbs-thread-list bbs-thread-list--dense">{items.map((thread) => <a href={`/threads/${thread.id}`} className="bbs-thread-card bbs-thread-card--dense" key={thread.id}>
          <span className="bbs-thread-card__body"><span className="bbs-thread-card__meta"><em className={`thread-type-badge thread-type-badge--${getThreadType(thread)}`}>{THREAD_TYPE_LABELS[getThreadType(thread)]}</em>{thread.tags?.map((tag) => <b key={tag}>#{tag}</b>)}<LocalizedDateTime value={thread.updatedAt}/>{thread.pinned ? <em>{english ? "Pinned to top" : "上に固定"}</em> : null}{thread.solvedAt ? <em className="bbs-thread-card__solved">{english ? "Solved" : "解決済み"}</em> : null}</span><strong>{thread.title}</strong><small>{thread.excerpt}</small></span><span className="bbs-thread-card__count">{english ? `${thread.postCount} replies` : `${thread.postCount}件の返信`}</span>
        </a>)}</div>
        {!loading && !loadError && !items.length ? <div className="thread-search__empty"><strong>{english ? "No matching threads" : "一致するスレッドがありません"}</strong><p>{english ? "Change the tag or search terms." : "タグまたは検索語を変更してください。"}</p></div> : null}
        {items.length < total ? <button type="button" className="bbs-browser__more" disabled={loading || Boolean(loadError)} onClick={loadMore}>{english ? `Load more (${total - items.length} remaining)` : `さらに読み込む（残り${total - items.length}件）`}</button> : null}
      </section>
    </section>
  </BbsThreadDirectory>;
}
