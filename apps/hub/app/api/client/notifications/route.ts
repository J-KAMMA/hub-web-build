import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  countD1UnreadNotifications,
  getD1CommunityMessageDestinations,
  getD1NotificationActors,
  getD1ThreadPostDestinations,
  listD1Notifications,
  markAllD1NotificationsRead,
  markD1NotificationRead,
} from "@/lib/server/d1-notifications";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const identifier = (value: unknown): value is string => typeof value === "string" && value.length >= 1
  && value.length <= 128 && !/[^A-Za-z0-9_-]/u.test(value);
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
class NotificationRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
function expectedViewer(request: Request) {
  if (request.headers.has("origin") && !hasSameOrigin(request)) throw new NotificationRequestError("invalid_request_origin", 403);
  const expected = request.headers.get("X-Hub-Expected-Viewer");
  if (expected !== null && !identifier(expected)) throw new NotificationRequestError("bad_request", 400);
  return expected;
}
function checkViewer(actual: unknown, expected: string | null) {
  if (!identifier(actual)) throw new NotificationRequestError("unavailable", 503);
  if (expected !== null && expected !== actual) throw new NotificationRequestError("notification_scope_changed", 409);
}
async function readInput(request: Request): Promise<{ readAll: true } | { id: string }> {
  const reader = request.body?.getReader();
  if (!reader) throw new NotificationRequestError("bad_request", 400);
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      if (value.byteLength > 4096 - length) {
        await reader.cancel().catch(() => {});
        throw new NotificationRequestError("request_too_large", 413);
      }
      if (value.byteLength) { chunks.push(value); length += value.byteLength; }
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    // A single JSON member also rejects duplicate keys before JSON.parse collapses them.
    if (!/^\s*\{\s*"[^"\\]*(?:\\.[^"\\]*)*"\s*:\s*(?:true|"[^"\\]*(?:\\.[^"\\]*)*")\s*\}\s*$/u.test(text)) throw new Error("invalid shape");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== 1) throw new Error("invalid shape");
    if (Object.hasOwn(value, "readAll") && (value as { readAll: unknown }).readAll === true) return { readAll: true };
    if (Object.hasOwn(value, "id") && identifier((value as { id: unknown }).id)) return { id: (value as { id: string }).id };
    throw new Error("invalid shape");
  } catch (error) {
    if (error instanceof NotificationRequestError) throw error;
    throw new NotificationRequestError("bad_request", 400);
  } finally { reader.releaseLock(); }
}
function failure(error: unknown) {
  if (error instanceof NotificationRequestError) return json({ error: error.code }, error.status);
  if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
  if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
  return json({ error: "unavailable" }, 503);
}

/**
 * クライアント向けの通知一覧。中身の組み立ては画面側と同じ d1-notifications
 * に任せる——ここで独自に SQL を書くと、画面とアプリで違う通知が見える。
 * メッセージ通知はDMの未読と二重に数えないよう、画面側と同じく外してある。
 */
export async function GET(request: Request) {
  try {
    const expected = expectedViewer(request);
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    checkViewer(viewer.id, expected);
    // excerpt は ?excerpts=1 を送るクライアントだけ。古いデスクトップは通知の形を閉じて検査する。
    const excerpts = new URL(request.url).searchParams.get("excerpts") === "1";
    const [notifications, unreadCount] = await Promise.all([
      listD1Notifications(database, viewer.id, { excludeMessageReceived: true, excerpts }),
      countD1UnreadNotifications(database, viewer.id, { excludeMessageReceived: true }),
    ]);
    const [actors, threadPostDestinations, communityMessageDestinations] = await Promise.all([
      getD1NotificationActors(database, notifications),
      getD1ThreadPostDestinations(database, notifications),
      getD1CommunityMessageDestinations(database, notifications),
    ]);
    return json({ viewerId: viewer.id, notifications, unreadCount, actors, threadPostDestinations, communityMessageDestinations });
  } catch (error) {
    return failure(error);
  }
}

/**
 * 既読化。{ readAll: true } か { id: "<通知ID>" }。
 * Managed Desktop sends X-Hub-Expected-Viewer as a precondition, never authentication.
 * Headerless old callers remain compatible; authentication is always a Desktop assertion.
 */
export async function POST(request: Request) {
  try {
    const expected = expectedViewer(request);
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    checkViewer(viewer.id, expected);
    const body = await readInput(request);
    if ("readAll" in body) {
      await markAllD1NotificationsRead(database, viewer.id);
    } else {
      const updated = await markD1NotificationRead(database, viewer.id, body.id);
      if (!updated) {
        return json({ error: "notification_not_found" }, 404);
      }
    }
    const unreadCount = await countD1UnreadNotifications(database, viewer.id, { excludeMessageReceived: true });
    return json({ viewerId: viewer.id, unreadCount });
  } catch (error) {
    return failure(error);
  }
}
