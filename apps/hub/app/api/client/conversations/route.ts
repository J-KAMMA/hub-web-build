import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  countD1UnreadDirectMessages,
  DirectMessageError,
  listD1DirectMessagePageData,
  markD1ConversationRead,
  sendD1DirectMessage,
  startD1DirectMessage,
} from "@/lib/server/d1-direct-messages";

const PRIVATE_RESPONSE_HEADERS = { "cache-control": "private, no-store", vary: "Authorization" } as const;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...PRIVATE_RESPONSE_HEADERS, ...headers } });
class RequestError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
const asciiId = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 128 && !/[^\x21-\x7e]/.test(value);
const uuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

function managedScope(request: Request, viewerId: string): boolean {
  const expected = request.headers.get("x-hub-expected-viewer");
  if (expected === null) return false;
  if (!asciiId(expected)) throw new RequestError("invalid_request");
  if (!hasSameOrigin(request)) throw new RequestError("invalid_request_origin", 403);
  if (expected !== viewerId) throw new RequestError("dm_scope_changed", 409);
  return true;
}

// JSON.parse validates syntax; this bounded token scan also rejects escaped duplicate keys.
function parseUniqueJson(source: string): unknown {
  const value: unknown = JSON.parse(source);
  const objects: Set<string>[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") objects.push(new Set());
    else if (source[i] === "}") objects.pop();
    else if (source[i] === '"') {
      const start = i++;
      while (source[i] !== '"') { if (source[i] === "\\") i++; i++; }
      let next = i + 1;
      while (/\s/.test(source[next] ?? "") && next < source.length) next++;
      if (source[next] === ":") {
        const key: string = JSON.parse(source.slice(start, i + 1));
        const keys = objects.at(-1)!;
        if (keys.has(key)) throw new RequestError("invalid_request");
        keys.add(key);
      }
    }
  }
  return value;
}

async function readManagedInput(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !request.body) throw new RequestError("invalid_request");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0, source = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 16 * 1024) throw new RequestError("invalid_request");
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode();
    const value = parseUniqueJson(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError("invalid_request");
    const body = value as Record<string, unknown>;
    const keys = Object.keys(body);
    if (Object.hasOwn(body, "start")) {
      if (keys.length !== 1 || !asciiId(body.start)) throw new RequestError("invalid_request");
    } else if (Object.hasOwn(body, "markRead")) {
      if (keys.length !== 2 || !asciiId(body.conversation) || body.markRead !== true) throw new RequestError("invalid_request");
    } else {
      if (!keys.every(key => ["conversation", "text", "requestId", "imageIds"].includes(key)) || !asciiId(body.conversation) || !uuid(body.requestId) || typeof body.text !== "string" || /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(body.text)) throw new RequestError("invalid_request");
      const images = body.imageIds === undefined ? [] : body.imageIds;
      if (!Array.isArray(images) || images.length > 4 || !images.every(uuid) || new Set(images).size !== images.length) throw new RequestError("invalid_request");
      const trimmed = body.text.trim();
      if (trimmed.length > 280 || (!trimmed.length && !images.length)) throw new RequestError("invalid_request");
      body.text = trimmed;
    }
    return body;
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof RequestError) throw error;
    throw new RequestError("invalid_request");
  } finally { reader.releaseLock(); }
}

function failure(error: unknown) {
  if (error instanceof RequestError) return json({ error: error.code }, error.status);
  if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
  if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
  if (error instanceof DirectMessageError) return json({ error: error.message, code: error.code }, error.status, error.retryAfterSeconds ? { "Retry-After": String(error.retryAfterSeconds) } : {});
  return json({ error: "unavailable" }, 503);
}

/**
 * クライアント向けのDM一覧＋指定会話の本文。組み立ては画面側と同じ
 * listD1DirectMessagePageData に任せる。E2E の暗号本体は渡さず、
 * 画面に出る previewText だけを返す。
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    managedScope(request, profile.id);
    const conversationId = new URL(request.url).searchParams.get("conversation") ?? undefined;
    const [page, messageCount] = await Promise.all([
      listD1DirectMessagePageData(database, profile.id, conversationId),
      countD1UnreadDirectMessages(database, profile.id),
    ]);
    return json({ currentProfileId: profile.id, ...page, messageCount });
  } catch (error) {
    return failure(error);
  }
}

/**
 * DM操作。{ conversation, markRead: true } で既読化、
 * { conversation, text, requestId? } で送信（requestId は再送の冪等キー）。
 * 管理されたクライアントは本人比較ヘッダとOriginを指定する。
 */
export async function POST(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    const managed = managedScope(request, profile.id);
    const body = managed ? await readManagedInput(request) : await request.json().catch(() => null);
    // 新規会話。{ start: profileId } — 画面側 /api/messages/start と同じ
    // startD1DirectMessage を通る。既存ならその会話を返す。
    const startTarget = typeof body?.start === "string" ? body.start : "";
    if (startTarget) {
      const result = await startD1DirectMessage(database, profile.id, startTarget);
      return json(
        { conversation_id: result.conversationId, created_new: result.createdNew },
        result.createdNew ? 201 : 200,
      );
    }
    const conversationId = typeof body?.conversation === "string" ? body.conversation : "";
    if (!conversationId) {
      return json({ error: "missing_conversation" }, 400);
    }
    if (body?.markRead === true) {
      const result = await markD1ConversationRead(database, conversationId, profile.id);
      return json(managed ? { viewerId: profile.id, ...result } : result);
    }
    const text = typeof body?.text === "string" ? body.text : "";
    const requestId = typeof body?.requestId === "string" ? body.requestId : undefined;
    const imageIds = body?.imageIds === undefined
      ? []
      : Array.isArray(body.imageIds) && body.imageIds.every((id: unknown) => typeof id === "string")
        ? body.imageIds as string[]
        : null;
    if (imageIds === null) {
      return json({ error: "画像の指定が正しくありません。" }, 400);
    }
    const message = await sendD1DirectMessage(database, conversationId, profile.id, text, requestId, imageIds);
    return json(managed ? { viewerId: profile.id, message } : message);
  } catch (error) {
    return failure(error);
  }
}
