export const HOME_FEED_SESSION_KEY = "hub.home.session.v1";
export const HOME_FEED_SESSION_TTL_MS = 30 * 60 * 1_000;

export type HomeFeedViewPosition = {
  visibleItemCount: number;
  scrollTop: number;
  anchorPostId: string;
  anchorOffset: number;
};

export type HomeFeedSession<T> = {
  version: 1;
  savedAt: number;
  profileId: string;
  tab: "recommended" | "latest" | "popular" | "following" | "lists";
  listId: string;
  visibleItemCount: number;
  scrollTop: number;
  anchorPostId: string;
  anchorOffset: number;
  viewPositions: Record<string, HomeFeedViewPosition>;
  posts: T[];
};

function normalizeViewPosition(value: unknown): HomeFeedViewPosition | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<HomeFeedViewPosition>;
  return {
    visibleItemCount: Math.max(12, Math.min(200, Math.trunc(Number(candidate.visibleItemCount) || 12))),
    scrollTop: Math.max(0, Math.trunc(Number(candidate.scrollTop) || 0)),
    anchorPostId: typeof candidate.anchorPostId === "string" ? candidate.anchorPostId.slice(0, 100) : "",
    anchorOffset: Math.max(-10_000, Math.min(10_000, Math.trunc(Number(candidate.anchorOffset) || 0))),
  };
}

function normalizeViewPositions(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const positions: Record<string, HomeFeedViewPosition> = {};
  for (const [key, candidate] of Object.entries(value).slice(0, 50)) {
    if (!/^(recommended|latest|popular|following|lists:[A-Za-z0-9_-]{1,100})$/.test(key)) continue;
    const normalized = normalizeViewPosition(candidate);
    if (normalized) positions[key] = normalized;
  }
  return positions;
}

export function readHomeFeedSession<T>(
  storage: Pick<Storage, "getItem" | "removeItem">,
  profileId: string,
  isPost: (value: unknown) => value is T,
  now = Date.now(),
): HomeFeedSession<T> | null {
  try {
    const parsed = JSON.parse(storage.getItem(HOME_FEED_SESSION_KEY) ?? "null") as Partial<HomeFeedSession<unknown>> | null;
    if (
      !parsed
      || parsed.version !== 1
      || typeof parsed.savedAt !== "number"
      || now - parsed.savedAt > HOME_FEED_SESSION_TTL_MS
      || typeof parsed.profileId !== "string"
      || parsed.profileId !== profileId
      || !["recommended", "latest", "popular", "following", "lists"].includes(String(parsed.tab))
    ) {
      storage.removeItem(HOME_FEED_SESSION_KEY);
      return null;
    }
    const fallbackPosition = normalizeViewPosition(parsed) ?? {
      visibleItemCount: 12,
      scrollTop: 0,
      anchorPostId: "",
      anchorOffset: 0,
    };
    const activeView = parsed.tab === "lists"
      ? `lists:${typeof parsed.listId === "string" ? parsed.listId : ""}`
      : String(parsed.tab);
    const viewPositions = normalizeViewPositions(parsed.viewPositions);
    if (!viewPositions[activeView]) viewPositions[activeView] = fallbackPosition;
    return {
      version: 1,
      savedAt: parsed.savedAt,
      profileId: parsed.profileId,
      tab: parsed.tab as HomeFeedSession<T>["tab"],
      listId: typeof parsed.listId === "string" ? parsed.listId : "",
      visibleItemCount: Math.max(12, Math.min(200, Math.trunc(Number(parsed.visibleItemCount) || 12))),
      scrollTop: Math.max(0, Math.trunc(Number(parsed.scrollTop) || 0)),
      anchorPostId: typeof parsed.anchorPostId === "string" ? parsed.anchorPostId.slice(0, 100) : "",
      anchorOffset: Math.max(-10_000, Math.min(10_000, Math.trunc(Number(parsed.anchorOffset) || 0))),
      viewPositions,
      posts: Array.isArray(parsed.posts) ? parsed.posts.filter(isPost).slice(0, 150) : [],
    };
  } catch {
    storage.removeItem(HOME_FEED_SESSION_KEY);
    return null;
  }
}

export function writeHomeFeedSession<T>(
  storage: Pick<Storage, "setItem">,
  session: Omit<HomeFeedSession<T>, "version" | "savedAt">,
  now = Date.now(),
) {
  try {
    storage.setItem(HOME_FEED_SESSION_KEY, JSON.stringify({
      ...session,
      version: 1,
      savedAt: now,
      visibleItemCount: Math.max(12, Math.min(200, Math.trunc(session.visibleItemCount))),
      scrollTop: Math.max(0, Math.trunc(session.scrollTop)),
      anchorPostId: session.anchorPostId.slice(0, 100),
      anchorOffset: Math.max(-10_000, Math.min(10_000, Math.trunc(session.anchorOffset))),
      viewPositions: normalizeViewPositions(session.viewPositions),
      posts: session.posts.slice(0, 150),
    } satisfies HomeFeedSession<T>));
  } catch {
    // Session restoration is an optional convenience layer.
  }
}
