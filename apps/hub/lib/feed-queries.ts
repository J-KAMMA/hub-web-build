export const FEED_QUERY_STORAGE_KEY = "hub.feed.queries.v1";
export const FEED_ACTIVE_QUERY_STORAGE_KEY = "hub.feed.active-query.v1";
export const FEED_QUERY_SCHEMA_VERSION = 1;

export type FeedQuerySource = "recommended" | "latest" | "popular" | "following" | "list";
export type FeedQuerySort = "relevance" | "popular" | "newest";

export interface FeedQueryDefinition {
  id: string;
  label: string;
  source: FeedQuerySource;
  sort: FeedQuerySort;
  keyword: string;
  listId?: string;
  system?: boolean;
}

interface StoredFeedQueries {
  version: typeof FEED_QUERY_SCHEMA_VERSION;
  queries: FeedQueryDefinition[];
}

export type FeedQueryState = {
  activeId: string;
  custom: FeedQueryDefinition[];
};

export type FeedQueryAction =
  | { type: "select"; id: string }
  | { type: "save"; query: FeedQueryDefinition }
  | { type: "remove"; id: string }
  | { type: "hydrate"; queries: FeedQueryDefinition[] };

const VALID_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function systemFeedQueries(locale: "ja" | "en" = "ja"): FeedQueryDefinition[] {
  return [
    { id: "latest", label: locale === "en" ? "Latest" : "新着", source: "latest", sort: "newest", keyword: "", system: true },
    { id: "recommended", label: locale === "en" ? "For you" : "おすすめ", source: "recommended", sort: "relevance", keyword: "", system: true },
    { id: "popular", label: locale === "en" ? "Popular" : "人気", source: "popular", sort: "popular", keyword: "", system: true },
    { id: "following", label: locale === "en" ? "Following" : "フォロー", source: "following", sort: "newest", keyword: "", system: true },
  ];
}

export function listFeedQuery(id: string, label: string): FeedQueryDefinition {
  return { id: `list-${id}`, label, source: "list", sort: "newest", keyword: "", listId: id, system: true };
}

export function createFeedQuery(input: {
  label: string;
  keyword?: string;
  source?: Exclude<FeedQuerySource, "list">;
  sort?: FeedQuerySort;
}): FeedQueryDefinition {
  const label = input.label.trim().slice(0, 24);
  const suffix = Math.random().toString(36).slice(2, 9);
  return {
    id: `saved-${Date.now().toString(36)}-${suffix}`,
    label,
    source: input.source ?? "recommended",
    sort: input.sort ?? "relevance",
    keyword: (input.keyword ?? "").trim().slice(0, 80),
  };
}

export function isFeedQueryDefinition(value: unknown): value is FeedQueryDefinition {
  if (!value || typeof value !== "object") return false;
  const query = value as Partial<FeedQueryDefinition>;
  return typeof query.id === "string"
    && VALID_ID.test(query.id)
    && typeof query.label === "string"
    && query.label.trim().length > 0
    && query.label.length <= 24
    && (query.source === "recommended" || query.source === "latest" || query.source === "popular" || query.source === "following")
    && (query.sort === "relevance" || query.sort === "popular" || query.sort === "newest")
    && typeof query.keyword === "string"
    && query.keyword.length <= 80
    && query.system !== true;
}

export function parseStoredFeedQueries(raw: string | null): FeedQueryDefinition[] {
  if (!raw) return [];
  try {
    const value = JSON.parse(raw) as Partial<StoredFeedQueries>;
    if (value.version !== FEED_QUERY_SCHEMA_VERSION || !Array.isArray(value.queries)) return [];
    const unique = new Map<string, FeedQueryDefinition>();
    for (const query of value.queries) {
      if (isFeedQueryDefinition(query) && !unique.has(query.id)) unique.set(query.id, query);
    }
    return [...unique.values()].slice(0, 8);
  } catch {
    return [];
  }
}

export function serializeFeedQueries(queries: FeedQueryDefinition[]): string {
  return JSON.stringify({
    version: FEED_QUERY_SCHEMA_VERSION,
    queries: queries.filter(isFeedQueryDefinition).slice(0, 8),
  } satisfies StoredFeedQueries);
}

export function feedQueryReducer(state: FeedQueryState, action: FeedQueryAction): FeedQueryState {
  if (action.type === "select") return { ...state, activeId: action.id };
  if (action.type === "hydrate") return { ...state, custom: action.queries.filter(isFeedQueryDefinition).slice(0, 8) };
  if (action.type === "remove") {
    const custom = state.custom.filter((query) => query.id !== action.id);
    return { activeId: state.activeId === action.id ? "recommended" : state.activeId, custom };
  }
  if (!isFeedQueryDefinition(action.query)) return state;
  const custom = [...state.custom.filter((query) => query.id !== action.query.id), action.query].slice(-8);
  return { activeId: action.query.id, custom };
}
