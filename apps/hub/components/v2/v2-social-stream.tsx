"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { V2Compose } from "./v2-compose";
import { V2Post, type V2PostData } from "./v2-post";
import {useHubNetwork, HubNetworkCard, HubNetworkStatus} from "@/components/hub-network";
import {interleaveHubItems} from "@/lib/hub-network-client";
import { V2RelativeTime } from "./v2-relative-time";
import { scrollerFor, scrollEventTarget } from "@/lib/v2-scroller";
import { THREAD_TYPE_LABELS, isThreadType } from "@/lib/thread-type";
import { compareStreamItems, decodeStreamCursor, MAX_STREAM_ITEMS_BYTES, SOCIAL_STREAM_KINDS, streamId, streamKinds, streamOrigin, streamTimestamp, type SocialStreamFilter, type SocialStreamItem, type SocialStreamKind, type SocialStreamPost, type SocialStreamResponse, type SocialStreamScope, type StreamContext } from "@/lib/social-stream";

type Props = { filter: SocialStreamFilter; scope: SocialStreamScope; viewerId: string | null; viewerName?: string; viewerAvatarUrl?: string; locale: string; origin?: string; shareHref?: string };
const labels: Record<SocialStreamKind, [string, string]> = { post: ["投稿", "Post"], thread: ["スレッド", "Thread"], community_post: ["コミュニティ", "Community"] };
const identity = (item: SocialStreamItem) => JSON.stringify([item.kind, item.origin, item.id]);
// Navigation metadata only: never retain private stream bodies across route mounts.
const navigationScenes = new Map<string, { pages: number; top: number }>();
let navigationActor: string | null | undefined;
const merge = (before: SocialStreamItem[], after: SocialStreamItem[]) => [...new Map([...before, ...after].map(item => [identity(item), item])).values()];
const record = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const text = (value: unknown): value is string => typeof value === "string" && value.length <= 100000 && !/\u0000|\p{Surrogate}/u.test(value);
const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
const nullableId = (value: unknown) => value === null || streamId(value);
function safeHref(value: unknown): value is string {
  if (!text(value) || !value || value.length > 8192 || /[\\\p{Cc}]/u.test(value) || value.startsWith("//")) return false;
  try { const url = new URL(value, "https://hub.invalid"); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password; } catch { return false; }
}
function validPost(raw: unknown): raw is SocialStreamPost {
  if (!record(raw, ["id", "body", "createdAt", "authorName", "authorHandle", "authorProfileId", "avatarUrl", "replyCount", "repostCount", "likeCount", "likedByViewer", "bookmarkedByViewer", "viewerRepostId", "images", "tags", "referenced", "identityMode", "replyToPostId"])) return false;
  if (!streamId(raw.id) || !text(raw.body) || raw.body.length > 40000 || !text(raw.createdAt) || !text(raw.authorName) || raw.authorName.length > 160 || !(raw.authorHandle === null || text(raw.authorHandle) && raw.authorHandle.length <= 64) || !nullableId(raw.authorProfileId) || !(raw.avatarUrl === null || safeHref(raw.avatarUrl)) || ![raw.replyCount, raw.repostCount, raw.likeCount].every(count) || typeof raw.likedByViewer !== "boolean" || typeof raw.bookmarkedByViewer !== "boolean" || !nullableId(raw.viewerRepostId) || !["account", "anonymous", "guest"].includes(String(raw.identityMode)) || !nullableId(raw.replyToPostId) || !Array.isArray(raw.images) || raw.images.length > 4 || !Array.isArray(raw.tags) || raw.tags.length > 50 || !raw.tags.every(value => text(value) && value.length <= 256)) return false;
  if (raw.identityMode !== "account" && (raw.authorProfileId !== null || raw.authorHandle !== null || raw.avatarUrl !== null)) return false;
  for (const image of raw.images) if (!record(image, ["id", "url", "width", "height", "altText"]) || !streamId(image.id) || !safeHref(image.url) || !count(image.width) || Number(image.width) < 1 || !count(image.height) || Number(image.height) < 1 || !text(image.altText)) return false;
  if (raw.referenced !== null) {
    const keys = ["label", "title", "body", "href", ...(raw.referenced && typeof raw.referenced === "object" && Object.hasOwn(raw.referenced, "contextLabel") ? ["contextLabel"] : [])];
    if (!record(raw.referenced, keys) || ![raw.referenced.label, raw.referenced.title, raw.referenced.body].every(text) || !safeHref(raw.referenced.href) || keys.includes("contextLabel") && !text(raw.referenced.contextLabel)) return false;
  }
  return true;
}
class ChangedViewer extends Error {}
function readPage(raw: unknown, context: StreamContext): SocialStreamResponse {
  if (!record(raw, ["version", "filter", "scope", "viewerId", "signedIn", "items", "hasMore", "nextCursor", "failures"])) throw Error("invalid_stream");
  if (raw.viewerId !== context.viewerId || raw.signedIn !== (context.viewerId !== null)) throw new ChangedViewer();
  const kinds = streamKinds(context.filter);
  if (raw.version !== 1 || raw.filter !== context.filter || raw.scope !== context.scope || !Array.isArray(raw.items) || raw.items.length > 40 || typeof raw.hasMore !== "boolean" || !Array.isArray(raw.failures) || !raw.failures.every(kind => kinds.includes(kind)) || new Set(raw.failures).size !== raw.failures.length || new TextEncoder().encode(JSON.stringify(raw.items)).byteLength > MAX_STREAM_ITEMS_BYTES) throw Error("invalid_stream");
  if (raw.hasMore) { if (typeof raw.nextCursor !== "string") throw Error("invalid_cursor"); decodeStreamCursor(raw.nextCursor, context); } else if (raw.nextCursor !== null) throw Error("invalid_cursor");
  for (const item of raw.items) {
    if (!record(item, ["kind", "id", "createdAt", "origin", "payload"]) || !kinds.includes(item.kind as SocialStreamKind) || !streamId(item.id) || !text(item.createdAt) || streamTimestamp(item.createdAt) !== item.createdAt || !text(item.origin) || streamOrigin(item.origin) !== item.origin || item.origin !== context.origin) throw Error("invalid_item");
    const payload = item.payload;
    if (item.kind === "post") { if (!validPost(payload) || payload.id !== item.id || payload.createdAt !== item.createdAt) throw Error("invalid_post"); }
    else if (item.kind === "thread") {
      if (!record(payload, ["id", "title", "boardKey", "postCount", "threadType", "status", "updatedAt"]) || payload.id !== item.id || !text(payload.title) || !text(payload.boardKey) || !count(payload.postCount) || !text(payload.threadType) || !isThreadType(payload.threadType) || !["open", "closed"].includes(String(payload.status)) || !text(payload.updatedAt) || streamTimestamp(payload.updatedAt) !== payload.updatedAt) throw Error("invalid_thread");
    } else if (!record(payload, ["id", "communityId", "communityName", "channelId", "channelName", "body", "createdAt", "authorName", "authorHandle", "replyCount", "likeCount", "kind"]) || payload.id !== item.id || !streamId(payload.communityId) || !streamId(payload.channelId) || ![payload.communityName, payload.channelName, payload.body, payload.authorName].every(text) || payload.createdAt !== item.createdAt || !(payload.authorHandle === null || text(payload.authorHandle)) || ![payload.replyCount, payload.likeCount].every(count) || !["chat", "guide", "question", "party"].includes(String(payload.kind))) throw Error("invalid_community_post");
  }
  return raw as SocialStreamResponse;
}
async function readJson(response: Response): Promise<unknown> {
  const reader = response.body?.getReader(); if (!reader) throw Error("empty_stream");
  const decoder = new TextDecoder("utf-8", { fatal: true }); let bytes = 0, body = "";
  try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; bytes += chunk.value.byteLength; if (bytes > 2 * 1024 * 1024) throw Error("stream_too_large"); body += decoder.decode(chunk.value, { stream: true }); } body += decoder.decode(); return JSON.parse(body); }
  catch (error) { await reader.cancel().catch(() => {}); throw error; } finally { reader.releaseLock(); }
}

export function socialPostForV2(post: SocialStreamPost): V2PostData {
  return { id: post.id, body: post.body, createdAt: post.createdAt, authorProfileId: post.authorProfileId, displayName: post.authorName,
    ...(post.authorHandle === null ? {} : { handle: post.authorHandle }), ...(post.avatarUrl === null ? {} : { avatarUrl: post.avatarUrl }),
    identityMode: post.identityMode, replyToPostId: post.replyToPostId, replyCount: post.replyCount, likeCount: post.likeCount, score: 0,
    bookmarked: post.bookmarkedByViewer, viewerReaction: post.likedByViewer ? "like" : null, repostCount: post.repostCount,
    viewerRepostId: post.viewerRepostId, images: post.images.map(image => ({ ...image })), tags: [...post.tags], referenced: post.referenced ? { ...post.referenced } : null };
}
export function socialStreamHref(item: SocialStreamItem): string {
  const path = item.kind === "post" ? `/v2/posts/${encodeURIComponent(item.id)}` : item.kind === "thread" ? `/v2/threads/${encodeURIComponent(item.id)}` : `/v2/community?${new URLSearchParams({ community: item.payload.communityId, channel: item.payload.channelId })}#message-${encodeURIComponent(item.id)}`;
  return item.origin + path;
}
export function V2SocialStream(props: Props) {
  return <SocialStreamView key={JSON.stringify([props.origin ?? "", props.viewerId, props.filter, props.scope, props.locale])} {...props} />;
}
function SocialStreamView({ filter, scope, viewerId, viewerName = "", viewerAvatarUrl, locale, origin, shareHref }: Props) {
  const ja = locale === "ja", signedIn = viewerId !== null;
  const network=useHubNetwork("post",signedIn&&scope==="latest"&&(filter==="all"||filter==="post"));
  const [items, setItems] = useState<SocialStreamItem[]>([]), [fresh, setFresh] = useState<SocialStreamItem[]>([]), [failures, setFailures] = useState<SocialStreamKind[]>([]);
  const [loading, setLoading] = useState(true), [headLoading, setHeadLoading] = useState(false), [error, setError] = useState<string | null>(null), [actionError, setActionError] = useState<string | null>(null);
  const [paging, setPaging] = useState({ cursor: null as string | null, hasMore: false }), [source, setSource] = useState<string | null>(null), [changedViewer, setChangedViewer] = useState(false);
  const [restorePosition, setRestorePosition] = useState<number | null>(null);
  const epoch = useRef<object | null>(null), controllers = useRef(new Set<AbortController>()), pending = useRef(false), headPending = useRef(false), rows = useRef(items), retryCursor = useRef<string | null>(null);
  const fetcher = useRef<(cursor: string | null, head?: boolean) => Promise<void>>(async () => {});
  const section = useRef<HTMLElement>(null), loadedPages = useRef(0), nextPage = useRef<string | null>(null), restoring = useRef(false);
  const returnTo = `/v2?social=${filter}&feed=${scope}`;
  rows.current = items;
  useLayoutEffect(() => {
    if (restorePosition === null || loading || !epoch.current) return;
    const scroller = scrollerFor(section.current);
    if (scroller) scroller.scrollTop = restorePosition;
    setRestorePosition(null);
  }, [items, loading, restorePosition]);
  const invalidate = () => { epoch.current = null; for (const controller of controllers.current) controller.abort(); controllers.current.clear(); setItems([]); setFresh([]); setFailures([]); setPaging({ cursor: null, hasMore: false }); setLoading(true); };
  useEffect(() => {
    const token = {}; let denied=false; epoch.current = token; pending.current = false; headPending.current = false;
    let actualOrigin: string; try { actualOrigin = streamOrigin(origin ?? window.location.origin); } catch { setError(ja ? "接続先を確認できません。" : "Could not verify the source."); setLoading(false); return; }
    setSource(actualOrigin);
    if (navigationActor !== viewerId) { navigationScenes.clear(); navigationActor = viewerId; }
    const sceneKey = JSON.stringify([actualOrigin, viewerId, filter, scope, locale]);
    const saved = navigationScenes.get(sceneKey);
    const scroller = scrollerFor(section.current);
    const scrollElement = scroller instanceof HTMLElement ? scroller : null, previousAnchor = scrollElement?.style.overflowAnchor ?? '';
    if (scrollElement) scrollElement.style.overflowAnchor = 'none';
    let knownTop = saved?.top ?? scroller?.scrollTop ?? 0, leaving = false;
    const storeScene = () => {
      if (!current() || !loadedPages.current || restoring.current) return;
      navigationScenes.delete(sceneKey);
      navigationScenes.set(sceneKey, { pages: loadedPages.current, top: knownTop });
      if (navigationScenes.size > 12) navigationScenes.delete(navigationScenes.keys().next().value!);
    };
    const remember = () => { if (leaving) return; knownTop = scroller?.scrollTop ?? 0; storeScene(); };
    const departing = (event: MouseEvent) => {
      remember();
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.target === '_blank' || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const target = new URL(link.href);
      if (target.origin === window.location.origin && /^\/v2\/(?:posts\/|threads\/|community(?:\?|$))/.test(target.pathname + target.search)) leaving = true;
    };
    const accountChanged = () => { navigationScenes.clear(); invalidate(); setChangedViewer(true); };
    const context: StreamContext = { filter, scope, viewerId, origin: actualOrigin }, current = () => epoch.current === token;
    const load = async (cursor: string | null, head = false): Promise<boolean> => {
      if (!current() || pending.current || headPending.current) return false;
      const controller = new AbortController(); controllers.current.add(controller);
      retryCursor.current = head ? null : cursor;
      if (head) { headPending.current = true; setHeadLoading(true); } else { pending.current = true; retryCursor.current = cursor; setLoading(true); setError(null); }
      try {
        const query = new URLSearchParams({ filter, scope, limit: "20" }); if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/client/social-stream?${query}`, { credentials: "same-origin", cache: "no-store", signal: controller.signal }); if (!current()) return false;
        if ([401, 403].includes(response.status)) throw new ChangedViewer(); if (!response.ok) throw Error("unavailable_stream");
        const page = readPage(await readJson(response), context); if (!current()) return false;
        if (head) { const known = new Map(rows.current.map(item => [identity(item),item])); setFresh(page.items.filter(item => !known.has(identity(item)) || known.get(identity(item))!.createdAt !== item.createdAt)); }
        else { setItems(previous => cursor || page.failures.length ? merge(previous, page.items) : merge([], page.items)); setPaging({ cursor: page.nextCursor, hasMore: page.hasMore }); loadedPages.current = cursor ? loadedPages.current + 1 : 1; nextPage.current = page.failures.length ? null : page.nextCursor; }
        setFailures(page.failures);
        return page.failures.length === 0;
      } catch (caught) { if (current() && !controller.signal.aborted) {
        if (caught instanceof ChangedViewer) { denied=true; navigationScenes.clear(); epoch.current = null; setItems([]); setFresh([]); setPaging({ cursor: null, hasMore: false }); setChangedViewer(true); }
        nextPage.current = null;
        setError(caught instanceof ChangedViewer ? ja ? "ログイン状態が変わりました。タイムラインを開き直してください。" : "Your sign-in state changed. Reopen the stream." : ja ? "タイムラインを取得できませんでした。表示中の内容は保持しています。" : "Could not load the stream. Existing items are retained.");
      } } finally { controllers.current.delete(controller); if (current() || caughtViewer(token)) { if (head) { headPending.current = false; setHeadLoading(false); } else { pending.current = false; setLoading(false); } } }
      return false;
    };
    // An invalidated view must not be revived by an old request's finalizer.
    const caughtViewer = (request: object) => denied && epoch.current === null && request === token;
    if (scope === "following" && !signedIn) { setLoading(false); return () => { epoch.current = null; if (scrollElement) scrollElement.style.overflowAnchor = previousAnchor; }; }
    restoring.current = !!saved;
    const restore = async () => {
      let complete = await load(null);
      while (current() && complete && saved && loadedPages.current < saved.pages && nextPage.current) complete = await load(nextPage.current);
      if (!current() || !complete) return;
      restoring.current = false;
      if (saved) setRestorePosition(saved.top);
    };
    fetcher.current = async (cursor, head = false) => { if (restoring.current) { if (!head) await restore(); } else await load(cursor, head); };
    void restore();
    const scrollTarget = scrollEventTarget(scroller); scrollTarget?.addEventListener('scroll', remember);
    section.current?.addEventListener('click', departing, true);
    const element = section.current;
    window.addEventListener('hub-account-changed', accountChanged);
    const timer = window.setInterval(() => { if (document.visibilityState !== "hidden") void fetcher.current(null, true); }, 45000);
    return () => { storeScene(); epoch.current = null; window.clearInterval(timer); if (scrollElement) scrollElement.style.overflowAnchor = previousAnchor; scrollTarget?.removeEventListener('scroll', remember); element?.removeEventListener('click', departing, true); window.removeEventListener('hub-account-changed', accountChanged); for (const controller of controllers.current) controller.abort(); controllers.current.clear(); };
  }, [filter, scope, viewerId, origin, ja, signedIn]);
  const showFresh = () => { if (epoch.current && !pending.current) { setItems(previous => merge(previous, fresh).sort(compareStreamItems)); setFresh([]); } };
  const created = () => { if (epoch.current) void fetcher.current(null, true); };
  return <section ref={section} className="v2-social-stream" aria-label={ja ? "タイムライン" : "Timeline"}>
    {filter === "post" || filter === "all" ? <V2Compose key={viewerId} viewerId={viewerId ?? ""} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} japanese={ja} onCreated={created} shareHref={shareHref} /> : null}
    {scope === "following" && !signedIn ? <p className="v2-note"><Link href={`/v2/auth?next=${encodeURIComponent(`/v2?social=${filter}&feed=following`)}`}>{ja ? "ログイン" : "Sign in"}</Link>{ja ? "するとフォロー中の投稿を確認できます。" : " to view followed conversations."}</p> : null}
    {fresh.length > 0 && <button type="button" className="v2-button v2-social-stream__fresh" disabled={loading || headLoading} onClick={showFresh}>{ja ? `新しい投稿 ${fresh.length}件を表示` : `Show ${fresh.length} new items`}</button>}
    {loading && <p className="v2-note v2-social-stream__status" role="status">{ja ? "タイムラインを読み込んでいます…" : "Loading the stream…"}</p>}
    {(error || actionError) && <p className="v2-error" role="alert">{error ?? actionError}</p>}
    {failures.length > 0 && <p className="v2-note v2-social-stream__status" role="status">{ja ? "一部を取得できませんでした：" : "Some sources could not be loaded: "}{failures.map(kind => labels[kind][ja ? 0 : 1]).join("、")}{ja ? "。ほかの内容と取得済みの内容を表示しています。" : ". Other and previously loaded items are retained."}</p>}
    {changedViewer ? <Link href="/v2" className="v2-card__link">{ja ? "タイムラインを開き直す" : "Reopen the stream"}</Link> : (error || failures.length > 0) && <button type="button" className="v2-button" disabled={loading || headLoading} onClick={() => void fetcher.current(retryCursor.current)}>{ja ? "再取得" : "Try again"}</button>}
    {epoch.current && <HubNetworkStatus state={network} />}
    <div className="v2-social-stream__list" aria-busy={loading}>{interleaveHubItems(items,epoch.current?network.items:[]).map(entry => { if(entry.remote) return <HubNetworkCard key={`${entry.remote.origin}:${entry.remote.id}`} item={entry.remote}/>; const item=entry.local; return <article key={identity(item)} className={`v2-social-stream__item v2-social-stream__item--${item.kind}`} data-stream-key={identity(item)}>
      {item.kind === "post" && item.origin === source ? null : <p className="v2-social-stream__badges">{item.kind === "post" ? null : <span className="v2-badge">{labels[item.kind][ja ? 0 : 1]}</span>}{item.origin === source ? null : <span className="v2-social-stream__source">{new URL(item.origin).host}</span>}</p>}
      {item.kind === "post" && item.origin === source ? <V2Post post={socialPostForV2(item.payload)} viewerId={viewerId ?? ""} locale={locale} returnTo={returnTo}
        onError={message => { if (epoch.current) setActionError(message); }} onRemoved={id => { if (epoch.current) setItems(previous => previous.filter(row => !(row.kind === "post" && row.origin === item.origin && row.id === id))); }} onCreated={created} /> : <>
        <Link className="v2-social-stream__title" href={item.origin === source ? (() => { const url = new URL(socialStreamHref(item)); url.searchParams.set('returnTo', returnTo); return url.pathname + url.search + url.hash; })() : socialStreamHref(item)} {...(item.origin === source ? {} : { target: "_blank", rel: "noopener noreferrer" })}>{item.kind === "thread" ? item.payload.title : item.kind === "community_post" ? `${item.payload.communityName} · #${item.payload.channelName}` : item.payload.authorName}</Link>
        {item.kind === "thread" ? <p className="v2-card__meta">{THREAD_TYPE_LABELS[item.payload.threadType]} · {item.payload.boardKey} · {ja ? `${item.payload.postCount} 投稿` : `${item.payload.postCount} posts`} · {item.payload.status === "closed" ? ja ? "受付終了" : "Closed" : ja ? "受付中" : "Open"}</p> : <p className="v2-social-stream__body">{item.payload.body}</p>}
        {item.kind === "community_post" && <p className="v2-card__meta">{item.payload.authorName} · {ja ? `${item.payload.replyCount} 返信` : `${item.payload.replyCount} replies`} · {ja ? "チャンネルで見る" : "View in channel"}</p>}
        <V2RelativeTime value={item.createdAt} locale={locale} />
      </>}
    </article>;})}</div>
    {!loading && !items.length && !error && !(scope === "following" && !signedIn) && <p className="v2-note">{failures.length ? ja ? "取得できた内容はありません。再取得してください。" : "No items could be loaded. Try again." : ja ? "表示する投稿はありません。" : "There are no items to show."}</p>}
    {paging.hasMore && !changedViewer && <button type="button" className="v2-button v2-social-stream__more" disabled={loading || headLoading} onClick={() => void fetcher.current(paging.cursor)}>{loading ? ja ? "読み込み中…" : "Loading…" : ja ? "続きを表示" : "Load more"}</button>}
  </section>;
}
