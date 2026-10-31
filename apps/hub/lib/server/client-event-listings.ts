import "server-only";

import { parsePublicListingCancellationReason, type PublicListing } from "@/lib/public-listings";
import { cancelD1PublicEventListing, listD1OwnedPublicListings } from "./d1-public-listings";
import { getHubD1, HubD1UnavailableError } from "./hub-d1";
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from "./desktop-hub-auth";
import { hasSameOrigin } from "./hub-auth-route";
import { HubSuspendedError } from "./hub-session";

type Operation = "list" | "detail" | "cancel";
type Cursor = { updatedAt: string; id: string };
export type ClientEventListing = Pick<PublicListing,
  "id" | "title" | "kind" | "status" | "providerLabel" | "providerUrl" | "startsAt" | "updatedAt" | "cancelledAt" | "cancellationReason">;
const RESPONSE_MAX_BYTES = 256 * 1024;
const PAGE_SIZE = 20;
const wellFormed = (value: string) => !/\0|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const timestamp = (value: unknown): value is string => typeof value === "string" && value.length <= 40
  && /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})| \d{2}:\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };

class EventListingError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
const invalid = (): never => { throw new EventListingError("invalid_request", 400); };
const unavailable = (): never => { throw new EventListingError("event_listings_unavailable", 503); };

function json(value: unknown, status = 200): Response {
  const body = JSON.stringify(value);
  if (new TextEncoder().encode(body).byteLength > RESPONSE_MAX_BYTES) return json({ error: "event_listings_unavailable" }, 503);
  return new Response(body, { status, headers: { ...headers, "Content-Type": "application/json" } });
}

const encodeCursor = (cursor: Cursor) => btoa(JSON.stringify(cursor)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
function readCursor(raw: string): Cursor {
  if (!raw || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) return invalid();
  let decoded: unknown;
  try {
    const binary = atob(raw.replaceAll("-", "+").replaceAll("_", "/"));
    if (btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") !== raw) return invalid();
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0))));
  } catch { return invalid(); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return invalid();
  const cursor = decoded as Record<string, unknown>;
  if (Object.keys(cursor).length !== 2 || !Object.hasOwn(cursor, "updatedAt") || !Object.hasOwn(cursor, "id")
    || !timestamp(cursor.updatedAt) || !id(cursor.id)) return invalid();
  return { updatedAt: cursor.updatedAt, id: cursor.id };
}

function listingDto(listing: PublicListing, viewerId: string): ClientEventListing {
  const string = (value: unknown, max: number): value is string => typeof value === "string" && value.length <= max && wellFormed(value);
  if (!id(listing.id) || listing.kind !== "events" || listing.ownerProfileId !== viewerId
    || !["draft", "pending", "published", "paused", "rejected"].includes(listing.status)
    || !string(listing.title, 160) || !listing.title.trim() || !string(listing.providerLabel, 120) || !listing.providerLabel.trim()
    || !string(listing.providerUrl, 2048) || !timestamp(listing.updatedAt)
    || listing.startsAt !== null && !timestamp(listing.startsAt)
    || listing.cancelledAt !== null && !timestamp(listing.cancelledAt)
    || listing.cancellationReason !== null && (!string(listing.cancellationReason, 500) || !listing.cancellationReason.trim())
    || (listing.cancelledAt === null) !== (listing.cancellationReason === null)) return unavailable();
  let url: URL;
  try { url = new URL(listing.providerUrl); } catch { return unavailable(); }
  if (url.protocol !== "https:" || url.username || url.password || url.hostname === "localhost" || url.hostname.endsWith(".local")) return unavailable();
  const { id: listingId, title, kind, status, providerLabel, providerUrl, startsAt, updatedAt, cancelledAt, cancellationReason } = listing;
  return { id: listingId, title, kind, status, providerLabel, providerUrl, startsAt, updatedAt, cancelledAt, cancellationReason };
}

async function readReason(request: Request): Promise<string> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return invalid();
  const reader = request.body?.getReader(); if (!reader) return invalid();
  const decoder = new TextDecoder("utf-8", { fatal: true }); let text = "", bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel().catch(() => {}); throw new EventListingError("request_too_large", 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    await reader.cancel().catch(() => {});
    if (error instanceof EventListingError) throw error;
    return invalid();
  } finally { reader.releaseLock(); }
  let decoded: unknown; try { decoded = JSON.parse(text); } catch { return invalid(); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return invalid();
  const body = decoded as Record<string, unknown>;
  if (Object.keys(body).length !== 1 || !Object.hasOwn(body, "reason") || typeof body.reason !== "string" || !wellFormed(body.reason)) return invalid();
  const normalized = body.reason.replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > 500) return invalid();
  return parsePublicListingCancellationReason(body.reason) ?? invalid();
}

export async function clientEventListings(request: Request, operation: Operation, listingId?: string) {
  try {
    if (request.method !== (operation === "cancel" ? "PATCH" : "GET")) return invalid();
    const url = new URL(request.url), queryKeys = [...url.searchParams.keys()];
    if (operation === "list" ? queryKeys.length > 1 || queryKeys.some(key => key !== "after") : Boolean(url.search)) return invalid();
    if (operation !== "list" && !id(listingId)) return invalid();
    if ((operation === "cancel" || request.headers.has("origin")) && !hasSameOrigin(request)) {
      return json({ error: "invalid_request_origin" }, 403);
    }
    const after = url.searchParams.has("after") ? readCursor(url.searchParams.get("after")!) : undefined;
    const database = getHubD1(), viewer = await requireDesktopHubProfile(request, database);
    if (operation === "list") {
      const records = await listD1OwnedPublicListings(database, viewer.id, "events", { limit: PAGE_SIZE + 1, ...(after ? { after } : {}) });
      const listings = records.slice(0, PAGE_SIZE).map(listing => listingDto(listing, viewer.id));
      const last = listings.at(-1);
      return json({ viewerId: viewer.id, listings, nextCursor: records.length > PAGE_SIZE && last ? encodeCursor({ updatedAt: last.updatedAt, id: last.id }) : null });
    }
    const reason = operation === "cancel" ? await readReason(request) : null;
    const [current] = await listD1OwnedPublicListings(database, viewer.id, "events", { limit: 1, id: listingId ?? invalid() });
    if (!current) return json({ error: "not_found" }, 404);
    let listing = listingDto(current, viewer.id);
    if (reason !== null) {
      if (listing.cancelledAt === null) {
        const saved = await cancelD1PublicEventListing(database, listing.id, viewer.id, reason);
        if (!saved) return json({ error: "not_found" }, 404);
        listing = listingDto(saved, viewer.id);
      }
      if (listing.cancellationReason !== reason) return json({ error: "event_listing_cancellation_conflict" }, 409);
      if (listing.cancelledAt === null) return unavailable();
    }
    return json({ viewerId: viewer.id, listing });
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) return json({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return json({ error: "suspended" }, 403);
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof EventListingError) return json({ error: error.code }, error.status);
    return json({ error: "event_listings_unavailable" }, 503);
  }
}
