import type { Notification, NotificationType, Profile } from "@/lib/domain";

/*
 * 通知の純粋な計算。既存の notifications-panel.tsx にあった写像を lib へ出す。
 * サーバー（頁の最初の絞り込み）とクライアント（既読・取り直し）の両方から使う。
 *
 * 行き先は v2 の画面があればそこへ、無ければ既存へ。
 */

export type V2NotificationTab = "all" | "unread" | "feed" | "mentions" | "community" | "system";

/* メンション欄の1頁の件数。サーバーの頁と「もっと見る」で同じ。 */
export const MENTIONS_PAGE_SIZE = 30;

export const V2_NOTIFICATION_TABS: { id: V2NotificationTab; ja: string; en: string }[] = [
  { id: "all", ja: "すべて", en: "All" },
  { id: "unread", ja: "未読", en: "Unread" },
  { id: "feed", ja: "フィード", en: "Feed" },
  { id: "mentions", ja: "メンション", en: "Mentions" },
  { id: "community", ja: "コミュニティ", en: "Community" },
  { id: "system", ja: "お知らせ", en: "System" },
];

export const V2_NOTIFICATION_LABELS: Record<NotificationType, { ja: string; en: string }> = {
  social_reply: { ja: "返信", en: "Reply" },
  social_repost: { ja: "リポスト", en: "Repost" },
  social_reaction: { ja: "リアクション", en: "Reaction" },
  social_bookmark: { ja: "保存", en: "Bookmark" },
  thread_reply: { ja: "スレッドへの返信", en: "Thread reply" },
  message_received: { ja: "メッセージ", en: "Message" },
  followed: { ja: "新しいフォロワー", en: "New follower" },
  system: { ja: "Hubからのお知らせ", en: "From Hub" },
};

export function notificationLabel(notification: Notification, japanese: boolean): string {
  if (notification.context === "mention") return japanese ? "メンション" : "Mention";
  const label = V2_NOTIFICATION_LABELS[notification.type];
  /* 知らない種類が届いても画面全体を落とさない。 */
  if (!label) return japanese ? "通知" : "Notification";
  return japanese ? label.ja : label.en;
}

/* 自分宛てのメンションと返信。サーバー側の絞り込み（d1-notifications の MENTIONS_SCOPE）と同じ。 */
export function isMentionOrReplyNotification(notification: Notification): boolean {
  return notification.context === "mention" || notification.type === "social_reply" || notification.type === "thread_reply";
}

/* 既存の isFeedNotification / isCommunityNotification と同じ。 */
export function matchesNotificationTab(notification: Notification, tab: V2NotificationTab): boolean {
  if (tab === "unread") return !notification.isRead;
  if (tab === "feed") return notification.targetType === "social_post" || notification.targetType === "profile" || notification.type === "followed";
  if (tab === "mentions") return isMentionOrReplyNotification(notification);
  if (tab === "community") return notification.targetType === "community_message";
  if (tab === "system") return notification.type === "system";
  return true;
}

export function matchesNotificationQuery(notification: Notification, actor: Profile | undefined, query: string): boolean {
  const normalized = query.normalize("NFKC").trim().toLocaleLowerCase("ja");
  if (!normalized) return true;
  return `${notification.text} ${actor?.displayName ?? ""} ${actor?.handle ?? ""}`.normalize("NFKC").toLocaleLowerCase("ja").includes(normalized);
}

/*
 * 行き先。既存の notificationHref と同じ判定で、v2 に画面があるものは v2 へ。
 * system の targetId は「/」で始まる道だけ信じる（既存と同じ守り）。
 */
export function notificationHref(
  notification: Notification,
  profiles: Map<string, Profile>,
  threadPostDestinations: Record<string, string>,
  communityMessageDestinations: Record<string, string>,
): string {
  const { targetType, targetId } = notification;
  if (targetType === "system" && targetId.startsWith("/") && !targetId.startsWith("//") && !targetId.includes("\\")) {
    return targetId.split("#event=")[0];
  }
  if (targetType === "message_conversation") return `/messages?conversation=${targetId}`;
  if (targetType === "profile") {
    const profile = profiles.get(targetId);
    return profile ? `/profile/${profile.handle}` : "/v2/community";
  }
  if (targetType === "thread") return `/v2/threads/${targetId}`;
  if (targetType === "thread_post") return (threadPostDestinations[targetId] ?? "/bbs").replace(/^\/threads\//, "/v2/threads/");
  if (targetType === "community_message") return (communityMessageDestinations[targetId] ?? "/community").replace(/^\/community\?/, "/v2/community?");
  if (targetType === "social_post") return `/v2/posts/${targetId}`;
  return "/about";
}

/*
 * 通知の粒（2026-09-03、旦那様「ほかに必要なuiは」→「やって」の5手目）。
 * 同じ投稿へのいいね・リポスト・保存と、フォローは、1件ずつ並べると件数が増えたとき
 * 読めない。同じ的（type × targetType × targetId）に来たものを1行にまとめる。
 * 返信・メンション・お知らせは本文が違うのでまとめない。
 */
const GROUPED_TYPES: ReadonlySet<NotificationType> = new Set(["social_reaction", "social_repost", "social_bookmark", "followed"]);

export type NotificationGroup = {
  key: string;
  latest: Notification;
  items: Notification[];
  actorIds: string[];
  isRead: boolean;
};

export function groupNotifications(items: Notification[]): NotificationGroup[] {
  const groups = new Map<string, NotificationGroup>();
  const order: NotificationGroup[] = [];
  for (const item of items) {
    const groupable = GROUPED_TYPES.has(item.type) && !item.context;
    const key = groupable ? `${item.type}:${item.targetType}:${item.targetId}` : `one:${item.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      if (item.actorProfileId && !existing.actorIds.includes(item.actorProfileId)) existing.actorIds.push(item.actorProfileId);
      if (!item.isRead) existing.isRead = false;
      if (Date.parse(item.createdAt) > Date.parse(existing.latest.createdAt)) existing.latest = item;
      continue;
    }
    const group: NotificationGroup = { key, latest: item, items: [item], actorIds: item.actorProfileId ? [item.actorProfileId] : [], isRead: item.isRead };
    groups.set(key, group);
    order.push(group);
  }
  return order.sort((left, right) => Date.parse(right.latest.createdAt) - Date.parse(left.latest.createdAt));
}

/* まとめた行の文。「AさんとBさん、ほか3人があなたの投稿にいいねしました」 */
export function groupedNotificationText(group: NotificationGroup, names: string[], japanese: boolean): string {
  if (group.items.length === 1 || names.length === 0) return group.latest.text;
  const shown = names.slice(0, 2);
  const rest = group.actorIds.length - shown.length;
  const who = japanese
    ? `${shown.map((name) => `${name}さん`).join("と")}${rest > 0 ? `、ほか${rest}人` : ""}`
    : `${shown.join(" and ")}${rest > 0 ? ` and ${rest} more` : ""}`;
  const verb: Record<string, { ja: string; en: string }> = {
    social_reaction: { ja: "があなたの投稿にいいねしました", en: " liked your post" },
    social_repost: { ja: "があなたの投稿をリポストしました", en: " reposted your post" },
    social_bookmark: { ja: "があなたの投稿を保存しました", en: " saved your post" },
    followed: { ja: "があなたをフォローしました", en: " followed you" },
  };
  const tail = verb[group.latest.type] ?? { ja: "", en: "" };
  return japanese ? `${who}${tail.ja}` : `${who}${tail.en}`;
}
