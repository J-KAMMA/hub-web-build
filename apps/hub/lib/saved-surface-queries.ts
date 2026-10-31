export const SAVED_SURFACE_QUERY_VERSION = 1;
export const SAVED_SURFACE_QUERY_LIMIT = 8;
export const SAVED_SURFACE_QUERY_STORAGE_KEY = "hub.saved-surface-queries.v1";

export type QuerySurface =
  | "search"
  | "hubpedia"
  | "community"
  | "videos"
  | "music"
  | "market";

export type SavedSurfaceQuery = {
  id: string;
  surface: QuerySurface;
  label: string;
  value: string;
  createdAt: string;
};

function isSurface(value: unknown): value is QuerySurface {
  return ["search", "hubpedia", "community", "videos", "music", "market"].includes(String(value));
}

export function parseSavedSurfaceQueries(value: string | null): SavedSurfaceQuery[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as { version?: unknown; items?: unknown } | unknown[];
    const source = Array.isArray(parsed) ? parsed : parsed.version === SAVED_SURFACE_QUERY_VERSION ? parsed.items : [];
    if (!Array.isArray(source)) return [];
    return source.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as Partial<SavedSurfaceQuery>;
      if (
        typeof candidate.id !== "string"
        || !isSurface(candidate.surface)
        || typeof candidate.label !== "string"
        || typeof candidate.value !== "string"
        || typeof candidate.createdAt !== "string"
      ) return [];
      const label = candidate.label.trim().slice(0, 32);
      const queryValue = candidate.value.trim().slice(0, 2_000);
      if (!label || !queryValue) return [];
      return [{ ...candidate, label, value: queryValue } as SavedSurfaceQuery];
    });
  } catch {
    return [];
  }
}

export function serializeSavedSurfaceQueries(items: SavedSurfaceQuery[]) {
  return JSON.stringify({ version: SAVED_SURFACE_QUERY_VERSION, items });
}

export function saveSurfaceQuery(
  items: SavedSurfaceQuery[],
  input: Pick<SavedSurfaceQuery, "surface" | "label" | "value">,
  now = new Date(),
) {
  const label = input.label.trim().slice(0, 32);
  const value = input.value.trim().slice(0, 2_000);
  if (!label || !value) return items;
  const withoutDuplicate = items.filter(
    (item) => !(item.surface === input.surface && item.value === value),
  );
  const next: SavedSurfaceQuery = {
    id: `${input.surface}:${now.getTime().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
    surface: input.surface,
    label,
    value,
    createdAt: now.toISOString(),
  };
  const sameSurface = [next, ...withoutDuplicate.filter((item) => item.surface === input.surface)]
    .slice(0, SAVED_SURFACE_QUERY_LIMIT);
  return [
    ...withoutDuplicate.filter((item) => item.surface !== input.surface),
    ...sameSurface,
  ];
}

export function removeSurfaceQuery(items: SavedSurfaceQuery[], id: string) {
  return items.filter((item) => item.id !== id);
}
