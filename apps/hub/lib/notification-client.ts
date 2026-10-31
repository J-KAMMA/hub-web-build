export const NOTIFICATION_UNREAD_EVENT = "hub:notification-unread-changed";
export const NOTIFICATION_READ_STATE_EVENT = "hub:notification-read-state-changed";
export const MESSAGE_UNREAD_EVENT = "hub:message-unread-changed";
export const ACTIVITY_UNREAD_EVENT = "hub:activity-unread-changed";

export type NotificationReadState = {
  notificationId?: string;
  isRead: boolean;
  unreadCount: number;
  all?: boolean;
  readNotificationIds?: string[];
};

export type ActivityUnreadCounts = {
  notificationCount: number;
  messageCount: number;
};

export function publishNotificationUnreadCount(count: number) {
  if (typeof window === "undefined") return;
  const unreadCount = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
  window.dispatchEvent(new CustomEvent<number>(NOTIFICATION_UNREAD_EVENT, { detail: unreadCount }));
}

export function publishNotificationReadState(state: NotificationReadState) {
  if (typeof window === "undefined") return;
  const detail: NotificationReadState = {
    notificationId: state.notificationId,
    isRead: state.isRead,
    unreadCount: normalizeUnreadCount(state.unreadCount),
    all: state.all === true,
    readNotificationIds: state.readNotificationIds,
  };
  window.dispatchEvent(new CustomEvent<NotificationReadState>(NOTIFICATION_READ_STATE_EVENT, { detail }));
  publishNotificationUnreadCount(detail.unreadCount);
}

export function publishMessageUnreadCount(count: number) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<number>(MESSAGE_UNREAD_EVENT, {
    detail: normalizeUnreadCount(count),
  }));
}

export function publishActivityUnreadCounts(counts: ActivityUnreadCounts) {
  if (typeof window === "undefined") return;
  const detail = {
    notificationCount: normalizeUnreadCount(counts.notificationCount),
    messageCount: normalizeUnreadCount(counts.messageCount),
  };
  window.dispatchEvent(new CustomEvent<ActivityUnreadCounts>(ACTIVITY_UNREAD_EVENT, { detail }));
  publishNotificationUnreadCount(detail.notificationCount);
  publishMessageUnreadCount(detail.messageCount);
}

function normalizeUnreadCount(count: number) {
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}
