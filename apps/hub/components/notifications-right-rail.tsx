"use client";

import React from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bell, CheckCheck, Heart, MessageCircle, RefreshCw, Repeat2, UserPlus } from "lucide-react";

import type { Notification, Profile } from "@/lib/domain";
import { formatRelativeJst } from "@/lib/format";
import {
  NOTIFICATION_READ_STATE_EVENT,
  NOTIFICATION_UNREAD_EVENT,
  publishNotificationReadState,
  type NotificationReadState,
} from "@/lib/notification-client";

type RailFilter = "all" | "unread";
const NOTIFICATION_CACHE_KEY = "hub.notifications.right-rail.v1";

type NotificationCache = {
  fetchedAt: number;
  notifications: Notification[];
};

function readNotificationCache(): NotificationCache | null {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(NOTIFICATION_CACHE_KEY) ?? "null") as NotificationCache | null;
    if (!value || !Array.isArray(value.notifications) || !Number.isFinite(value.fetchedAt)) return null;
    return value;
  } catch {
    return null;
  }
}

function writeNotificationCache(notifications: Notification[]) {
  try {
    window.sessionStorage.setItem(NOTIFICATION_CACHE_KEY, JSON.stringify({
      fetchedAt: Date.now(),
      notifications,
    } satisfies NotificationCache));
  } catch {
    // Storage is an optional acceleration layer.
  }
}

function destination(
  item: Notification,
  profiles: Map<string, Profile>,
  threadPostDestinations: Record<string, string>,
  communityMessageDestinations: Record<string, string>,
) {
  if (
    item.targetType === "system"
    && item.targetId.startsWith("/")
    && !item.targetId.startsWith("//")
    && !item.targetId.includes("\\")
  ) return item.targetId.split("#event=")[0];
  if (item.targetType === "social_post") return `/posts/${item.targetId}`;
  if (item.targetType === "thread") return `/threads/${item.targetId}`;
  if (item.targetType === "thread_post") return threadPostDestinations[item.targetId] ?? "/bbs";
  if (item.targetType === "community_message") return communityMessageDestinations[item.targetId] ?? "/community";
  if (item.targetType === "profile") {
    const profile = profiles.get(item.targetId);
    return profile ? `/profile/${profile.handle}` : "/community";
  }
  return "/notifications";
}

function NotificationIcon({ item }: { item: Notification }) {
  if (item.context === "mention") return <MessageCircle aria-hidden="true" />;
  if (item.type === "social_reply" || item.type === "thread_reply") return <MessageCircle aria-hidden="true" />;
  if (item.type === "social_reaction" || item.type === "social_bookmark") return <Heart aria-hidden="true" />;
  if (item.type === "social_repost") return <Repeat2 aria-hidden="true" />;
  if (item.type === "followed") return <UserPlus aria-hidden="true" />;
  return <Bell aria-hidden="true" />;
}

export function NotificationsRightRail(_: { onShowFeed: () => void }) {
  const [items, setItems] = useState<Notification[]>([]);
  const [status, setStatus] = useState("通知を読み込み中…");
  const [filter, setFilter] = useState<RailFilter>("all");
  const [pending, setPending] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [threadPostDestinations, setThreadPostDestinations] = useState<Record<string, string>>({});
  const [communityMessageDestinations, setCommunityMessageDestinations] = useState<Record<string, string>>({});
  const notificationMutationInFlightRef = useRef(false);

  const load = useCallback(async () => {
    const cached = readNotificationCache();
    if (cached) {
      setItems(cached.notifications);
      setStatus("");
    }
    try {
      const response = await fetch("/api/notifications", { headers: { accept: "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as {
        notifications: Notification[];
        profiles?: Profile[];
        threadPostDestinations?: Record<string, string>;
        communityMessageDestinations?: Record<string, string>;
      };
      const notifications = payload.notifications.filter((item) => item.type !== "message_received").slice(0, 30);
      setItems(notifications);
      setProfiles(payload.profiles ?? []);
      setThreadPostDestinations(payload.threadPostDestinations ?? {});
      setCommunityMessageDestinations(payload.communityMessageDestinations ?? {});
      writeNotificationCache(notifications);
      setStatus("");
    } catch {
      setStatus("通知を読み込めませんでした。");
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  useEffect(() => {
    const synchronizeReadState = (event: Event) => {
      const detail = (event as CustomEvent<NotificationReadState>).detail;
      setItems((current) => {
        const readIds = detail.readNotificationIds
          ? new Set(detail.readNotificationIds)
          : null;
        const next = detail.all
          ? current.map((item) => ({ ...item, isRead: readIds ? readIds.has(item.id) : detail.isRead }))
          : current.map((item) => item.id === detail.notificationId
            ? { ...item, isRead: detail.isRead }
            : item);
        writeNotificationCache(next);
        return next;
      });
    };
    window.addEventListener(NOTIFICATION_READ_STATE_EVENT, synchronizeReadState);
    return () => window.removeEventListener(NOTIFICATION_READ_STATE_EVENT, synchronizeReadState);
  }, []);

  const unread = items.filter((item) => !item.isRead).length;
  const unreadRef = useRef(unread);
  const visible = useMemo(() => filter === "unread" ? items.filter((item) => !item.isRead) : items, [filter, items]);
  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles]);

  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);

  useEffect(() => {
    const refreshForNewNotifications = (event: Event) => {
      const announcedUnread = (event as CustomEvent<number>).detail;
      if (
        !notificationMutationInFlightRef.current
        && announcedUnread > unreadRef.current
        && document.visibilityState === "visible"
      ) {
        void load();
      }
    };
    window.addEventListener(NOTIFICATION_UNREAD_EVENT, refreshForNewNotifications);
    return () => window.removeEventListener(NOTIFICATION_UNREAD_EVENT, refreshForNewNotifications);
  }, [load]);

  const readAll = async () => {
    if (pending || unread === 0) return;
    setPending(true);
    notificationMutationInFlightRef.current = true;
    const previousItems = items;
    setStatus("");
    publishNotificationReadState({ isRead: true, unreadCount: 0, all: true });
    try {
      const response = await fetch("/api/notifications/read-all", { method: "POST" });
      if (!response.ok) throw new Error();
      const payload = await response.json() as { unreadCount?: number };
      publishNotificationReadState({ isRead: true, unreadCount: payload.unreadCount ?? 0, all: true });
    } catch {
      setItems(previousItems);
      writeNotificationCache(previousItems);
      publishNotificationReadState({
        isRead: false,
        unreadCount: unread,
        all: true,
        readNotificationIds: previousItems.filter((item) => item.isRead).map((item) => item.id),
      });
      setStatus("既読にできませんでした。");
    } finally {
      notificationMutationInFlightRef.current = false;
      setPending(false);
    }
  };

  const openItem = (item: Notification) => {
    if (item.isRead) return;
    notificationMutationInFlightRef.current = true;
    const optimisticUnread = Math.max(0, unread - 1);
    publishNotificationReadState({ notificationId: item.id, isRead: true, unreadCount: optimisticUnread });
    void fetch(`/api/notifications/${encodeURIComponent(item.id)}/read`, { method: "POST" })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        const payload = await response.json() as { unreadCount?: number };
        publishNotificationReadState({
          notificationId: item.id,
          isRead: true,
          unreadCount: payload.unreadCount ?? optimisticUnread,
        });
      })
      .catch(() => {
        publishNotificationReadState({ notificationId: item.id, isRead: false, unreadCount: unread });
        setStatus("既読にできませんでした。");
      })
      .finally(() => { notificationMutationInFlightRef.current = false; });
  };

  return <aside className="notifications-right-rail" aria-label="通知">
    <header>
      <div><h2>通知</h2><small>{unread ? `未読 ${unread}件` : "すべて確認済み"}</small></div>
      <div className="notifications-right-rail__actions">
        <button type="button" onClick={() => { void load(); }} aria-label="通知を更新" title="更新"><RefreshCw aria-hidden="true" /></button>
        <button type="button" onClick={readAll} disabled={pending || unread === 0} aria-label="すべて既読" title="すべて既読"><CheckCheck aria-hidden="true" /></button>
      </div>
    </header>
    <nav className="notifications-right-rail__filters" aria-label="通知の絞り込み">
      <button type="button" className={filter === "all" ? "is-selected" : ""} onClick={() => setFilter("all")}>すべて <span>{items.length}</span></button>
      <button type="button" className={filter === "unread" ? "is-selected" : ""} onClick={() => setFilter("unread")}>未読 <span>{unread}</span></button>
    </nav>
    {status ? <p className="notifications-right-rail__status" role="status">{status}</p> : null}
    <div className="notifications-right-rail__list">
      {visible.map((item) => <Link key={item.id} href={destination(item, profileMap, threadPostDestinations, communityMessageDestinations)} onClick={() => openItem(item)} className={item.isRead ? "" : "is-unread"}>
        <span className="notifications-right-rail__icon"><NotificationIcon item={item} /></span>
        <span className="notifications-right-rail__copy"><strong>{item.text}</strong><time dateTime={item.createdAt}>{formatRelativeJst(item.createdAt)}</time></span>
        {!item.isRead ? <span className="notifications-right-rail__unread" aria-label="未読" /> : null}
      </Link>)}
      {!status && visible.length === 0 ? <p>{filter === "unread" ? "未読通知はありません。" : "新しい通知はありません。"}</p> : null}
    </div>
    <Link className="notifications-right-rail__all" href="/notifications">通知を管理する</Link>
  </aside>;
}
