import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { MusicWork } from "@/lib/music-catalog";
import { readMusicWorksByIds, validMusicKey } from "@/lib/server/client-music-library";

/* One song named by `?work=`. Exact id only; unknown, unpublished or failing lookups return null and the page ignores them. */
export async function readSharedMusicWork(database: D1Database | null, id: string, origin: string): Promise<MusicWork | null> {
  if (!database || !validMusicKey(id) || /\p{Cc}/u.test(id)) return null;
  try {
    const works = await readMusicWorksByIds(database, [id], origin);
    return works.length === 1 && works[0].id === id ? works[0] : null;
  } catch { return null; }
}
