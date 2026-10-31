"use client";

import React, { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bookmark,
  CheckCheck,
  Heart,
  Info,
  Mail,
  MessageCircleReply,
  Repeat2,
  Search,
  UserPlus,
  X,
  type LucideIcon,
} from "lucide-react";

import { Notification, NotificationType, Profile } from "@/lib/domain";
import { formatRelativeJst } from "@/lib/format";
import {
  NOTIFICATION_UNREAD_EVENT,
  publishNotificationReadState,
  publishNotificationUnreadCount,
} from "@/lib/notification-client";
import { commerceApiUrl } from "@/lib/commerce-client";
import { UiButton, UiInput, UiStatePanel } from "@/components/ui/primitives";

type Filter = "all" | "unread" | "feed" | "community" | "system";

const COMMERCE_NOTIFICATION_PREFIX = "commerce:";
const COMMERCE_ORDER_TOKEN_PREFIX = "hub.shopping.order-token.";
const COMMERCE_READ_KEY = "hub.commerce.notification-read.v1";
const COMMERCE_BUYER_EVENT_TYPES = new Set([
  "payment.settled",
  "payment.settled_tax_pending",
  "fulfillment.created",
  "fulfillment.delivered",
  "shipment.processing",
  "shipment.shipped",
  "return.requested",
  "return.approved",
  "return.received",
  "return.rejected",
  "escrow.shipped",
  "escrow.released",
  "escrow.refunded",
  "escrow.disputed",
  "escrow.resolution_proposed",
  "escrow.resolved",
  "refund_seller_confirmed",
  "refund_attempt_rejected",
  "refund_confirmed",
  "order.cancelled",
]);
type CommerceNotificationPreferences = {
  commercePayments: boolean;
  commerceDelivery: boolean;
  commerceReturns: boolean;
};
const DEFAULT_COMMERCE_PREFERENCES: CommerceNotificationPreferences = {
  commercePayments: true,
  commerceDelivery: true,
  commerceReturns: true,
};

function commerceEventEnabled(
  eventType: string,
  preferences: CommerceNotificationPreferences,
) {
  if (eventType.startsWith("payment.") || eventType === "order.cancelled")
    return preferences.commercePayments;
  if (eventType.startsWith("fulfillment.") || eventType.startsWith("shipment."))
    return preferences.commerceDelivery;
  if (eventType.startsWith("return.")) return preferences.commerceReturns;
  // Refund and escrow events can represent an asset movement or frozen payment.
  return eventType.startsWith("refund_") || eventType.startsWith("escrow.");
}

function commerceReadIds() {
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(COMMERCE_READ_KEY) ?? "[]",
    );
    return new Set(
      Array.isArray(value)
        ? value
            .filter((item): item is string => typeof item === "string")
            .slice(-500)
        : [],
    );
  } catch {
    return new Set<string>();
  }
}

function saveCommerceReadIds(ids: Set<string>) {
  window.sessionStorage.setItem(
    COMMERCE_READ_KEY,
    JSON.stringify([...ids].slice(-500)),
  );
}

async function loadCommerceNotifications(): Promise<Notification[]> {
  const preferenceResponse = await fetch("/api/settings/notifications", {
    cache: "no-store",
    credentials: "same-origin",
  }).catch(() => null);
  const preferencePayload = preferenceResponse?.ok
    ? ((await preferenceResponse.json().catch(() => null)) as {
        notifications?: Partial<CommerceNotificationPreferences>;
      } | null)
    : null;
  const preferences: CommerceNotificationPreferences = {
    commercePayments:
      preferencePayload?.notifications?.commercePayments ??
      DEFAULT_COMMERCE_PREFERENCES.commercePayments,
    commerceDelivery:
      preferencePayload?.notifications?.commerceDelivery ??
      DEFAULT_COMMERCE_PREFERENCES.commerceDelivery,
    commerceReturns:
      preferencePayload?.notifications?.commerceReturns ??
      DEFAULT_COMMERCE_PREFERENCES.commerceReturns,
  };
  const orders: Array<{ orderId: string; accessToken: string }> = [];
  for (
    let index = 0;
    index < window.sessionStorage.length && orders.length < 100;
    index += 1
  ) {
    const key = window.sessionStorage.key(index);
    if (!key?.startsWith(COMMERCE_ORDER_TOKEN_PREFIX)) continue;
    const accessToken = window.sessionStorage.getItem(key);
    if (accessToken)
      orders.push({
        orderId: key.slice(COMMERCE_ORDER_TOKEN_PREFIX.length),
        accessToken,
      });
  }
  const read = commerceReadIds();
  const results = await Promise.allSettled(
    orders.map(async ({ orderId, accessToken }) => {
      const response = await fetch(
        commerceApiUrl(`/orders/${encodeURIComponent(orderId)}`),
        {
          headers: { authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        },
      );
      if (!response.ok) return [];
      const body = (await response.json()) as {
        events?: Array<{
          id: string;
          eventType: string;
          publicMessage: string;
          createdAt: string;
        }>;
      };
      return (body.events ?? [])
        .filter(
          (event) =>
            COMMERCE_BUYER_EVENT_TYPES.has(event.eventType) &&
            commerceEventEnabled(event.eventType, preferences),
        )
        .map((event): Notification => {
          const id = `${COMMERCE_NOTIFICATION_PREFIX}${event.id}`;
          return {
            id,
            receiverProfileId: "",
            actorProfileId: null,
            type: "system",
            targetType: "system",
            targetId: `/market/orders/${encodeURIComponent(orderId)}#event=${encodeURIComponent(event.eventType)}`,
            text: event.publicMessage,
            isRead: read.has(id),
            createdAt: event.createdAt,
          };
        });
    }),
  );
  return results.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
}

const notificationMeta: Record<
  NotificationType,
  { icon: LucideIcon; label: string; detail: string }
> = {
  social_reply: {
    icon: MessageCircleReply,
    label: "ポストへの返信",
    detail: "会話を確認",
  },
  thread_reply: {
    icon: MessageCircleReply,
    label: "スレッドへの返信",
    detail: "スレッドを確認",
  },
  social_repost: { icon: Repeat2, label: "リポスト", detail: "ポストを確認" },
  social_reaction: { icon: Heart, label: "リアクション", detail: "反応を確認" },
  social_bookmark: { icon: Bookmark, label: "保存", detail: "ポストを確認" },
  followed: {
    icon: UserPlus,
    label: "新しいフォロワー",
    detail: "プロフィールを確認",
  },
  message_received: { icon: Mail, label: "メッセージ", detail: "会話を開く" },
  system: { icon: Info, label: "Hubからのお知らせ", detail: "内容を確認" },
};

function notificationPresentation(notification: Notification) {
  if (notification.context === "mention") {
    return {
      icon: MessageCircleReply,
      label: "メンション",
      detail: "投稿を確認",
    };
  }
  return notificationMeta[notification.type];
}

function notificationHref(
  notification: Notification,
  profiles: Map<string, Profile>,
  threadPostDestinations: Record<string, string>,
  communityMessageDestinations: Record<string, string>,
) {
  if (
    notification.targetType === "system" &&
    notification.targetId.startsWith("/") &&
    !notification.targetId.startsWith("//") &&
    !notification.targetId.includes("\\")
  )
    return notification.targetId.split("#event=")[0];
  if (notification.targetType === "message_conversation")
    return `/messages?conversation=${notification.targetId}`;
  if (notification.targetType === "profile") {
    const profile = profiles.get(notification.targetId);
    return profile ? `/profile/${profile.handle}` : "/community";
  }
  if (notification.targetType === "thread")
    return `/threads/${notification.targetId}`;
  if (notification.targetType === "thread_post")
    return threadPostDestinations[notification.targetId] ?? "/bbs";
  if (notification.targetType === "community_message")
    return communityMessageDestinations[notification.targetId] ?? "/community";
  if (notification.targetType === "social_post")
    return `/posts/${notification.targetId}`;
  return "/about";
}

function isCommunityNotification(notification: Notification) {
  return notification.targetType === "community_message";
}

function isFeedNotification(notification: Notification) {
  return (
    notification.targetType === "social_post" ||
    notification.targetType === "profile" ||
    notification.type === "followed"
  );
}

function notificationPriority(notification: Notification) {
  const importance: Partial<Record<NotificationType, number>> = {
    message_received: 50,
    social_reply: 40,
    thread_reply: 40,
    followed: 25,
    social_reaction: 15,
    social_repost: 12,
    social_bookmark: 10,
    system: 8,
  };
  return (
    (!notification.isRead ? 100 : 0) +
    (importance[notification.type] ?? 0) +
    Date.parse(notification.createdAt) / 1e12
  );
}

export function NotificationsPanel({
  initialNotifications,
  profiles,
  threadPostDestinations,
  communityMessageDestinations = {},
}: {
  initialNotifications: Notification[];
  profiles: Profile[];
  threadPostDestinations: Record<string, string>;
  communityMessageDestinations?: Record<string, string>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(() =>
    initialNotifications
      .filter((item) => item.type !== "message_received")
      .sort(
        (left, right) =>
          Date.parse(right.createdAt) - Date.parse(left.createdAt),
      ),
  );
  const [filter, setFilter] = useState<Filter>("all");
  /* The page-left column's phone drawer (the shared bbs-* column contract). */
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [visibleCount, setVisibleCount] = useState(20);
  const [pending, setPending] = useState(false);
  const [knownProfiles, setKnownProfiles] = useState(profiles);
  const [knownThreadPostDestinations, setKnownThreadPostDestinations] =
    useState(threadPostDestinations);
  const [
    knownCommunityMessageDestinations,
    setKnownCommunityMessageDestinations,
  ] = useState(communityMessageDestinations);
  const profileMap = useMemo(
    () => new Map(knownProfiles.map((profile) => [profile.id, profile])),
    [knownProfiles],
  );
  const unread = items.filter((notification) => !notification.isRead).length;
  const unreadRef = useRef(unread);

  useEffect(() => {
    unreadRef.current = unread;
  }, [unread]);

  useEffect(() => {
    let active = true;
    void loadCommerceNotifications().then((commerceItems) => {
      if (!active || !commerceItems.length) return;
      setItems((current) => {
        const commerceIds = new Set(commerceItems.map((item) => item.id));
        return [
          ...current.filter((item) => !commerceIds.has(item.id)),
          ...commerceItems,
        ].sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt),
        );
      });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    publishNotificationUnreadCount(unread);
  }, [unread]);

  useEffect(() => {
    let requestInFlight = false;
    let controller: AbortController | null = null;
    const refreshForNewNotifications = (event: Event) => {
      const announcedUnread = (event as CustomEvent<number>).detail;
      if (
        document.visibilityState === "hidden" ||
        announcedUnread <= unreadRef.current ||
        requestInFlight
      )
        return;
      requestInFlight = true;
      controller?.abort();
      controller = new AbortController();
      void fetch("/api/notifications", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then((response) => {
          if (!response.ok) throw new Error();
          return response.json() as Promise<{
            notifications: Notification[];
            profiles?: Profile[];
            threadPostDestinations?: Record<string, string>;
            communityMessageDestinations?: Record<string, string>;
          }>;
        })
        .then((payload) => {
          setItems((current) => {
            const commerce = current.filter((item) =>
              item.id.startsWith(COMMERCE_NOTIFICATION_PREFIX),
            );
            return [
              ...payload.notifications.filter(
                (item) => item.type !== "message_received",
              ),
              ...commerce,
            ].sort(
              (left, right) =>
                Date.parse(right.createdAt) - Date.parse(left.createdAt),
            );
          });
          setKnownProfiles(payload.profiles ?? []);
          setKnownThreadPostDestinations(payload.threadPostDestinations ?? {});
          setKnownCommunityMessageDestinations(
            payload.communityMessageDestinations ?? {},
          );
        })
        .catch(() => undefined)
        .finally(() => {
          requestInFlight = false;
        });
    };
    window.addEventListener(
      NOTIFICATION_UNREAD_EVENT,
      refreshForNewNotifications,
    );
    return () => {
      controller?.abort();
      window.removeEventListener(
        NOTIFICATION_UNREAD_EVENT,
        refreshForNewNotifications,
      );
    };
  }, []);

  const filtered = items
    .filter((notification) => {
      if (filter === "unread") return !notification.isRead;
      if (filter === "feed") return isFeedNotification(notification);
      if (filter === "community") return isCommunityNotification(notification);
      if (filter === "system") return notification.type === "system";
      return true;
    })
    .filter((notification) => {
      const term = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
      return (
        !term ||
        notification.text
          .normalize("NFKC")
          .toLocaleLowerCase("ja")
          .includes(term) ||
        notificationPresentation(notification)
          .label.toLocaleLowerCase("ja")
          .includes(term)
      );
    })
    .sort(
      (left, right) => notificationPriority(right) - notificationPriority(left),
    );

  const markRead = async (notificationId: string) => {
    const target = items.find((item) => item.id === notificationId);
    if (!target || target.isRead) return;
    const optimisticUnread = Math.max(0, unread - 1);
    setItems((current) =>
      current.map((item) =>
        item.id === notificationId ? { ...item, isRead: true } : item,
      ),
    );
    publishNotificationReadState({
      notificationId,
      isRead: true,
      unreadCount: optimisticUnread,
    });
    if (notificationId.startsWith(COMMERCE_NOTIFICATION_PREFIX)) {
      const read = commerceReadIds();
      read.add(notificationId);
      saveCommerceReadIds(read);
      return;
    }
    try {
      const response = await fetch(
        `/api/notifications/${notificationId}/read`,
        { method: "POST" },
      );
      if (!response.ok) throw new Error("通知を既読にできませんでした。");
      const payload = (await response.json()) as { unreadCount: number };
      publishNotificationReadState({
        notificationId,
        isRead: true,
        unreadCount: payload.unreadCount,
      });
    } catch (readError) {
      setItems((current) =>
        current.map((item) =>
          item.id === notificationId ? { ...item, isRead: false } : item,
        ),
      );
      publishNotificationReadState({
        notificationId,
        isRead: false,
        unreadCount: unread,
      });
      throw readError;
    }
  };

  const readAll = async () => {
    if (pending || unread === 0) return;
    setPending(true);
    setError("");
    const previousItems = items;
    setItems((current) => current.map((item) => ({ ...item, isRead: true })));
    publishNotificationReadState({ isRead: true, unreadCount: 0, all: true });
    try {
      const commerceItems = items
        .filter((item) => item.id.startsWith(COMMERCE_NOTIFICATION_PREFIX))
        .map((item) => ({ ...item, isRead: true }));
      const response = await fetch("/api/notifications/read-all", {
        method: "POST",
      });
      if (!response.ok) throw new Error("通知を既読にできませんでした。");
      const payload = (await response.json()) as {
        notifications: Notification[];
        unreadCount: number;
      };
      const commerceRead = commerceReadIds();
      commerceItems.forEach((item) => commerceRead.add(item.id));
      saveCommerceReadIds(commerceRead);
      setItems(
        [
          ...payload.notifications.filter(
            (item) => item.type !== "message_received",
          ),
          ...commerceItems,
        ].sort(
          (left, right) =>
            Date.parse(right.createdAt) - Date.parse(left.createdAt),
        ),
      );
      publishNotificationReadState({
        isRead: true,
        unreadCount: payload.unreadCount,
        all: true,
      });
    } catch (readError) {
      setItems(previousItems);
      publishNotificationReadState({
        isRead: false,
        unreadCount: unread,
        all: true,
        readNotificationIds: previousItems
          .filter((item) => item.isRead)
          .map((item) => item.id),
      });
      setError(
        readError instanceof Error
          ? readError.message
          : "通知を既読にできませんでした。",
      );
    } finally {
      setPending(false);
    }
  };

  const readOne = async (notification: Notification) => {
    setError("");
    try {
      await markRead(notification.id);
    } catch (readError) {
      setError(
        readError instanceof Error
          ? readError.message
          : "通知を既読にできませんでした。",
      );
    }
  };

  const openNotification = (
    event: MouseEvent<HTMLAnchorElement>,
    notification: Notification,
  ) => {
    if (notification.isRead) return;
    event.preventDefault();
    const destination = notificationHref(
      notification,
      profileMap,
      knownThreadPostDestinations,
      knownCommunityMessageDestinations,
    );
    setError("");
    void markRead(notification.id).catch(() => {
      // Reading the linked content remains available even if the read receipt fails.
    });
    router.push(destination);
  };

  const tabs: Array<[Filter, string, number]> = [
    ["all", "すべて", items.length],
    ["unread", "未読", unread],
    ["feed", "フィード", items.filter(isFeedNotification).length],
    ["community", "コミュニティ", items.filter(isCommunityNotification).length],
    [
      "system",
      "お知らせ",
      items.filter((item) => item.type === "system").length,
    ],
  ];

  /*
   * Four-region layout: the filter belongs to the page-left column through
   * the shared bbs-* column contract, the same as the feed's switcher.
   */
  return (
    <div className="notifications-directory-layout bbs-directory-layout tab-left-column-layout">
      <button
        type="button"
        className="bbs-directory-mobile-toggle"
        onClick={() => setDirectoryOpen((open) => !open)}
        aria-controls="notifications-directory"
        aria-expanded={directoryOpen}
      >
        通知の絞り込み
      </button>
      {directoryOpen ? (
        <button type="button" className="bbs-directory-backdrop" onClick={() => setDirectoryOpen(false)} aria-label="閉じる" />
      ) : null}
      <aside
        id="notifications-directory"
        data-hub-page-left-column
        className={`notifications-directory bbs-thread-directory tab-left-column${directoryOpen ? " bbs-thread-directory--open" : ""}`}
        aria-label="通知の絞り込み"
      >
        <header className="bbs-thread-directory__header tab-left-column__header">
          <div>
            <strong>通知</strong>
          </div>
          <button type="button" onClick={() => setDirectoryOpen(false)} aria-label="閉じる">×</button>
        </header>
        <nav className="bbs-thread-directory__nav feed-directory__nav" aria-label="通知の絞り込み">
          {tabs.map(([value, label, count]) => (
            <button
              type="button"
              className={`tl-tab${filter === value ? " tl-tab--active" : ""}`}
              aria-pressed={filter === value}
              key={value}
              onClick={() => {
                setFilter(value);
                setVisibleCount(20);
                setDirectoryOpen(false);
              }}
            >
              {label} <span className="feed-directory__count">{count}</span>
            </button>
          ))}
        </nav>
      </aside>
      {/*
        本体列であることを標準の名前で宣言する。column-title-system.css は
        4列のときヘッダーのフルブリードを .tab-left-column-main の中で
        列幅へ戻すが、この列はその名前を持っていなかったため、100cqw が
        main-content の910pxを指したまま左右へ105pxずつはみ出していた。
      */}
      <div className="notifications-directory-content bbs-directory-content tab-left-column-main">
    <section className="notifications-page">
      <header>
        <div>
          <p>
            <strong>{unread}件</strong>の未読通知があります ·
            返信・メンション・反応を優先表示
          </p>
        </div>
        <button
          className="hub-icon-button"
          onClick={readAll}
          disabled={pending || !unread}
          aria-label={pending ? "処理中" : "すべて既読"}
          title={pending ? "処理中" : "すべて既読"}
        >
          <CheckCheck aria-hidden="true" />
        </button>
      </header>
      {error && (
        <p className="notifications-page__error" role="alert">
          {error}
        </p>
      )}
      <label className="notifications-page__search">
        <Search aria-hidden="true" />
        <UiInput
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setVisibleCount(20);
          }}
          placeholder="通知を検索"
          aria-label="通知を検索"
        />
        {query ? (
          <button
            type="button"
            className="hub-icon-button"
            onClick={() => setQuery("")}
            aria-label="検索をクリア"
            title="検索をクリア"
          >
            <X aria-hidden="true" />
          </button>
        ) : null}
      </label>
      <section className="notification-list" aria-live="polite">
        {filtered.slice(0, visibleCount).map((notification) => {
          const actor =
            notification.type !== "social_reaction" &&
            notification.actorProfileId
              ? profileMap.get(notification.actorProfileId)
              : undefined;
          const meta = notificationPresentation(notification);
          const NotificationIcon = meta.icon;
          return (
            <article
              key={notification.id}
              className={
                notification.isRead
                  ? "notification-row"
                  : "notification-row notification-row--unread"
              }
            >
              <a
                href={notificationHref(
                  notification,
                  profileMap,
                  knownThreadPostDestinations,
                  knownCommunityMessageDestinations,
                )}
                onClick={(event) => openNotification(event, notification)}
                className="notification-row__link"
              >
                <span
                  className={`notification-row__icon notification-row__icon--${notification.type}`}
                  aria-hidden="true"
                >
                  <NotificationIcon />
                </span>
                <span className="notification-row__content">
                  <span className="notification-row__meta">
                    <strong>{meta.label}</strong>
                    <time dateTime={notification.createdAt}>
                      {formatRelativeJst(notification.createdAt)}
                    </time>
                  </span>
                  <p>
                    {notification.type === "social_reaction"
                      ? "投稿にいいねが付きました。"
                      : notification.text}
                  </p>
                  <small>
                    {actor ? `@${actor.handle} · ` : ""}
                    {meta.detail} <span aria-hidden="true">→</span>
                  </small>
                </span>
              </a>
              {!notification.isRead && (
                <button
                  type="button"
                  className="notification-row__read"
                  onClick={() => readOne(notification)}
                  disabled={pending}
                  aria-label={`${meta.label}を既読にする`}
                  title="既読にする"
                >
                  <span aria-hidden="true" />
                </button>
              )}
            </article>
          );
        })}
        {filtered.length === 0 && (
          <UiStatePanel
            className="notification-empty"
            state="empty"
            title={filter === "unread"
              ? "未読通知はありません"
              : "この種類の通知はありません"}
            description={filter === "unread"
              ? "すべて確認済みです。"
              : "新しい通知が届くとここに表示されます。"}
          />
        )}
      </section>
      {filtered.length > visibleCount ? (
        <div className="search-load-more">
          <UiButton
            type="button"
            onClick={() =>
              setVisibleCount((count) => Math.min(200, count + 20))
            }
          >
            もっと見る
          </UiButton>
          <small>
            {visibleCount} / {filtered.length}
          </small>
        </div>
      ) : null}
    </section>
      </div>
    </div>
  );
}
