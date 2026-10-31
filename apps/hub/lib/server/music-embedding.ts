import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  MUSIC_EMBEDDING_MODEL, MUSIC_EMBEDDING_TEXT_VERSION, embeddableMusicText, type MusicVectorRow,
} from "@/lib/music-embedding-text";

export { MUSIC_EMBEDDING_MODEL, MUSIC_EMBEDDING_DIMENSIONS, embeddableMusicText } from "@/lib/music-embedding-text";
export type { MusicVectorRow } from "@/lib/music-embedding-text";

/*
 * Turning works into vectors, so a search can answer "テンションが上がる曲"
 * — a phrase that appears in no title, no artist and no tag, and therefore
 * finds nothing today.
 *
 * The text embedded is what a person would say about the work: its title, who
 * made it, and the words already attached to it. Nothing else about the
 * listener goes in.
 */
/*
 * A fingerprint of exactly what was embedded. Comparing it is what keeps a
 * rerun from paying again for text that did not change.
 */
export async function musicContentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].slice(0, 16).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/*
 * Works with no vector, and works edited since they were embedded. The second
 * test is on updated_at rather than on the text, because comparing text means
 * reading every work — the cost the fingerprint exists to avoid.
 */
export async function listMusicWorksToEmbed(
  database: D1Database,
  limit: number,
): Promise<MusicVectorRow[]> {
  const capped = Math.max(1, Math.min(200, Math.trunc(limit)));
  const result = await database.prepare(
    `SELECT w.id, w.title, w.artist, w.genre, w.release_year, w.tags_json
     FROM music_works w
     LEFT JOIN music_work_vectors v ON v.work_id = w.id
     WHERE w.status = 'active' AND (
       v.work_id IS NULL
       OR v.embedded_at < w.updated_at
       OR v.text_version IS NOT ?
       OR v.model IS NOT ?
     )
     ORDER BY w.created_at ASC, w.id ASC
     LIMIT ?`,
  ).bind(MUSIC_EMBEDDING_TEXT_VERSION, MUSIC_EMBEDDING_MODEL, capped).all<MusicVectorRow>();
  return result.results ?? [];
}

/** Records that a work has been embedded, so a rerun does not pay twice. */
export async function markMusicWorksEmbedded(
  database: D1Database,
  entries: ReadonlyArray<{ id: string; contentHash: string }>,
  model: string,
): Promise<void> {
  if (!entries.length) return;
  const now = new Date().toISOString();
  await database.batch(entries.map((entry) => database.prepare(
    `INSERT OR REPLACE INTO music_work_vectors (work_id, model, embedded_at, content_hash, text_version) VALUES (?, ?, ?, ?, ?)`,
  ).bind(entry.id, model, now, entry.contentHash, MUSIC_EMBEDDING_TEXT_VERSION)));
}

/*
 * The question, asked of the index rather than of the text. It runs only when
 * the literal search found nothing: a phrase like "テンションが上がる曲"
 * appears in no title, no artist and no tag, so the catalogue answered "not
 * found" for songs it was holding.
 */
export async function searchMusicByMeaning(
  environment: unknown,
  query: string,
  limit: number,
): Promise<string[]> {
  const trimmed = query.normalize("NFKC").trim().slice(0, 200);
  if (!trimmed) return [];
  const ai = Reflect.get(environment as object, "HUB_AI") as
    { run: (model: string, input: unknown) => Promise<{ data?: number[][] }> } | undefined;
  const index = Reflect.get(environment as object, "HUB_MUSIC_VECTORS") as {
    query: (vector: number[], options: unknown) => Promise<{ matches?: Array<{ id: string }> }>;
  } | undefined;
  /* Without the bindings the caller simply has no second answer to offer. */
  if (!ai || !index) return [];

  try {
    const embedded = await ai.run(MUSIC_EMBEDDING_MODEL, { text: [trimmed] });
    const vector = embedded.data?.[0];
    if (!vector) return [];
    const found = await index.query(vector, { topK: Math.max(1, Math.min(60, limit)) });
    return (found.matches ?? []).map((match) => match.id);
  } catch {
    /* A search that answers less is better than a screen that fails. */
    return [];
  }
}

/*
 * The catalogue's own upkeep: works published since the last run get vectors.
 * Bounded per run so one pass cannot spend without limit, and idempotent, so
 * a rerun costs nothing once everything is embedded.
 */
async function embedOneMusicBatch(
  database: D1Database,
  environment: unknown,
  limit: number,
): Promise<{ embedded: number; scanned: number }> {
  const ai = Reflect.get(environment as object, "HUB_AI") as
    { run: (model: string, input: unknown) => Promise<{ data?: number[][] }> } | undefined;
  const index = Reflect.get(environment as object, "HUB_MUSIC_VECTORS") as
    { upsert: (vectors: unknown[]) => Promise<unknown> } | undefined;
  if (!ai || !index) return { embedded: 0, scanned: 0 };

  const candidates = await listMusicWorksToEmbed(database, limit);
  if (!candidates.length) return { embedded: 0, scanned: 0 };

  /*
   * An edit to a work does not necessarily change what gets embedded — a
   * price, a play count, a moderation flag all move updated_at and leave
   * the title, artist and tags alone. Those are recorded as current
   * without asking the model, which is the whole saving.
   */
  const stored = await database.prepare(
    `SELECT work_id, content_hash FROM music_work_vectors WHERE work_id IN (${candidates.map(() => "?").join(",")})`,
  ).bind(...candidates.map((work) => work.id)).all<{ work_id: string; content_hash: string | null }>();
  const previous = new Map((stored.results ?? []).map((row) => [row.work_id, row.content_hash]));

  const hashed = await Promise.all(candidates.map(async (work) => ({
    work, text: embeddableMusicText(work), contentHash: await musicContentHash(embeddableMusicText(work)),
  })));
  const unchanged = hashed.filter((entry) => previous.get(entry.work.id) === entry.contentHash);
  const works = hashed.filter((entry) => previous.get(entry.work.id) !== entry.contentHash);
  if (unchanged.length) {
    await markMusicWorksEmbedded(database, unchanged.map((entry) => ({ id: entry.work.id, contentHash: entry.contentHash })), MUSIC_EMBEDDING_MODEL);
  }
  if (!works.length) return { embedded: 0, scanned: candidates.length };

  const output = await ai.run(MUSIC_EMBEDDING_MODEL, { text: works.map((entry) => entry.text) });
  const vectors = output.data ?? [];
  /* A short answer means some work would get another work's vector. */
  /* A short answer means some work would get another work's vector. Stop. */
  if (vectors.length !== works.length) return { embedded: 0, scanned: 0 };

  await index.upsert(works.map((entry, position) => ({
    id: entry.work.id,
    values: vectors[position],
    metadata: { title: entry.work.title, artist: entry.work.artist },
  })));
  await markMusicWorksEmbedded(database, works.map((entry) => ({ id: entry.work.id, contentHash: entry.contentHash })), MUSIC_EMBEDDING_MODEL);

  return { embedded: works.length, scanned: candidates.length };
}

/*
 * One run drains the queue rather than nibbling at it. At fifty works every
 * six hours, the 1,312 already in the catalogue would have taken a week to
 * re-embed after a change to the embedded text, and the improvement would
 * have been invisible for all of it.
 *
 * The bound is wall-clock rather than a batch count, because what costs time
 * here is waiting on the model, not computing. A run that reaches the budget
 * stops on a batch boundary and leaves the rest for the next one, so the
 * work is never abandoned halfway and never spends without limit.
 */
export async function embedPendingMusicWorks(
  database: D1Database,
  environment: unknown,
  limit = 50,
  budgetMs = 20_000,
): Promise<{ embedded: number; remaining: number }> {
  const deadline = Date.now() + budgetMs;
  let embedded = 0;
  do {
    const batch = await embedOneMusicBatch(database, environment, limit);
    embedded += batch.embedded;
    /* Nothing left to look at: an empty scan is the only true finish. */
    if (batch.scanned === 0) break;
  } while (Date.now() < deadline);
  /*
   * Counted once at the end rather than inside each batch. A batch whose
   * works all turned out unchanged does no embedding, and reporting its own
   * figure let a run finish claiming an empty queue that was not empty.
   */
  const left = await database.prepare(
    `SELECT COUNT(*) AS n FROM music_works w
     LEFT JOIN music_work_vectors v ON v.work_id = w.id
     WHERE w.status = 'active' AND (
       v.work_id IS NULL
       OR v.embedded_at < w.updated_at
       OR v.text_version IS NOT ?
       OR v.model IS NOT ?
     )`,
  ).bind(MUSIC_EMBEDDING_TEXT_VERSION, MUSIC_EMBEDDING_MODEL).first<{ n: number }>();
  return { embedded, remaining: Number(left?.n ?? 0) };
}
