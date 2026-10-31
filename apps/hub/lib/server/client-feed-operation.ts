import "server-only";
import { NextResponse } from "next/server";
import { getHubD1 } from "./hub-d1";
import { requireDesktopHubProfile } from "./desktop-hub-auth";
import { hasSameOrigin } from "./hub-auth-route";

export const feedHeaders = { "cache-control": "private, no-store", vary: "Authorization" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: feedHeaders });
export const feedManaged = (request: Request) => request.headers.has("x-hub-expected-viewer");
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
export function feedRequestId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value)
    && value !== "00000000-0000-0000-0000-000000000000";
}
export function feedExpectedViewerError(request: Request, actual: string): Response | null {
  const expected = request.headers.get("x-hub-expected-viewer");
  if (expected === null) return null;
  if (!id(expected)) return json({ error: "feed_operation_invalid_request" }, 400);
  return expected === actual ? null : json({ error: "feed_operation_scope_changed" }, 409);
}

function uniqueJson(source: string): unknown {
  const value: unknown = JSON.parse(source), stack: Set<string>[] = [];
  for (let index = 0; index < source.length; index++) {
    if (source[index] === "{") stack.push(new Set());
    else if (source[index] === "}") stack.pop();
    else if (source[index] === '"') {
      const start = index++;
      while (source[index] !== '"') { if (source[index] === "\\") index++; index++; }
      let next = index + 1; while (next < source.length && /\s/u.test(source[next])) next++;
      if (source[next] === ":") {
        const key: string = JSON.parse(source.slice(start, index + 1)), keys = stack.at(-1)!;
        if (keys.has(key)) throw Error("duplicate_key"); keys.add(key);
      }
    }
  }
  return value;
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !request.body) throw Error("invalid_request");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0, source = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength; if (length > 16 * 1024) throw Error("invalid_request");
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode(); const value = uniqueJson(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_request");
    return value as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
function normalize(value: Record<string, unknown>): Record<string, unknown> {
  if (Object.keys(value).some(key => !["body", "clientRequestId", "imageIds", "audience", "scheduledAt"].includes(key))
    || !feedRequestId(value.clientRequestId) || typeof value.body !== "string" || value.body.length > 500
    || /\u0000|\p{Surrogate}/u.test(value.body)) throw Error("invalid_request");
  const body = value.body.normalize("NFKC").replace(/\r\n/g, "\n").trim();
  const imageIds = value.imageIds ?? [];
  if (body.length > 500 || !Array.isArray(imageIds) || imageIds.length > 4 || !imageIds.every(feedRequestId)
    || new Set(imageIds.map(value => value.toLowerCase())).size !== imageIds.length
    || !body && !imageIds.length || value.audience !== undefined && !["public", "followers"].includes(String(value.audience))) throw Error("invalid_request");
  const normalized: Record<string, unknown> = { body, clientRequestId: value.clientRequestId.toLowerCase(), imageIds: imageIds.map(value => value.toLowerCase()), audience: value.audience ?? "public" };
  if (value.scheduledAt !== undefined) {
    if (typeof value.scheduledAt !== "string" || value.scheduledAt.length > 40 || !Number.isFinite(Date.parse(value.scheduledAt)) || !body || imageIds.length) throw Error("invalid_request");
    normalized.scheduledAt = new Date(value.scheduledAt).toISOString();
  }
  return normalized;
}

/** Headerless clients retain their original handler and response. */
export function clientFeedPost(handler: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    if (!feedManaged(request)) return handler(request);
    if (!hasSameOrigin(request)) return json({ error: "invalid_origin" }, 403);
    let database; try { database = getHubD1(); } catch { return json({ error: "feed_operation_unavailable" }, 503); }
    let viewer; try { viewer = await requireDesktopHubProfile(request, database); } catch { return json({ error: "unauthorized" }, 401); }
    const mismatch = feedExpectedViewerError(request, viewer.id); if (mismatch) return mismatch;
    let value; try { value = normalize(await readBody(request)); } catch { return json({ error: "feed_operation_invalid_request" }, 400); }
    const headers = new Headers(request.headers); headers.delete("content-length");
    return handler(new Request(request.url, { method: "POST", headers, body: JSON.stringify(value) }));
  };
}
