import "server-only";

import { headers } from "next/headers";

import { Notification, Profile } from "@/lib/domain";
import { MENTIONS_PAGE_SIZE } from "@/lib/v2-notifications";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { countD1UnreadDirectMessages } from "@/lib/server/d1-direct-messages";
import {
  countD1UnreadNotifications,
  getD1CommunityMessageDestinations,
  getD1NotificationActors,
  getD1ThreadPostDestinations,
  listD1Notifications,
  listD1NotificationsPage,
} from "@/lib/server/d1-notifications";

export interface NotificationsPageData {
  notificationCount: number;
  messageCount: number;
  notifications: Notification[];
  profiles: Profile[];
  threadPostDestinations: Record<string, string>;
  communityMessageDestinations: Record<string, string>;
  /** tab=mentions のときだけ。SQLで絞った最初の頁と続きの位置。 */
  mentions?: { notifications: Notification[]; nextCursor: string | null };
}

export async function getNotificationsPageData(options: { mentions?: boolean } = {}): Promise<NotificationsPageData | null> {
  const database = getHubD1();
  const currentProfile = await getOptionalHubSessionProfile(
    new Request("http://hub.local/notifications", { headers: await headers() }),
    database,
  );
  if (!currentProfile) return null;
  const notifications = await listD1Notifications(database, currentProfile.id, {
    excludeMessageReceived: true,
    excerpts: true,
  });
  const mentions = options.mentions
    ? await listD1NotificationsPage(database, currentProfile.id, { excludeMessageReceived: true, excerpts: true, filter: "mentions", limit: MENTIONS_PAGE_SIZE })
    : undefined;
  const known = mentions ? [...notifications, ...mentions.notifications.filter((item) => !notifications.some((other) => other.id === item.id))] : notifications;
  const [notificationCount, messageCount, profiles, threadPostDestinations, communityMessageDestinations] = await Promise.all([
    countD1UnreadNotifications(database, currentProfile.id, { excludeMessageReceived: true }),
    countD1UnreadDirectMessages(database, currentProfile.id),
    getD1NotificationActors(database, known),
    getD1ThreadPostDestinations(database, known),
    getD1CommunityMessageDestinations(database, known),
  ]);

  return {
    notificationCount,
    messageCount,
    notifications,
    profiles,
    threadPostDestinations,
    communityMessageDestinations,
    ...(mentions ? { mentions } : {}),
  };
}
