import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  getD1DirectMessagePreferences,
  getD1NotificationPreferences,
  setD1DirectMessagePreferences,
  setD1NotificationPreferences,
  type DirectMessageReceivePolicy,
  type NotificationPreferences,
} from "@/lib/server/d1-direct-messages";

function settingsError(error: unknown) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json(
      { error: "通知設定を読み込めません。しばらくしてから再度お試しください。" },
      { status: 503 },
    );
  }
  throw error;
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const [notifications, directMessages] = await Promise.all([
      getD1NotificationPreferences(database, viewer.id),
      getD1DirectMessagePreferences(database, viewer.id),
    ]);
    return NextResponse.json({ notifications, directMessages });
  } catch (error) {
    return settingsError(error);
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const body = await request.json().catch(() => null) as {
    notifications?: Partial<NotificationPreferences>;
    directMessages?: DirectMessageReceivePolicy;
  } | null;
  if (!body) return NextResponse.json({ error: "設定を確認してください。" }, { status: 400 });
  const directMessages = body.directMessages;
  if (directMessages && !new Set(["mutuals", "following", "nobody"]).has(directMessages)) {
    return NextResponse.json({ error: "DM受信設定が不正です。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const current = await getD1NotificationPreferences(database, viewer.id);
    const notifications = {
      replies: typeof body.notifications?.replies === "boolean" ? body.notifications.replies : current.replies,
      reactions: typeof body.notifications?.reactions === "boolean" ? body.notifications.reactions : current.reactions,
      follows: typeof body.notifications?.follows === "boolean" ? body.notifications.follows : current.follows,
      messages: typeof body.notifications?.messages === "boolean" ? body.notifications.messages : current.messages,
      commercePayments: typeof body.notifications?.commercePayments === "boolean" ? body.notifications.commercePayments : current.commercePayments,
      commerceDelivery: typeof body.notifications?.commerceDelivery === "boolean" ? body.notifications.commerceDelivery : current.commerceDelivery,
      commerceReturns: typeof body.notifications?.commerceReturns === "boolean" ? body.notifications.commerceReturns : current.commerceReturns,
    };
    await setD1NotificationPreferences(database, viewer.id, notifications);
    const savedDirectMessages = directMessages
      ? await setD1DirectMessagePreferences(database, viewer.id, directMessages)
      : await getD1DirectMessagePreferences(database, viewer.id);
    return NextResponse.json({ notifications, directMessages: savedDirectMessages });
  } catch (error) {
    return settingsError(error);
  }
}
