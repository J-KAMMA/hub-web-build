export function canContinueTimelinePage(input: {
  hasMore: boolean;
  previousCursor?: string | null;
  nextCursor?: string | null;
  previousOffset?: number;
  nextOffset?: number;
}) {
  if (!input.hasMore) return false;
  if (
    typeof input.previousOffset === "number"
    && typeof input.nextOffset === "number"
  ) {
    return input.nextOffset > input.previousOffset;
  }
  return Boolean(
    input.nextCursor
    && input.nextCursor !== input.previousCursor,
  );
}
