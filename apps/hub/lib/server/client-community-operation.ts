import "server-only";
import { NextResponse } from "next/server";
import { getHubD1 } from "./hub-d1";
import { requireDesktopHubProfile } from "./desktop-hub-auth";
import { hasSameOrigin } from "./hub-auth-route";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers });
const expectedViewer = (request: Request) => request.headers.get("x-hub-expected-viewer");
const asciiId = (value: unknown): value is string => typeof value === "string" && /^[\x21-\x7e]{1,128}$/.test(value);
const unicode = (value: unknown): value is string => typeof value === "string" && !/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);

function uniqueJson(source: string): unknown {
  const value: unknown = JSON.parse(source), objects: Set<string>[] = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") objects.push(new Set());
    else if (source[i] === "}") objects.pop();
    else if (source[i] === '"') {
      const start = i++;
      while (source[i] !== '"') { if (source[i] === "\\") i++; i++; }
      let next = i + 1;
      while (next < source.length && /\s/u.test(source[next])) next++;
      if (source[next] === ":") {
        const key: string = JSON.parse(source.slice(start, i + 1)), keys = objects.at(-1)!;
        if (keys.has(key)) throw Error("invalid_request"); keys.add(key);
      }
    }
  }
  return value;
}

/** Repeated at the handler's actual authentication boundary, before its mutation. */
export function communityExpectedViewerError(request: Request, actual: string): Response | null {
  const expected = expectedViewer(request);
  if (expected === null) return null;
  if (!asciiId(expected)) return json({ error: "invalid_request" }, 400);
  return expected === actual ? null : json({ error: "community_operation_scope_changed" }, 409);
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json" || !request.body) throw Error("invalid_request");
  const reader = request.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, source = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength; if (bytes > 16 * 1024) throw Error("invalid_request");
      source += decoder.decode(chunk.value, { stream: true });
    }
    source += decoder.decode();
    const value = uniqueJson(source);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error("invalid_request");
    return value as Record<string, unknown>;
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

type Operation = "poll" | "vote" | "schedule";
function normalize(value: Record<string, unknown>, operation: Operation): Record<string, unknown> {
  const allowed = operation === "poll" ? ["channelId", "question", "options", "closesInHours", "clientRequestId"]
    : operation === "vote" ? ["optionId"] : ["channelId", "body", "kind", "scheduledAt", "clientRequestId"];
  if (Object.keys(value).some(key => !allowed.includes(key))) throw Error("invalid_request");
  if (operation === "vote") {
    if (typeof value.optionId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.optionId)) throw Error("invalid_request");
    return value;
  }
  if (typeof value.channelId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(value.channelId)
    || typeof value.clientRequestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.clientRequestId)) throw Error("invalid_request");
  const key = operation === "poll" ? "question" : "body";
  const rawText = value[key];
  if (!unicode(rawText)) throw Error("invalid_request");
  const text = rawText.normalize("NFKC").trim();
  if (!text || text.length > (operation === "poll" ? 200 : 2000)) throw Error("invalid_request");
  const normalized = { ...value, [key]: text };
  if (operation === "poll") {
    if (!Array.isArray(value.options) || value.options.length < 2 || value.options.length > 10 || !value.options.every(unicode)) throw Error("invalid_request");
    const options = [...new Set(value.options.map(option => option.normalize("NFKC").trim()))];
    if (options.length < 2 || options.some(option => !option || option.length > 100)) throw Error("invalid_request");
    if (value.closesInHours !== undefined && (typeof value.closesInHours !== "number" || !Number.isFinite(value.closesInHours) || value.closesInHours < 1 || value.closesInHours > 720)) throw Error("invalid_request");
    return { ...normalized, options };
  }
  if (!unicode(value.scheduledAt) || value.scheduledAt.length > 80 || !Number.isFinite(Date.parse(value.scheduledAt))
    || value.kind !== undefined && !["chat", "guide", "question", "party"].includes(String(value.kind))) throw Error("invalid_request");
  return { ...normalized, scheduledAt: new Date(value.scheduledAt).toISOString() };
}

type Context = { params: Promise<{ communityId: string }> };
type Handler = (request: Request, context: Context) => Promise<Response>;
export function clientCommunityMutation(operation: Operation, handler: Handler): Handler {
  return async (request, context) => {
    if (expectedViewer(request) === null) return handler(request, context);
    if (!hasSameOrigin(request)) return json({ error: "invalid_origin" }, 403);
    let database;
    try { database = getHubD1(); }
    catch { return json({ error: "community_operation_unavailable" }, 503); }
    let viewer;
    try { viewer = await requireDesktopHubProfile(request, database); }
    catch { return json({ error: "unauthorized" }, 401); }
    const mismatch = communityExpectedViewerError(request, viewer.id); if (mismatch) return mismatch;
    let value;
    try { value = normalize(await body(request), operation); }
    catch { return json({ error: "invalid_request" }, 400); }
    const forwardedHeaders = new Headers(request.headers); forwardedHeaders.delete("content-length");
    const forwarded = new Request(request.url, { method: request.method, headers: forwardedHeaders, body: JSON.stringify(value) });
    const result = await handler(forwarded, context);
    result.headers.set("cache-control", headers["cache-control"]); result.headers.set("vary", headers.vary);
    if (!result.ok) return result;
    const acknowledgement: unknown = await result.json();
    return NextResponse.json({ ...(acknowledgement as Record<string, unknown>), viewerId: viewer.id }, { status: result.status, headers });
  };
}
