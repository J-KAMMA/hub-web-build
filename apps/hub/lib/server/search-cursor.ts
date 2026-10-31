import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { EMPTY_HUB_SEARCH_FILTERS, hubSearchFiltersKey, type HubSearchFilters } from "@/lib/search-filters";

export const HUB_SEARCH_CURSOR_VERSION = 5 as const;
export const HUB_SEARCH_CURSOR_TTL_MS = 5 * 60_000;
export const HUB_SEARCH_CURSOR_PAGE_SIZE = 40;

export const HUB_SEARCH_CURSOR_SOURCE_GROUPS = [
  "profiles",
  "communities",
  "posts",
  "threads",
  "boards",
  "hubpedia",
  "videos",
  "products",
  "lists",
  "tokens",
  "work",
  "listings",
] as const;

export type HubSearchCursorOrder = "recommended" | "kind";
export type HubSearchCursorSourceGroup = typeof HUB_SEARCH_CURSOR_SOURCE_GROUPS[number];
export type HubSearchCursorBoundaryMap = Record<HubSearchCursorSourceGroup, string | null>;
export type HubSearchCursorEntity = {
  sourceGroup: string;
  ref: { id: string };
  title: string;
  /** Blended relevance score (lib/search-score.ts). When present, pages merge by it. */
  score?: number;
};
export type HubSearchCatalogCounts = Readonly<Record<string, number>>;

export interface HubSearchCursorPayload {
  version: typeof HUB_SEARCH_CURSOR_VERSION;
  queryHash: string;
  viewerHash: string;
  filtersHash: string;
  boundaries: HubSearchCursorBoundaryMap;
  order: HubSearchCursorOrder;
  catalogVersion: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface HubSearchCursorContext {
  query: string;
  viewerProfileId: string | null;
  filters?: HubSearchFilters;
  order?: HubSearchCursorOrder;
  catalogVersion?: string;
  now?: number;
}

function configuredSecret(): string | null {
  const value = process.env.HUB_SEARCH_CURSOR_SECRET;
  return value && value.length >= 32 ? value : null;
}

/** Keep the binding identical to the `/api/search` query normalization contract. */
export function normalizeHubSearchCursorQuery(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("ja").slice(0, 100);
}

function bindingHash(secret: string, namespace: string, value: string): string {
  return createHmac("sha256", secret).update(`hub-search-cursor-${namespace}-v5.${value}`).digest("base64url");
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret).update(`hub-search-cursor-v5.${encodedPayload}`).digest("base64url");
}

function isBoundaryHash(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function isSourceGroup(value: string): value is HubSearchCursorSourceGroup {
  return (HUB_SEARCH_CURSOR_SOURCE_GROUPS as readonly string[]).includes(value);
}

function validBoundaries(value: unknown): value is HubSearchCursorBoundaryMap {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expected = [...HUB_SEARCH_CURSOR_SOURCE_GROUPS].sort();
  return keys.length === expected.length
    && keys.every((key, index) => key === expected[index])
    && HUB_SEARCH_CURSOR_SOURCE_GROUPS.every((source) => candidate[source] === null || isBoundaryHash(candidate[source]));
}

export function emptyHubSearchCursorBoundaries(): HubSearchCursorBoundaryMap {
  return Object.fromEntries(HUB_SEARCH_CURSOR_SOURCE_GROUPS.map((source) => [source, null])) as HubSearchCursorBoundaryMap;
}

/** Return a keyed boundary for one public result without exposing its ID. */
export function getHubSearchEntityBoundary(entity: HubSearchCursorEntity): string | null {
  const secret = configuredSecret();
  if (!secret || !isSourceGroup(entity.sourceGroup) || !entity.ref?.id || typeof entity.title !== "string") return null;
  return bindingHash(secret, "boundary", JSON.stringify([entity.sourceGroup, entity.ref.id, entity.title]));
}

/**
 * Rebuild an interleaved page after one boundary per source group. A missing
 * boundary is a hard failure: silently starting at the beginning would
 * duplicate results and make a signed cursor unsafe to use.
 */
export function pageHubSearchEntities(
  entities: ReadonlyArray<HubSearchCursorEntity>,
  boundaries: HubSearchCursorBoundaryMap,
  pageSize = HUB_SEARCH_CURSOR_PAGE_SIZE,
): { entities: HubSearchCursorEntity[]; boundaries: HubSearchCursorBoundaryMap; hasMore: boolean } | null {
  if (!validBoundaries(boundaries) || !Number.isInteger(pageSize) || pageSize < 1) return null;
  const groups = new Map<HubSearchCursorSourceGroup, HubSearchCursorEntity[]>();
  for (const source of HUB_SEARCH_CURSOR_SOURCE_GROUPS) groups.set(source, []);
  const seen = new Set<string>();
  for (const entity of entities) {
    if (!isSourceGroup(entity.sourceGroup) || !entity.ref?.id || typeof entity.title !== "string") return null;
    const key = `${entity.sourceGroup}:${entity.ref.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    groups.get(entity.sourceGroup)!.push(entity);
  }

  const offsets = Object.fromEntries(HUB_SEARCH_CURSOR_SOURCE_GROUPS.map((source) => [source, 0])) as Record<HubSearchCursorSourceGroup, number>;
  for (const source of HUB_SEARCH_CURSOR_SOURCE_GROUPS) {
    const boundary = boundaries[source];
    if (boundary === null) continue;
    const group = groups.get(source)!;
    const index = group.findIndex((entity) => getHubSearchEntityBoundary(entity) === boundary);
    if (index < 0) return null;
    offsets[source] = index + 1;
  }

  const page: HubSearchCursorEntity[] = [];
  const consumed = Object.fromEntries(HUB_SEARCH_CURSOR_SOURCE_GROUPS.map((source) => [source, 0])) as Record<HubSearchCursorSourceGroup, number>;
  const scored = entities.some((entity) => typeof entity.score === "number" && Number.isFinite(entity.score));
  while (scored && page.length < pageSize) {
    /* Each group is already in score order, so the best head among the groups is the next result. */
    let best: HubSearchCursorSourceGroup | null = null;
    let bestScore = -Infinity;
    for (const source of HUB_SEARCH_CURSOR_SOURCE_GROUPS) {
      const head = groups.get(source)![offsets[source] + consumed[source]];
      if (!head) continue;
      const headScore = typeof head.score === "number" && Number.isFinite(head.score) ? head.score : 0;
      if (headScore > bestScore) {
        best = source;
        bestScore = headScore;
      }
    }
    if (!best) break;
    page.push(groups.get(best)![offsets[best] + consumed[best]]);
    consumed[best] += 1;
  }
  while (!scored && page.length < pageSize) {
    let added = false;
    for (const source of HUB_SEARCH_CURSOR_SOURCE_GROUPS) {
      const group = groups.get(source)!;
      const index = offsets[source] + consumed[source];
      const entity = group[index];
      if (!entity) continue;
      page.push(entity);
      consumed[source] += 1;
      added = true;
      if (page.length >= pageSize) break;
    }
    if (!added) break;
  }

  const nextBoundaries = { ...boundaries };
  for (const entity of page) {
    const boundary = getHubSearchEntityBoundary(entity);
    if (!boundary || !isSourceGroup(entity.sourceGroup)) return null;
    nextBoundaries[entity.sourceGroup] = boundary;
  }
  const hasMore = HUB_SEARCH_CURSOR_SOURCE_GROUPS.some((source) => {
    const group = groups.get(source)!;
    return offsets[source] + consumed[source] < group.length;
  });
  return { entities: page, boundaries: nextBoundaries, hasMore };
}

/**
 * Bind the exact visible candidate snapshot used to rank a page. IDs and
 * titles are included only in the keyed digest, never in the cursor payload.
 */
export function getHubSearchCatalogVersion(
  entities: ReadonlyArray<HubSearchCursorEntity>,
  durableRevision?: string | null,
  counts?: HubSearchCatalogCounts | null,
): string | null {
  const secret = configuredSecret();
  if (!secret) return null;
  const canonicalCounts = counts
    ? Object.entries(counts)
        .map(([key, value]) => [key, Number.isSafeInteger(value) && value >= 0 ? value : 0] as const)
        .sort(([left], [right]) => left.localeCompare(right))
    : null;
  const canonical = JSON.stringify({
    durableRevision: durableRevision ?? null,
    counts: canonicalCounts,
    candidates: entities.map((entity) => [entity.sourceGroup, entity.ref.id, entity.title]),
  });
  return bindingHash(secret, "catalog", canonical);
}

function isOrder(value: unknown): value is HubSearchCursorOrder {
  return value === "recommended" || value === "kind";
}

function validPayload(value: unknown): value is HubSearchCursorPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<HubSearchCursorPayload>;
  return payload.version === HUB_SEARCH_CURSOR_VERSION
    && typeof payload.queryHash === "string" && payload.queryHash.length > 0
    && typeof payload.viewerHash === "string" && payload.viewerHash.length > 0
    && isBoundaryHash(payload.filtersHash)
    && validBoundaries(payload.boundaries)
    && isOrder(payload.order)
    && typeof payload.catalogVersion === "string" && payload.catalogVersion.length <= 128
    && Number.isInteger(payload.issuedAt) && Number.isInteger(payload.expiresAt)
    && (payload.expiresAt as number) > (payload.issuedAt as number)
    && typeof payload.nonce === "string" && /^[A-Za-z0-9_-]{22,128}$/.test(payload.nonce);
}

export function createHubSearchCursor(input: {
  query: string;
  viewerProfileId: string | null;
  filters?: HubSearchFilters;
  boundaries: HubSearchCursorBoundaryMap;
  order?: HubSearchCursorOrder;
  catalogVersion?: string;
  now?: number;
  ttlMs?: number;
}): string | null {
  const secret = configuredSecret();
  const now = input.now ?? Date.now();
  const ttlMs = input.ttlMs ?? HUB_SEARCH_CURSOR_TTL_MS;
  const order = input.order ?? "recommended";
  const catalogVersion = input.catalogVersion ?? "";
  if (!secret || !Number.isInteger(now) || !validBoundaries(input.boundaries)
    || !Number.isInteger(ttlMs) || ttlMs <= 0 || ttlMs > HUB_SEARCH_CURSOR_TTL_MS
    || catalogVersion.length > 128 || !isOrder(order)) return null;

  const payload: HubSearchCursorPayload = {
    version: HUB_SEARCH_CURSOR_VERSION,
    queryHash: bindingHash(secret, "query", normalizeHubSearchCursorQuery(input.query)),
    viewerHash: bindingHash(secret, "viewer", input.viewerProfileId ?? "anonymous"),
    filtersHash: bindingHash(secret, "filters", hubSearchFiltersKey(input.filters ?? EMPTY_HUB_SEARCH_FILTERS)),
    boundaries: input.boundaries,
    order,
    catalogVersion,
    issuedAt: now,
    expiresAt: now + ttlMs,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyHubSearchCursor(
  token: string,
  context: HubSearchCursorContext,
): HubSearchCursorPayload | null {
  const secret = configuredSecret();
  const now = context.now ?? Date.now();
  if (!secret || typeof token !== "string" || !Number.isInteger(now)) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [encodedPayload, suppliedSignature] = parts;
  const expected = Buffer.from(sign(encodedPayload, secret));
  const actual = Buffer.from(suppliedSignature);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;
    if (!validPayload(payload)) return null;
    if (now < payload.issuedAt - 60_000 || now >= payload.expiresAt) return null;
    if (payload.queryHash !== bindingHash(secret, "query", normalizeHubSearchCursorQuery(context.query))) return null;
    if (payload.viewerHash !== bindingHash(secret, "viewer", context.viewerProfileId ?? "anonymous")) return null;
    if (payload.filtersHash !== bindingHash(secret, "filters", hubSearchFiltersKey(context.filters ?? EMPTY_HUB_SEARCH_FILTERS))) return null;
    if (context.order !== undefined && payload.order !== context.order) return null;
    if (context.catalogVersion !== undefined && payload.catalogVersion !== context.catalogVersion) return null;
    return payload;
  } catch {
    return null;
  }
}
