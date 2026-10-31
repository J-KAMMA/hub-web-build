import {
  CONTENT_TAG_LENGTH_LIMIT,
  CONTENT_TAG_LIMIT,
  normalizeContentTags,
  parseContentTagInput,
  validateContentTags,
} from "@/lib/content-tags";
import { normalizeTagList } from "@jkamma/content-tags";

export const THREAD_TAG_LIMIT = CONTENT_TAG_LIMIT;
export const THREAD_TAG_LENGTH_LIMIT = CONTENT_TAG_LENGTH_LIMIT;
export const THREAD_STORAGE_BOARD_KEY = "cat01-board01";

export interface ThreadTagSummary {
  name: string;
  count: number;
}

/** Same rules as every other surface: whitespace , 、 ， split tags, "・" stays inside a tag. */
export function normalizeThreadTags(input: unknown): string[] {
  return normalizeContentTags(input);
}

export function parseThreadTagInput(value: string): string[] {
  return parseContentTagInput(value);
}

export function validateThreadTags(input: unknown): string | null {
  return validateContentTags(input);
}

export function summarizeThreadTags(
  threads: ReadonlyArray<{ tags?: readonly string[] }>,
): ThreadTagSummary[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const thread of threads) {
    for (const tag of normalizeTagList([...(thread.tags ?? [])])) {
      const current = counts.get(tag.key);
      counts.set(tag.key, { name: current?.name ?? tag.display, count: (current?.count ?? 0) + 1 });
    }
  }
  return [...counts.values()].sort((left, right) =>
    right.count - left.count || left.name.localeCompare(right.name, "ja"),
  );
}
