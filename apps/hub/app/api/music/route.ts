import { NextResponse } from "next/server";

import { getCloudflareContext } from "@opennextjs/cloudflare";

import { createD1MusicWork, listD1MusicTagFacets, listD1MusicWorksByIds, listD1MusicWorksPage } from "@/lib/server/d1-music";
import { InvalidMusicSourceError, parseMusicWorkInput } from "@/lib/music-source";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  validateYouTubeMusicVideo,
  YouTubeMusicRejectedError,
  YouTubeMusicValidationUnavailableError,
} from "@/lib/server/youtube-music-validation";
import type { MusicWork } from "@/lib/music-catalog";
import { searchMusicByMeaning } from "@/lib/server/music-embedding";
import { getHubD1 } from "@/lib/server/hub-d1";
import { readListPagination } from "@/lib/server/list-pagination";
import { resolveMusicQueryTags } from "@/lib/music-query-tags";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";

/*
 * The tag filter decides which works answer; meaning decides which come
 * first. Vectorize returns its own global order, so the meaning ids are read
 * as a ranking over the works the tags already chose, and anything the model
 * did not reach keeps its place behind them rather than being dropped.
 */
async function orderMusicWorksByMeaning(
  database: ReturnType<typeof getHubD1>,
  query: string,
  tags: string[],
  limit: number,
  offset: number,
  fallback: MusicWork[],
): Promise<MusicWork[]> {
  try {
    const { env } = getCloudflareContext();
    const ranked = await searchMusicByMeaning(env, query, 60);
    if (!ranked.length) return fallback;
    const page = await listD1MusicWorksPage(database, limit, offset, [], tags, "", ranked);
    return page.works;
  } catch {
    /* Ranking is an improvement on the answer, never a condition of it. */
    return fallback;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { limit, offset } = readListPagination(url);
  const database = getHubD1();
  const includeFacets = url.searchParams.get("includeFacets") === "1";
  const genres = url.searchParams.getAll("genre");
  /* Tags narrow together: every one named has to be on the work. */
  const tags = url.searchParams.getAll("tag");
  /* Searching in the browser only saw the loaded page; this reaches the catalogue. */
  const query = url.searchParams.get("q") ?? "";
  const [page, tagFacets] = await Promise.all([
    listD1MusicWorksPage(database, limit, offset, genres, tags, query),
    includeFacets ? listD1MusicTagFacets(database) : Promise.resolve(undefined),
  ]);
  /*
   * Before meaning, read the question against the tags the catalogue has.
   * Measured on staging: 「80年代のロック」 matches no title, artist or tag as
   * literal text, so it fell through to meaning and came back with two pop
   * songs and one from 1998. The tags 1980年代 and ロック return six eighties
   * rock songs and nothing else. The precise answer was there all along.
   */
  if (query.trim() && page.total === 0 && !tags.length && !genres.length) {
    const vocabulary = tagFacets ?? await listD1MusicTagFacets(database);
    const readTags = resolveMusicQueryTags(query, vocabulary);
    if (readTags.length) {
      const byTag = await listD1MusicWorksPage(database, limit, offset, [], readTags, "");
      if (byTag.total > 0) {
        /*
         * When the tags narrowed the catalogue to about a page, the filter has
         * already answered and the order barely matters. When it did not, the
         * rest of the question still has to decide: 「90年代のバラード」 names
         * only 1990年代 in tags — バラード is not one — and the filter alone put
         * Metallica and AC/DC at the top of a request for ballads.
         *
         * The model is asked only in that second case, so the common precise
         * query still costs nothing.
         */
        const works = byTag.total > limit
          ? await orderMusicWorksByMeaning(database, query, readTags, limit, offset, byTag.works)
          : byTag.works;
        return NextResponse.json(
          {
            ...byTag, works, tagFacets, limit, offset,
            hasMore: byTag.nextOffset < byTag.total,
            matchedBy: "tags", matchedTags: readTags,
          },
          { headers: publicApiCacheHeaders(request, "music.catalog") },
        );
      }
    }
  }

  /*
   * When neither words nor tags match, ask by meaning. "テンションが上がる曲"
   * appears in no title, no artist and no tag, so the catalogue reported
   * nothing for songs it was holding.
   */
  if (query.trim() && page.total === 0 && !tags.length && !genres.length) {
    const ids = await searchMusicByMeaning(getCloudflareContext().env, query, limit);
    if (ids.length) {
      const works = await listD1MusicWorksByIds(database, ids);
      return NextResponse.json({
        works, total: works.length, tagFacets, limit, offset,
        hasMore: false, matchedBy: "meaning",
      }, { headers: publicApiCacheHeaders(request, "music.catalog") });
    }
  }
  return NextResponse.json(
    { ...page, tagFacets, limit, offset, hasMore: page.nextOffset < page.total, matchedBy: "words" },
    { headers: publicApiCacheHeaders(request, "music.catalog") },
  );
}

/*
 * URL貼付からの登録。2026-08-14 の統合で 410（登録は終了）に置き換えられていたが、
 * 一覧の画面はこの POST を呼び続けていて、必ず失敗していた。
 * 2026-09-02、旦那様の決定で「登録は捨てない」。統合前（2c3c1d178）の形へ戻す。
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  let input;
  try {
    input = parseMusicWorkInput(await request.json().catch(() => null));
  } catch (error) {
    return NextResponse.json({ error: error instanceof InvalidMusicSourceError ? error.message : "入力内容が正しくありません。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    for (const service of input.services) {
      if (service.provider === "youtube") await validateYouTubeMusicVideo(service.url);
    }
    return NextResponse.json({ work: await createD1MusicWork(database, viewer, input), message: "作品を音楽カタログに追加しました。" }, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof YouTubeMusicRejectedError) return NextResponse.json({ error: error.message }, { status: 422 });
    if (error instanceof YouTubeMusicValidationUnavailableError) return NextResponse.json({ error: error.message }, { status: 503 });
    console.error(JSON.stringify({ event: "music_work_create_failed", status: "internal_error" }));
    return NextResponse.json({ error: "作品を追加できませんでした。" }, { status: 500 });
  }
}
