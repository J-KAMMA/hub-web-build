import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import {
  getD1DirectMessagePreferences,
  getD1NotificationPreferences,
  setD1DirectMessagePreferences,
  setD1NotificationPreferences,
  type DirectMessageReceivePolicy,
  type NotificationPreferences,
} from "@/lib/server/d1-direct-messages";
import { HubSuspendedError } from "@/lib/server/hub-session";

const NOTIFICATION_KEYS = [
  "replies", "reactions", "follows", "messages",
  "commercePayments", "commerceDelivery", "commerceReturns",
] as const;

type MutedTermRow = { term: string };
type SensitiveRow = { show_sensitive: number };

async function getContentSafety(database: ReturnType<typeof getHubD1>, profileId: string) {
  const [terms, pref] = await Promise.all([
    database.prepare(
      "SELECT term FROM profile_muted_terms WHERE profile_id=? ORDER BY term",
    ).bind(profileId).all<MutedTermRow>(),
    database.prepare(
      "SELECT show_sensitive FROM profile_content_preferences WHERE profile_id=?",
    ).bind(profileId).first<SensitiveRow>(),
  ]);
  return { terms: terms.results.map((row) => row.term), showSensitive: Boolean(pref?.show_sensitive) };
}

async function setContentSafety(
  database: ReturnType<typeof getHubD1>,
  profileId: string,
  terms: string[],
  showSensitive: boolean,
) {
  const now = new Date().toISOString();
  await database.batch([
    database.prepare("DELETE FROM profile_muted_terms WHERE profile_id=?").bind(profileId),
    ...terms.map((term) => database.prepare(
      "INSERT INTO profile_muted_terms(profile_id,term,created_at) VALUES(?,?,?)",
    ).bind(profileId, term, now)),
    database.prepare(`INSERT INTO profile_content_preferences(profile_id,show_sensitive,updated_at)
      VALUES(?,?,?) ON CONFLICT(profile_id) DO UPDATE SET
      show_sensitive=excluded.show_sensitive,updated_at=excluded.updated_at`)
      .bind(profileId, showSensitive ? 1 : 0, now),
  ]);
}

function settingsError(error: unknown) {
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  if (error instanceof HubSuspendedError) {
    return NextResponse.json({ error: "suspended" }, { status: 403 });
  }
  if (error instanceof DesktopHubAuthenticationError) {
    return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401 });
  }
  throw error;
}

/**
 * クライアント向けの設定面。Web /api/settings/notifications と
 * /api/settings/content-safety を1つの面に畳んだもの——
 * 通知7種・DM受信範囲・ミュート語・センシティブ表示。
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const [notifications, directMessages, contentSafety] = await Promise.all([
      getD1NotificationPreferences(database, viewer.id),
      getD1DirectMessagePreferences(database, viewer.id),
      getContentSafety(database, viewer.id),
    ]);
    return NextResponse.json(
      { notifications, directMessages, contentSafety },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return settingsError(error);
  }
}

export async function PATCH(request: Request) {
  const body = await request.json().catch(() => null) as {
    notifications?: Partial<NotificationPreferences>;
    directMessages?: DirectMessageReceivePolicy;
    mutedTerms?: unknown;
    showSensitive?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "設定を確認してください。" }, { status: 400 });
  }
  if (body.directMessages && !new Set(["mutuals", "following", "nobody"]).has(body.directMessages)) {
    return NextResponse.json({ error: "DM受信設定が不正です。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const current = await getD1NotificationPreferences(database, viewer.id);
    const notifications = Object.fromEntries(
      NOTIFICATION_KEYS.map((key) => [
        key,
        typeof body.notifications?.[key] === "boolean" ? body.notifications[key] : current[key],
      ]),
    ) as NotificationPreferences;
    await setD1NotificationPreferences(database, viewer.id, notifications);
    const directMessages = body.directMessages
      ? await setD1DirectMessagePreferences(database, viewer.id, body.directMessages)
      : await getD1DirectMessagePreferences(database, viewer.id);
    if (body.mutedTerms !== undefined || body.showSensitive !== undefined) {
      const existing = await getContentSafety(database, viewer.id);
      const terms = Array.isArray(body.mutedTerms)
        ? [...new Set(body.mutedTerms.map((t) => String(t).trim()).filter((t) => t.length >= 2 && t.length <= 80))].slice(0, 50)
        : existing.terms;
      const showSensitive = typeof body.showSensitive === "boolean" ? body.showSensitive : existing.showSensitive;
      await setContentSafety(database, viewer.id, terms, showSensitive);
    }
    return NextResponse.json({
      notifications,
      directMessages,
      contentSafety: await getContentSafety(database, viewer.id),
    });
  } catch (error) {
    return settingsError(error);
  }
}
