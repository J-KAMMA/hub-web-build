"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { V2Button } from "@/components/v2/v2-button";
import { V2Empty } from "@/components/v2/v2-empty";
import { V2Icon, type V2IconName } from "@/components/v2/v2-icons";
import { Avatar } from "@/components/v2/ui/avatar";
import type { Notification, Profile } from "@/lib/domain";
import { NOTIFICATION_UNREAD_EVENT, publishNotificationReadState } from "@/lib/notification-client";
import {
  matchesNotificationQuery,
  matchesNotificationTab,
  notificationHref,
  notificationLabel,
  type V2NotificationTab,
  groupNotifications,
  groupedNotificationText,
} from "@/lib/v2-notifications";
import { V2RelativeTime } from "@/components/v2/v2-relative-time";

const KIND_ICON: Partial<Record<Notification["type"], V2IconName>> = {
  social_reaction: "heart",
  social_reply: "reply",
  thread_reply: "reply",
  social_repost: "quote",
  social_bookmark: "bookmark",
  followed: "user",
  message_received: "mail",
  system: "bell",
};

const RETURN_FOCUS_KEY = "hub.notifications.return-focus";

/*
 * 通知の一覧。既存の notifications-panel.tsx（800行）から機能だけを抜いた。
 *
 * 落とさなかったもの: 5つの区分、語での絞り込み、1件ずつの既読（押した瞬間に
 * 既読にして失敗したら戻す）、一括既読、未読数の全体同期
 * （publishNotificationReadState → NOTIFICATION_UNREAD_EVENT）、
 * 新しい通知が告げられたら取り直す（既存と同じ条件: 見えていて、数が増えたとき）。
 *
 * まだ無いもの: コマース系の通知（別経路、/api/settings/notifications の設定と
 * 端末の既読）、優先度による並べ替え、通知の設定。
 */

export function V2Notifications({
  initialNotifications,
  profiles,
  threadPostDestinations,
  communityMessageDestinations,
  initialUnread,
  initialCursor = null,
  tab,
  query,
  locale,
}: {
  initialNotifications: Notification[];
  profiles: Profile[];
  threadPostDestinations: Record<string, string>;
  communityMessageDestinations: Record<string, string>;
  initialUnread: number;
  initialCursor?: string | null;
  tab: V2NotificationTab;
  query: string;
  locale: string;
}) {
  const ja = locale === "ja";
  const [items, setItems] = useState(initialNotifications);
  const [known, setKnown] = useState({ profiles, threadPostDestinations, communityMessageDestinations });
  const [unread, setUnread] = useState(initialUnread);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* メンション欄だけ。サーバーが絞った頁の続き（カーソル）を持つ。 */
  const [nextCursor, setNextCursor] = useState<string | null>(initialCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const mentionsTab = tab === "mentions";
  const unreadRef = useRef(initialUnread);
  const pendingReadIds = useRef(new Set<string>());
  const failedReadIds = useRef(new Set<string>());
  const readQueue = useRef(Promise.resolve());
  const readQueueBusy = useRef(false);
  const allReadPending = useRef(false);
  const readVersion = useRef(0);
  const refreshRequested = useRef(false);
  const notificationLinkRefs = useRef(new Map<string, HTMLAnchorElement>());
  const notificationResultsRef = useRef<HTMLDivElement | null>(null);
  const updateUnread = useCallback((count: number) => {
    unreadRef.current = Math.max(0, count);
    setUnread(unreadRef.current);
    return unreadRef.current;
  }, []);

  const profileMap = useMemo(() => new Map(known.profiles.map((profile) => [profile.id, profile])), [known.profiles]);

  const markNotificationNavigation = useCallback((groupKey: string) => {
    try {
      window.sessionStorage.setItem(RETURN_FOCUS_KEY, JSON.stringify({
        path: `${window.location.pathname}${window.location.search}`,
        groupKey,
      }));
    } catch {
      /* セッション保存を拒まれても通知先への移動は続ける。 */
    }
  }, []);

  useEffect(() => {
    let frame: number | null = null;
    let cancelled = false;
    const restoreFocus = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      let raw: string | null = null;
      let stored: { path?: unknown; groupKey?: unknown } | null = null;
      try {
        raw = window.sessionStorage.getItem(RETURN_FOCUS_KEY);
        if (raw) stored = JSON.parse(raw) as { path?: unknown; groupKey?: unknown };
      } catch {
        return;
      }
      const current = `${window.location.pathname}${window.location.search}`;
      if (!raw || !stored || typeof stored.path !== "string" || typeof stored.groupKey !== "string" || stored.path !== current) return;
      const groupKey = stored.groupKey;

      // The source can leave the unread tab after its successful read. Keep
      // that tab and its query intact, but return focus to the result area.
      // A client-side Back restores this page without a pageshow event, and
      // Next's own navigation focus can land after ours, so keep reclaiming
      // the target across frames until the focus actually sticks.
      let attempts = 0;
      let stableFrames = 0;
      const attempt = () => {
        if (cancelled || `${window.location.pathname}${window.location.search}` !== current) return;
        try {
          if (window.sessionStorage.getItem(RETURN_FOCUS_KEY) !== raw) return;
        } catch {
          return;
        }
        // Prefer the originating row; only after it has had a few frames to
        // re-register do we accept the results container (the row may have
        // legitimately left the list, e.g. the unread tab after being read).
        const target = notificationLinkRefs.current.get(groupKey)
          ?? (attempts >= 5 ? notificationResultsRef.current : null);
        if (!target || !target.isConnected) {
          if (++attempts < 60) frame = window.requestAnimationFrame(attempt);
          return;
        }
        if (document.activeElement !== target) {
          target.focus();
          stableFrames = 0;
        } else {
          // The router's own focus reset can land a frame after ours; only
          // accept the restore once the focus has stayed put across frames.
          stableFrames += 1;
        }
        if (stableFrames >= 4) {
          try {
            window.sessionStorage.removeItem(RETURN_FOCUS_KEY);
          } catch {
            /* 保存領域が使えなくても、リンクの復帰先は変えない。 */
          }
          return;
        }
        if (++attempts < 60) frame = window.requestAnimationFrame(attempt);
        else {
          try {
            window.sessionStorage.removeItem(RETURN_FOCUS_KEY);
          } catch {
            /* 保存領域が使えなくても、リンクの復帰先は変えない。 */
          }
        }
      };
      frame = window.requestAnimationFrame(attempt);
    };
    restoreFocus();
    window.addEventListener("pageshow", restoreFocus);
    window.addEventListener("popstate", restoreFocus);
    return () => {
      cancelled = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      window.removeEventListener("pageshow", restoreFocus);
      window.removeEventListener("popstate", restoreFocus);
    };
  }, []);

  const applyPayload = useCallback((payload: { notifications?: Notification[]; profiles?: Profile[]; threadPostDestinations?: Record<string, string>; communityMessageDestinations?: Record<string, string>; nextCursor?: string | null }) => {
    if (mentionsTab && payload.nextCursor !== undefined) setNextCursor(payload.nextCursor);
    if (payload.notifications) {
      setItems(payload.notifications
        .filter((item) => item.type !== "message_received")
        .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)));
    }
    setKnown((previous) => ({
      profiles: payload.profiles ?? previous.profiles,
      threadPostDestinations: payload.threadPostDestinations ?? previous.threadPostDestinations,
      communityMessageDestinations: payload.communityMessageDestinations ?? previous.communityMessageDestinations,
    }));
  }, [mentionsTab]);

  /* 新しい通知が告げられたら取り直す。見えていないとき・数が増えていないときは動かない。 */
  useEffect(() => {
    let controller: AbortController | null = null;
    let inFlight = false;
    const onUnread = (event: Event) => {
      const announced = (event as CustomEvent<number>).detail;
      if (document.visibilityState === "hidden" || inFlight || (announced <= unreadRef.current && !refreshRequested.current)) return;
      refreshRequested.current = true;
      if (pending || pendingReadIds.current.size > 0 || allReadPending.current) return;
      inFlight = true;
      const version = readVersion.current;
      controller?.abort();
      controller = new AbortController();
      fetch(mentionsTab ? "/api/notifications?filter=mentions" : "/api/notifications", { cache: "no-store", credentials: "same-origin", signal: controller.signal })
        .then((response) => { if (!response.ok) throw new Error(); return response.json(); })
        .then((payload) => {
          if (controller?.signal.aborted || version !== readVersion.current) return;
          applyPayload(payload);
          updateUnread(payload.unreadCount);
          refreshRequested.current = false;
        })
        .catch(() => undefined)
        .finally(() => { inFlight = false; });
    };
    window.addEventListener(NOTIFICATION_UNREAD_EVENT, onUnread);
    if (refreshRequested.current) onUnread(new CustomEvent<number>(NOTIFICATION_UNREAD_EVENT, { detail: unreadRef.current }));
    return () => { controller?.abort(); window.removeEventListener(NOTIFICATION_UNREAD_EVENT, onUnread); };
  }, [applyPayload, mentionsTab, pending, updateUnread]);

  const visible = useMemo(
    () => items.filter((item) => matchesNotificationTab(item, tab) && matchesNotificationQuery(item, item.actorProfileId ? profileMap.get(item.actorProfileId) : undefined, query)),
    [items, tab, query, profileMap],
  );
  /* 同じ的へのいいね・リポスト・保存・フォローは1行に（lib/v2-notifications.ts）。 */
  const groups = useMemo(() => groupNotifications(visible), [visible]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const response = await fetch(`/api/notifications?filter=mentions&cursor=${encodeURIComponent(nextCursor)}`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { notifications: Notification[]; profiles?: Profile[]; threadPostDestinations?: Record<string, string>; communityMessageDestinations?: Record<string, string>; nextCursor?: string | null };
      setItems((current) => {
        const seen = new Set(current.map((item) => item.id));
        return [...current, ...payload.notifications.filter((item) => !seen.has(item.id))];
      });
      setKnown((previous) => ({
        profiles: [...previous.profiles, ...(payload.profiles ?? []).filter((profile) => !previous.profiles.some((other) => other.id === profile.id))],
        threadPostDestinations: { ...previous.threadPostDestinations, ...(payload.threadPostDestinations ?? {}) },
        communityMessageDestinations: { ...previous.communityMessageDestinations, ...(payload.communityMessageDestinations ?? {}) },
      }));
      setNextCursor(payload.nextCursor ?? null);
      setError(null);
    } catch {
      setError(ja ? "続きを読み込めませんでした。" : "Could not load more.");
    } finally {
      setLoadingMore(false);
    }
  };

  /* 押した瞬間に既読。失敗したら戻す。数は全体へ流す。 */
  const markRead = (notification: Notification, startImmediately = false) => {
    if (notification.isRead || pendingReadIds.current.has(notification.id) || allReadPending.current) return;
    pendingReadIds.current.add(notification.id);
    readVersion.current += 1;
    setPending(true);
    setItems((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: true } : item));
    const optimistic = updateUnread(unreadRef.current - 1);
    publishNotificationReadState({ notificationId: notification.id, isRead: true, unreadCount: optimistic });
    // Counts have no server revision: send reads in order, while keeping queued reads optimistic.
    // A notification target can navigate away immediately. Start the first
    // request in that click synchronously and retain it through navigation.
    const performRead = async () => {
      try {
        const response = await fetch(`/api/notifications/${encodeURIComponent(notification.id)}/read`, { method: "POST", keepalive: true });
        if (!response.ok) throw new Error(String(response.status));
        const payload = await response.json() as { unreadCount: number };
        if (!Number.isSafeInteger(payload.unreadCount) || payload.unreadCount < 0) throw new Error("Invalid unread count");
        pendingReadIds.current.delete(notification.id);
        failedReadIds.current.delete(notification.id);
        const confirmed = updateUnread(payload.unreadCount - pendingReadIds.current.size);
        publishNotificationReadState({ notificationId: notification.id, isRead: true, unreadCount: confirmed });
        if (failedReadIds.current.size === 0) setError(null);
      } catch {
        pendingReadIds.current.delete(notification.id);
        failedReadIds.current.add(notification.id);
        setItems((current) => current.map((item) => item.id === notification.id ? { ...item, isRead: false } : item));
        const restored = updateUnread(unreadRef.current + 1);
        publishNotificationReadState({ notificationId: notification.id, isRead: false, unreadCount: restored });
        setError(ja ? "既読にできませんでした。" : "Could not mark as read.");
      } finally {
        if (pendingReadIds.current.size === 0) setPending(false);
      }
    };
    const task = startImmediately && !readQueueBusy.current
      ? performRead()
      : readQueue.current.then(performRead);
    const tail = task.catch(() => undefined);
    readQueueBusy.current = true;
    readQueue.current = tail;
    void tail.finally(() => {
      if (readQueue.current === tail) readQueueBusy.current = false;
    });
  };

  const readAll = async () => {
    if (allReadPending.current || pendingReadIds.current.size > 0 || unreadRef.current === 0) return;
    allReadPending.current = true;
    readVersion.current += 1;
    setPending(true);
    const before = items;
    const beforeUnread = unreadRef.current;
    setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    updateUnread(0);
    publishNotificationReadState({ isRead: true, unreadCount: 0, all: true });
    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      const payload = await response.json() as { notifications: Notification[]; unreadCount: number };
      // メンション欄は頁を重ねているので、全件の一覧で置き換えず、手元の表示を既読にしたままにする。
      if (!mentionsTab) applyPayload({ notifications: payload.notifications });
      updateUnread(payload.unreadCount);
      publishNotificationReadState({ isRead: true, unreadCount: payload.unreadCount, all: true });
      failedReadIds.current.clear();
      setError(null);
    } catch {
      setItems(before);
      updateUnread(beforeUnread);
      publishNotificationReadState({ isRead: false, unreadCount: beforeUnread, all: true });
      setError(ja ? "一括既読にできませんでした。" : "Could not mark all as read.");
    } finally {
      allReadPending.current = false;
      setPending(false);
    }
  };

  return (
    <div ref={notificationResultsRef} className="v2-notifs" tabIndex={-1}>
      {items.length > 0 ? <div className="v2-notifs__bar">
        <span className={unread > 0 ? "v2-notifs__unread" : "v2-notifs__unread v2-sr"} aria-live="polite">{ja ? `未読 ${unread}` : `${unread} unread`}</span>
        <V2Button icon="check" variant="text" label={ja ? "すべて既読にする" : "Mark all read"} disabled={pending || unread === 0} onClick={() => void readAll()} />
      </div> : null}
      {error ? <p className="v2-error" role="status">{error}</p> : null}

      {visible.length ? (
        <ul className="v2-notifs__list">
          {groups.map((group) => {
            const notification = group.latest;
            const actors = group.actorIds.map((id) => profileMap.get(id)).filter((profile): profile is Profile => Boolean(profile));
            const href = notificationHref(notification, profileMap, known.threadPostDestinations, known.communityMessageDestinations);
            const text = groupedNotificationText(group, actors.map((profile) => profile.displayName), ja);
            const excerpt = group.items.find((item) => item.excerpt)?.excerpt;
            const markGroupRead = (startImmediately = false) => {
              let immediate = startImmediately;
              for (const item of group.items) {
                if (!item.isRead) markRead(item, immediate);
                immediate = false;
              }
            };
            return (
              <li key={group.key} className={group.isRead ? "v2-notif" : "v2-notif v2-notif--unread"}>
                <span className="v2-notif__kind" data-kind={notification.type} aria-hidden="true"><V2Icon name={KIND_ICON[notification.type] ?? "bell"} /></span>
                <div className="v2-notif__main">
                  {/* まとめた行は顔を重ねる（3人まで）。 */}
                  <span className="v2-notif__avatars">
                    {(actors.length ? actors.slice(0, 3) : [undefined]).map((profile, index) => (
                      <Avatar key={profile?.id ?? index} name={profile?.displayName} src={profile?.avatarUrl} size={32} />
                    ))}
                  </span>
                  <Link
                    ref={(element) => {
                      if (element) notificationLinkRefs.current.set(group.key, element);
                      else notificationLinkRefs.current.delete(group.key);
                    }}
                    className="v2-notif__link"
                    href={href}
                    onClick={() => {
                      markGroupRead(true);
                      markNotificationNavigation(group.key);
                    }}
                  >
                    {text}
                  </Link>
                  {excerpt ? <p className="v2-notif__excerpt">{excerpt}</p> : null}
                  <p className="v2-notif__meta">
                    <span>{notificationLabel(notification, ja)}</span>
                    <span aria-hidden="true">·</span>
                    <V2RelativeTime value={notification.createdAt} locale={locale} />
                    {!group.isRead ? <span className="v2-unread" role="img" aria-label={ja ? "未読" : "Unread"} /> : null}
                  </p>
                  {!group.isRead ? <div className="v2-notif__actions"><V2Button icon="check" label={ja ? "既読にする" : "Mark read"} onClick={() => markGroupRead()} /></div> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        query
          ? <V2Empty title={ja ? "一致する通知がありません" : "No notifications matched"} action={{ label: ja ? "絞り込みを解除" : "Clear", href: "/v2/notifications" }} />
          : tab === "mentions"
            ? <V2Empty title={ja ? "メンションと返信はまだありません" : "No mentions or replies yet"} note={ja ? "あなた宛ての返信やメンションがここに来ます。" : "Replies and mentions addressed to you arrive here."} />
          : tab === "unread"
            ? <V2Empty title={ja ? "未読の通知はありません" : "Nothing unread"} action={{ label: ja ? "すべて見る" : "Show all", href: "/v2/notifications" }} />
            : <V2Empty title={ja ? "通知はまだありません" : "No notifications yet"} note={ja ? "返信・いいね・フォローがあるとここに来ます。" : "Replies, likes and follows arrive here."} action={{ label: ja ? "フィードへ" : "Go to the feed", href: "/v2" }} />
      )}
      {mentionsTab && nextCursor ? (
        <div className="v2-notifs__more">
          <V2Button label={loadingMore ? (ja ? "読み込み中" : "Loading") : (ja ? "もっと見る" : "Load more")} disabled={loadingMore} onClick={() => void loadMore()} />
        </div>
      ) : null}
    </div>
  );
}
