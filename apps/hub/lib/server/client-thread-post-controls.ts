import "server-only";
import { getHubD1, HubD1UnavailableError } from "./hub-d1";
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from "./desktop-hub-auth";
import { hasSameOrigin } from "./hub-auth-route";
import { HubSuspendedError } from "./hub-session";
import { ensureD1ThreadPostAvailable } from "./bbs-route-data";
import {
  getD1ThreadPostControl, setD1ThreadPostControl, getD1ThreadPostHistoryPage,
  ThreadPostControlError, type ThreadPostHistoryCursor,
} from "./thread-moderation-repository";

type Operation = "relationship_get" | "relationship_set" | "history";
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
});
const invalid = (): never => { throw new ThreadPostControlError("invalid_request", 400); };
const id = (value: unknown): value is string => typeof value === "string" && value.length >= 1 && value.length <= 128 && !/[^A-Za-z0-9_-]/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 40
  && !/\p{Cc}/u.test(value) && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})| \d{2}:\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
const wellFormed = (value: string) => !/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const encodeCursor = (value: ThreadPostHistoryCursor) => btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");

function readCursor(raw: string, postId: string): ThreadPostHistoryCursor {
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return invalid();
  let decoded: unknown;
  try {
    const binary = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    if (btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== raw) return invalid();
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return invalid(); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return invalid();
  const value = decoded as Record<string, unknown>;
  if (Object.keys(value).length !== 3 || Object.keys(value).some(key => !["postId", "createdAt", "id"].includes(key))
    || value.postId !== postId || !id(value.id) || !timestamp(value.createdAt)) return invalid();
  return { postId, createdAt: value.createdAt, id: value.id };
}

export async function readControlInput(request: Request): Promise<{ kind: "mute" | "block"; enabled: boolean }> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return invalid();
  const reader = request.body?.getReader(); if (!reader) return invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel().catch(() => {}); return invalid(); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch { await reader.cancel().catch(() => {}); return invalid(); }
  finally { reader.releaseLock(); }
  let decoded: unknown; try { decoded = JSON.parse(text); } catch { return invalid(); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return invalid();
  const value = decoded as Record<string, unknown>;
  if (Object.keys(value).length !== 2 || !Object.hasOwn(value, "kind") || !Object.hasOwn(value, "enabled")
    || value.kind !== "mute" && value.kind !== "block" || typeof value.enabled !== "boolean") return invalid();
  return { kind: value.kind, enabled: value.enabled };
}

export async function clientThreadPostControls(request: Request, postId: string, operation: Operation) {
  try {
    if (!id(postId)) return invalid();
    const url = new URL(request.url), keys = [...url.searchParams.keys()];
    if (operation !== "history" && url.search || keys.some(key => key !== "after") || keys.length > 1) return invalid();
    if ((operation === "relationship_set" || request.headers.has("origin")) && !hasSameOrigin(request)) {
      return json({ error: "invalid_request_origin" }, 403);
    }
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    const after = url.searchParams.has("after") ? readCursor(url.searchParams.get("after")!, postId) : undefined;
    const input = operation === "relationship_set" ? await readControlInput(request) : undefined;
    await ensureD1ThreadPostAvailable(postId);
    if (operation === "history") {
      const page = await getD1ThreadPostHistoryPage(database, postId, viewer.id, after);
      const last = page.revisions.at(-1);
      if (page.revisions.some(revision => revision.postId !== postId || !id(revision.id) || !timestamp(revision.createdAt)
        || typeof revision.body !== "string" || !wellFormed(revision.body) || Array.from(revision.body).length > 20000
        || typeof revision.editReason !== "string" || !wellFormed(revision.editReason) || Array.from(revision.editReason).length > 300)) {
        throw new ThreadPostControlError("thread_post_history_unavailable", 503);
      }
      return json({ viewerId: viewer.id, postId, revisions: page.revisions,
        nextCursor: page.hasMore && last ? encodeCursor({ postId, createdAt: last.createdAt, id: last.id }) : null });
    }
    const control = input ? await setD1ThreadPostControl(database, postId, input.kind, input.enabled, viewer.id)
      : await getD1ThreadPostControl(database, postId, viewer.id);
    return json({ viewerId: viewer.id, postId, control });
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof ThreadPostControlError) return json({ error: error.code }, error.status);
    return json({ error: "thread_post_control_failed" }, 500);
  }
}
