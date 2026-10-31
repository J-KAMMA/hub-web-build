import type { VideoDiscoveryEntry } from "@/lib/server/d1-videos";

export type VideoDiscoveryPage = { videos: VideoDiscoveryEntry[]; nextCursor: string | null };

/** Bounded sequential work; a continuation can resume without repeating earlier pages. */
export async function loadVideoDiscoveryBatch(
  loadPage: (cursor: string | null) => Promise<VideoDiscoveryPage>,
  cursor: string | null = null,
  pageBudget = 20,
): Promise<VideoDiscoveryPage> {
  const entries = new Map<string, VideoDiscoveryEntry>();
  const cursors = new Set<string>();
  let nextCursor = cursor;
  for (let page = 0; page < pageBudget; page += 1) {
    if (nextCursor !== null) {
      if (cursors.has(nextCursor)) throw new Error("Repeated discovery cursor");
      cursors.add(nextCursor);
    }
    const result = await loadPage(nextCursor);
    if (!Array.isArray(result.videos) || result.videos.length > 200 || (result.nextCursor !== null && typeof result.nextCursor !== "string")) throw new Error("Invalid discovery page");
    for (const item of result.videos) entries.set(item.id, item);
    if (result.nextCursor !== null && (result.videos.length === 0 || result.nextCursor === nextCursor)) throw new Error("Discovery cursor did not advance");
    nextCursor = result.nextCursor;
    if (nextCursor === null) break;
  }
  return { videos: [...entries.values()], nextCursor };
}
