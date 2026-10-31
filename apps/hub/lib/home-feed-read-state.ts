const HOME_FEED_READ_STATE_PREFIX = "hub.home.read-state.v1.";
const MAX_FEED_VIEWS = 50;
const MAX_ITEM_ID_LENGTH = 120;

export type HomeFeedReadEntry = {
  itemId: string;
  updatedAt: number;
};

export type HomeFeedReadState = Record<string, HomeFeedReadEntry>;

function storageKey(profileId: string) {
  return `${HOME_FEED_READ_STATE_PREFIX}${profileId || "guest"}`;
}

function isFeedViewKey(value: string) {
  return /^(recommended|latest|popular|following|lists:[A-Za-z0-9_-]{1,100})$/.test(value);
}

export function normalizeHomeFeedReadState(value: unknown): HomeFeedReadState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: HomeFeedReadState = {};
  for (const [view, rawEntry] of Object.entries(value).slice(0, MAX_FEED_VIEWS)) {
    if (!isFeedViewKey(view)) continue;
    const itemId = typeof rawEntry === "string"
      ? rawEntry
      : rawEntry && typeof rawEntry === "object"
        ? (rawEntry as Partial<HomeFeedReadEntry>).itemId
        : null;
    if (typeof itemId !== "string" || itemId.length === 0) continue;
    const updatedAt = rawEntry && typeof rawEntry === "object"
      ? Number((rawEntry as Partial<HomeFeedReadEntry>).updatedAt)
      : 0;
    normalized[view] = {
      itemId: itemId.slice(0, MAX_ITEM_ID_LENGTH),
      updatedAt: Number.isFinite(updatedAt) ? Math.max(0, Math.trunc(updatedAt)) : 0,
    };
  }
  return normalized;
}

export function readHomeFeedReadState(
  storage: Pick<Storage, "getItem" | "removeItem">,
  profileId: string,
): HomeFeedReadState {
  const key = storageKey(profileId);
  try {
    return normalizeHomeFeedReadState(JSON.parse(storage.getItem(key) ?? "null"));
  } catch {
    storage.removeItem(key);
    return {};
  }
}

export function writeHomeFeedReadState(
  storage: Pick<Storage, "setItem">,
  profileId: string,
  state: HomeFeedReadState,
) {
  try {
    storage.setItem(storageKey(profileId), JSON.stringify(normalizeHomeFeedReadState(state)));
  } catch {
    // Read markers are a convenience and must not block the feed.
  }
}
