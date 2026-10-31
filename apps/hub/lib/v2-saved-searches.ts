import {
  EMPTY_HUB_SEARCH_FILTERS,
  HUB_SEARCH_FILTER_KEYS,
  hasHubSearchFilters,
  hubSearchFiltersKey,
  parseHubSearchFilters,
  type HubSearchFilters,
} from "@/lib/search-filters";
import { normalizeSearchValue } from "@/lib/search-relevance";
import {
  parseSavedSurfaceQueries,
  SAVED_SURFACE_QUERY_LIMIT,
} from "@/lib/saved-surface-queries";

export type SavedHubSearchGroup =
  | "all"
  | "social"
  | "media"
  | "knowledge"
  | "market"
  | "services"
  | "posts"
  | "articles"
  | "videos"
  | "images"
  | "music"
  | "threads"
  | "hubpedia"
  | "games"
  | "research"
  | "federated"
  | "people"
  | "tags";

export type SavedHubSearch = Readonly<{
  query: string;
  group: SavedHubSearchGroup;
  filters: HubSearchFilters;
  label?: string;
}>;

export type LegacyHubSearchCandidate = {
  id: string;
  label: string;
  query: string;
};

const SAVED_SEARCHES_LIMIT = 10;
const SEARCH_GROUPS = new Set<SavedHubSearchGroup>([
  "all",
  "social",
  "media",
  "knowledge",
  "market",
  "services",
  "posts",
  "articles",
  "videos",
  "images",
  "music",
  "threads",
  "hubpedia",
  "games",
  "research",
  "federated",
  "people",
  "tags",
]);

type SavedFilterInput = Parameters<typeof parseHubSearchFilters>[0];

function normalizedQuery(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 100) : "";
}

function normalizedLabel(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== "string") return null;
  const label = value.trim().slice(0, 32);
  return label || undefined;
}

function parseFilters(candidate: Record<string, unknown>): HubSearchFilters | null {
  const nested = candidate.filters;
  if (nested !== undefined) {
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) return null;
    const parsed = parseHubSearchFilters(nested as SavedFilterInput);
    return parsed.ok ? parsed.filters : null;
  }

  if (!HUB_SEARCH_FILTER_KEYS.some((key) => Object.prototype.hasOwnProperty.call(candidate, key))) {
    return EMPTY_HUB_SEARCH_FILTERS;
  }
  const parsed = parseHubSearchFilters(candidate as SavedFilterInput);
  return parsed.ok ? parsed.filters : null;
}

function isSavedHubSearchGroup(value: unknown): value is SavedHubSearchGroup {
  return typeof value === "string" && SEARCH_GROUPS.has(value as SavedHubSearchGroup);
}

export function getSavedHubSearchKey(search: Pick<SavedHubSearch, "query" | "group" | "filters">): string {
  return `${normalizeSearchValue(search.query)}\u0000${search.group}\u0000${hubSearchFiltersKey(search.filters)}`;
}

function normalizeSavedSearch(value: unknown, allowLegacyString: boolean): SavedHubSearch | null {
  if (allowLegacyString && typeof value === "string") {
    const query = normalizedQuery(value);
    if (!normalizeSearchValue(query)) return null;
    return { query, group: "all", filters: EMPTY_HUB_SEARCH_FILTERS };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  const query = normalizedQuery(candidate.query);
  const group = isSavedHubSearchGroup(candidate.group) ? candidate.group : "all";
  const filters = parseFilters(candidate);
  const label = normalizedLabel(candidate.label);
  if (!filters) return null;
  if (label === null) return null;
  if (!normalizeSearchValue(query) && !hasHubSearchFilters(filters)) return null;
  return label ? { query, group, filters, label } : { query, group, filters };
}

function normalizeSavedSearches(values: readonly unknown[], allowLegacyString: boolean): SavedHubSearch[] {
  const seen = new Set<string>();
  const result: SavedHubSearch[] = [];
  for (const value of values) {
    const search = normalizeSavedSearch(value, allowLegacyString);
    if (!search) continue;
    const key = getSavedHubSearchKey(search);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(search);
    if (result.length === SAVED_SEARCHES_LIMIT) break;
  }
  return result;
}

/** Parse saved searches without reading, writing, or deleting browser storage. */
export function parseSavedHubSearches(raw: string | null): SavedHubSearch[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? normalizeSavedSearches(parsed, true) : [];
  } catch {
    return [];
  }
}

function serializedEntry(search: SavedHubSearch): { query: string; group: SavedHubSearchGroup; filters?: HubSearchFilters; label?: string } {
  const base = hasHubSearchFilters(search.filters)
    ? { query: search.query, group: search.group, filters: search.filters }
    : { query: search.query, group: search.group };
  return search.label ? { ...base, label: search.label } : base;
}

/** Serialize canonical entries while applying the same validation and bounds as parsing. */
export function serializeSavedHubSearches(entries: readonly SavedHubSearch[]): string {
  const normalized = normalizeSavedSearches(entries, false);
  return JSON.stringify(normalized.map(serializedEntry));
}

/** Read only search entries from the v1 surface store; URL-looking values stay plain queries. */
export function readLegacySurfaceSearches(raw: string | null): LegacyHubSearchCandidate[] {
  const seen = new Set<string>();
  const result: LegacyHubSearchCandidate[] = [];
  for (const item of parseSavedSurfaceQueries(raw)) {
    if (item.surface !== "search") continue;
    const key = normalizeSearchValue(item.value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({ id: item.id, label: item.label, query: item.value });
    if (result.length === SAVED_SURFACE_QUERY_LIMIT) break;
  }
  return result;
}

type LegacyHubSearchImportCandidate = Pick<LegacyHubSearchCandidate, "query" | "label">;
type LegacyHubSearchImportResult =
  | { status: "imported"; searches: SavedHubSearch[] }
  | { status: "duplicate" | "full" | "invalid"; searches: SavedHubSearch[] };

/** Plan one legacy import without reading or writing either saved-search store. */
export function planLegacyHubSearchImport(
  current: readonly SavedHubSearch[],
  candidate: LegacyHubSearchImportCandidate,
): LegacyHubSearchImportResult {
  if (typeof candidate?.query !== "string" || typeof candidate?.label !== "string") {
    return { status: "invalid", searches: [...current] };
  }
  const query = candidate.query.trim();
  if (query.length < 1 || query.length > 100 || !normalizeSearchValue(query)) {
    return { status: "invalid", searches: [...current] };
  }
  const label = candidate.label.trim().slice(0, 32);
  const imported: SavedHubSearch = label
    ? { query, group: "all", filters: EMPTY_HUB_SEARCH_FILTERS, label }
    : { query, group: "all", filters: EMPTY_HUB_SEARCH_FILTERS };
  const key = getSavedHubSearchKey(imported);
  if (current.some((search) => getSavedHubSearchKey(search) === key)) {
    return { status: "duplicate", searches: [...current] };
  }
  if (current.length >= SAVED_SEARCHES_LIMIT) {
    return { status: "full", searches: [...current] };
  }
  return { status: "imported", searches: [...current, imported] };
}
