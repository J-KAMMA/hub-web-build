import "server-only";

import type { Notification } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  countD1UnreadNotifications,
  getD1CommunityMessageDestinations,
  getD1NotificationActors,
  getD1ThreadPostDestinations,
  listD1NotificationsPage,
  markAllD1NotificationsRead,
  markD1NotificationRead,
} from "@/lib/server/d1-notifications";
import { MENTIONS_PAGE_SIZE } from "@/lib/v2-notifications";
import { countD1UnreadDirectMessages } from "@/lib/server/d1-direct-messages";

export interface NotificationsRouteData {
  notifications: Notification[];
  unreadCount: number;
  profiles: Awaited<ReturnType<typeof getD1NotificationActors>>;
  threadPostDestinations: Record<string, string>;
  communityMessageDestinations: Record<string, string>;
  /** filter=mentions のときだけ。続きが無ければ null。 */
  nextCursor?: string | null;
}

export interface ActivityUnreadCountsRouteData {
  notificationCount: number;
  messageCount: number;
}

async function authenticated(request: Request) {
  const database = getHubD1();
  return { database, viewer: await requireHubSessionProfile(request, database) };
}

export async function getNotificationsRouteData(request: Request): Promise<NotificationsRouteData> {
  const { database, viewer } = await authenticated(request);
  const params = new URL(request.url).searchParams;
  const mentions = params.get("filter") === "mentions";
  const [page, unreadCount] = await Promise.all([
    listD1NotificationsPage(database, viewer.id, mentions
      ? { excludeMessageReceived: true, excerpts: true, filter: "mentions", cursor: params.get("cursor"), limit: MENTIONS_PAGE_SIZE }
      : { excludeMessageReceived: true, excerpts: true }),
    countD1UnreadNotifications(database, viewer.id, { excludeMessageReceived: true }),
  ]);
  const notifications = page.notifications;
  const [profiles, threadPostDestinations, communityMessageDestinations] = await Promise.all([
    getD1NotificationActors(database, notifications),
    getD1ThreadPostDestinations(database, notifications),
    getD1CommunityMessageDestinations(database, notifications),
  ]);
  return {
    notifications,
    unreadCount,
    profiles,
    threadPostDestinations,
    communityMessageDestinations,
    ...(mentions ? { nextCursor: page.nextCursor } : {}),
  };
}

export async function getActivityUnreadCountsRouteData(
  request: Request,
): Promise<ActivityUnreadCountsRouteData> {
  const { database, viewer } = await authenticated(request);
  const [notificationCount, messageCount] = await Promise.all([
    countD1UnreadNotifications(database, viewer.id, { excludeMessageReceived: true }),
    countD1UnreadDirectMessages(database, viewer.id),
  ]);
  return { notificationCount, messageCount };
}

export async function markAllNotificationsReadRouteData(request: Request): Promise<NotificationsRouteData> {
  const { database, viewer } = await authenticated(request);
  const notifications = await markAllD1NotificationsRead(database, viewer.id, {
    excludeMessageReceived: true,
    excerpts: true,
  });
  const [profiles, threadPostDestinations, communityMessageDestinations] = await Promise.all([
    getD1NotificationActors(database, notifications),
    getD1ThreadPostDestinations(database, notifications),
    getD1CommunityMessageDestinations(database, notifications),
  ]);
  return {
    notifications,
    unreadCount: 0,
    profiles,
    threadPostDestinations,
    communityMessageDestinations,
  };
}

export interface MarkNotificationReadRouteData {
  notification: Notification | undefined;
  unreadCount: number;
}

export async function markNotificationReadRouteData(request: Request, notificationId: string): Promise<MarkNotificationReadRouteData> {
  const { database, viewer } = await authenticated(request);
  const notification = await markD1NotificationRead(database, viewer.id, notificationId);
  const unreadCount = await countD1UnreadNotifications(database, viewer.id, {
    excludeMessageReceived: true,
  });
  return {
    notification,
    unreadCount,
  };
}
