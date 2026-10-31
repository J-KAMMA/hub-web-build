export const FEED_REALTIME_SHARDS = 4;
export const FEED_REALTIME_STORAGE_KEY = "hub.feed.realtime-shard";

export type FeedRealtimeUpgradeError = {
  status: 400 | 403 | 405;
  message: string;
};

type FeedRealtimeUpgradeRequest = {
  method: string;
  headers: Pick<Headers, "get">;
  url: string;
};

export type FeedRealtimeEvent = {
  type: "new-post";
  eventId: string;
  at: string;
};

export function normalizeFeedRealtimeShard(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return 0;
  return ((Math.trunc(parsed) % FEED_REALTIME_SHARDS) + FEED_REALTIME_SHARDS) % FEED_REALTIME_SHARDS;
}

export function validateFeedRealtimeUpgrade(request: FeedRealtimeUpgradeRequest): FeedRealtimeUpgradeError | null {
  if (request.method !== "GET") {
    return { status: 405, message: "Method not allowed" };
  }
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return { status: 400, message: "WebSocket upgrade required" };
  }
  const origin = request.headers.get("Origin");
  if (!origin) return null;
  try {
    if (new URL(origin).host !== new URL(request.url).host) {
      return { status: 403, message: "Origin not allowed" };
    }
  } catch {
    return { status: 403, message: "Origin not allowed" };
  }
  return null;
}

export function isFeedRealtimeEvent(value: unknown): value is FeedRealtimeEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<FeedRealtimeEvent>;
  return candidate.type === "new-post"
    && typeof candidate.eventId === "string"
    && candidate.eventId.length > 0
    && candidate.eventId.length <= 128
    && typeof candidate.at === "string"
    && Number.isFinite(Date.parse(candidate.at));
}

export function parseFeedRealtimeEvent(value: unknown): FeedRealtimeEvent | null {
  if (typeof value !== "string" || value.length > 1_024) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return isFeedRealtimeEvent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
