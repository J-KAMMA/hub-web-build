export const DEFAULT_LIST_PAGE_SIZE = 20;
export const MAX_LIST_PAGE_SIZE = 50;
/**
 * Largest OFFSET a public list API accepts. D1 bills every row an OFFSET skips, so an unbounded value
 * (?offset=1000000) lets anyone make a request read and bill the whole table. A larger offset is clamped to
 * this value, never rejected. Deeper paging belongs on the keyset cursors (before/after), not on OFFSET.
 */
export const MAX_LIST_OFFSET = 1000;

/** Clamps a raw offset to 0..maxOffset (non-finite values become 0). */
export function clampListOffset(value: number, maxOffset = MAX_LIST_OFFSET): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(Math.max(0, Math.trunc(maxOffset)), Math.trunc(value)));
}

function finiteInteger(value: string | null, fallback: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

export function readListPagination(url: URL, options: { defaultLimit?: number; maxLimit?: number; maxOffset?: number } = {}) {
  const defaultLimit = Math.max(1, Math.trunc(options.defaultLimit ?? DEFAULT_LIST_PAGE_SIZE));
  const maxLimit = Math.max(defaultLimit, Math.trunc(options.maxLimit ?? MAX_LIST_PAGE_SIZE));
  return {
    limit: Math.max(1, Math.min(maxLimit, finiteInteger(url.searchParams.get("limit"), defaultLimit))),
    offset: clampListOffset(finiteInteger(url.searchParams.get("offset"), 0), options.maxOffset),
  };
}
