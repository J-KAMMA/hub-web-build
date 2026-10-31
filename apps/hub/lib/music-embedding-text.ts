/*
 * What gets embedded for a work. Kept apart from the server module so it can
 * be exercised directly: this string is the whole input to the model, and a
 * change here silently changes every vector in the index.
 */
export const MUSIC_EMBEDDING_MODEL = "@cf/baai/bge-m3";
export const MUSIC_EMBEDDING_DIMENSIONS = 1024;
/*
 * The recipe below, versioned. The content hash notices when a work's data
 * changes; it cannot notice when this function changes, because the queue is
 * filled by updated_at and editing code moves no row. Adding the year left the
 * queue at zero and the improvement would never have arrived. Bump this
 * whenever embeddableMusicText produces different output.
 *   1  title / artist / genre / tags
 *   2  ... with the release year and its decade
 */
export const MUSIC_EMBEDDING_TEXT_VERSION = "2";

export interface MusicVectorRow {
  id: string;
  title: string;
  artist: string;
  genre: string;
  release_year?: number | null;
  tags_json: string;
}

/** The work as a person would describe it. Nothing about the listener. */
export function embeddableMusicText(row: MusicVectorRow): string {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags_json);
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === "string");
  } catch {
    /* A malformed tag list is not a reason to skip the work entirely. */
  }
  /*
   * The year is spelled out as a decade as well. Asked for "80年代っぽい曲"
   * a bare 1985 is a weak handle, where "1980年代" is the phrase people
   * actually use. The description column is deliberately absent: all 1,312
   * works share 13 boilerplate sentences between them, so embedding it would
   * push the same noise into every vector.
   */
  const year = typeof row.release_year === "number" && row.release_year > 0 ? row.release_year : 0;
  const era = year ? [`${year}年`, `${Math.floor(year / 10) * 10}年代`] : [];
  return [row.title, row.artist, row.genre, ...era, ...tags].filter(Boolean).join(" / ");
}
