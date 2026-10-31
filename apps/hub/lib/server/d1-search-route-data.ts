import { notGatedSql } from "@/lib/server/gated-exits";
import { visibilityBindings, visiblePostSql, visibleProfileSql } from "@/lib/server/search-visibility";
import "server-only";


import { getSeedHubpediaSearchResults } from "@/lib/encyclopedia/hubpedia-search-results";
import { normalizeHubpediaSearchText } from "@/lib/encyclopedia/search-text";
import { searchWikipediaBase } from "@/lib/encyclopedia/wikipedia/search";
import { getHubD1 } from "@/lib/server/hub-d1";
import { visibleCommunitySql, isMissingSchemaError } from "@/lib/server/community-search-visibility";
import { applyFtsPlans, likeSpellingBindings, planFts, type FtsPlan } from "@/lib/server/fts-trigram";
import { listD1ExternalVideos, listD1ExternalVideosForSearch } from "@/lib/server/d1-videos";
import { attachImagesToPosts } from "@/lib/server/social-post-images";
import { calculateEngagementScore } from "@/lib/engagement-score";
import {
  isWalletAddressQuery,
  scoreSearchFields,
  searchTerms,
  searchTextMatches,
} from "@/lib/search-relevance";
import { listD1TokenRankings, listD1TokenRankingsForSearch } from "@/lib/server/d1-token-rankings";
import { listD1PublicListings } from "@/lib/server/d1-public-listings";
import { listD1WorkListings, listD1WorkListingsForSearch } from "@/lib/server/d1-work-listings";
import { THREAD_REGION_LABELS } from "@/lib/thread-scope";
import type { HubSearchFilters } from "@/lib/search-filters";
import {
  getHubSearchDateBounds,
  hasHubSearchFilters,
  matchesHubSearchMetadata,
} from "@/lib/search-filters";
import { isApprovedSeedArticleSlug as isPublicHubpediaSlug } from "@/lib/encyclopedia/publication-manifest";
import {
  hubCategorySearchText,
  resolveHubCategoryIds,
} from "@/lib/hub-taxonomy";
import { toHubCoreSearchEntities } from "@/lib/platform/search-core-adapter";
import { parseRowTimestamp, scoreSearchResult } from "@/lib/search-score";

const RESULT_LIMIT = 20;
/** Newest community messages examined for message-only community matches (no FTS index on messages). */
const COMMUNITY_MESSAGE_SCAN_ROWS = 2000;
const COMMUNITY_MESSAGE_MATCHES = 50;

/*
 * The image-post list is a subset of the post list in practice, and both need the same
 * published-image rows. One lookup covers both; each list still gets its own images array.
 */
async function attachImagesToPostsAndImages(
  database: Parameters<typeof attachImagesToPosts>[0],
  posts: Array<{ id: string }>,
  images: Array<{ id: string }>,
) {
  await attachImagesToPosts(database, [...posts, ...images]);
  for (const item of images) {
    const own = (item as { images?: unknown[] }).images;
    if (Array.isArray(own)) Object.assign(item, { images: [...own] });
  }
}

/* The catalogue of external-shop products was removed (2026-10-15); search no longer returns products. */
function toD1SearchEntities(input: Parameters<typeof toHubCoreSearchEntities>[0]) {
  return toHubCoreSearchEntities(input);
}

type CountRow = { total_count: number };
type ProfileRow = {
  rank_score?: number | null;
  joined_at?: string | null;
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
};
type PostRow = {
  rank_score?: number | null;
  author_profile_id?: string | null;
  id: string;
  display_name: string;
  handle: string | null;
  identity_mode: "account" | "guest" | "anonymous";
  body: string;
  created_at: string;
};
type ImagePostRow = PostRow & {
  reply_count: number;
  repost_count: number;
  quote_repost_count: number;
  like_count: number;
  bookmark_count: number;
  relevance_score: number;
};
type ThreadRow = {
  rank_score?: number | null;
  id: string;
  board_key: string;
  title: string;
  post_count: number;
  updated_at: string;
  pinned: number;
  language: string | null;
  region: string | null;
};
type BoardRow = {
  id: string;
  board_key: string;
  title: string;
  slug: string;
  description: string;
  thread_count: number;
};
type HubpediaRow = {
  rank_score?: number | null;
  slug: string;
  title: string;
  category: string;
  summary: string;
};
type ActiveHubpediaRow = HubpediaRow & {
  published_at: string | null;
  updated_at: string | number | null;
};
type CommunityRow = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
};
type CommunityIdRow = { id: string };
type ListRow = { id: string; name: string; description: string };

function termsFromQuery(query: string) {
  return searchTerms(query);
}

function matchesTerms(parts: Array<string | undefined>, terms: string[]) {
  return searchTextMatches(terms.join(" "), [hubCategorySearchText(...parts)]);
}

function hasMetadataFilters(filters: HubSearchFilters): boolean {
  return Boolean(filters.language || filters.region || filters.category);
}

function keepsSearchType(filters: HubSearchFilters, source: NonNullable<HubSearchFilters["type"]>): boolean {
  return !filters.type || filters.type === source;
}

function threadRegionMetadata(region: string | null | undefined): string[] {
  if (!region) return [];
  const label = THREAD_REGION_LABELS[region as keyof typeof THREAD_REGION_LABELS];
  return label ? [region, label] : [region];
}

type SearchDateBounds = {
  fromInclusive: string | null;
  toExclusive: string | null;
};

function searchDateSql(
  expression: string,
  bounds: SearchDateBounds,
): { sql: string; bindings: string[] } {
  if (!bounds.fromInclusive && !bounds.toExclusive) return { sql: "1=1", bindings: [] };
  const value = "julianday(NULLIF(" + expression + ", ''))";
  const clauses = [value + " IS NOT NULL"];
  const bindings: string[] = [];
  if (bounds.fromInclusive) {
    clauses.push(value + " >= julianday(?)");
    bindings.push(bounds.fromInclusive);
  }
  if (bounds.toExclusive) {
    clauses.push(value + " < julianday(?)");
    bindings.push(bounds.toExclusive);
  }
  return { sql: clauses.join(" AND "), bindings };
}

function parseSearchDateValue(value: string | number): number {
  if (typeof value === "number") return value;
  const text = value.trim();
  if (!text) return Number.NaN;
  /* SQLite CURRENT_TIMESTAMP is UTC but omits the ISO `T` and `Z`. */
  const sqliteUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/u;
  return Date.parse(sqliteUtc.test(text) ? text.replace(" ", "T") + "Z" : text);
}

function searchDateMatches(
  value: string | number | null | undefined,
  bounds: SearchDateBounds,
): boolean {
  if (value === null || value === undefined || value === "") return false;
  const timestamp = parseSearchDateValue(value);
  if (!Number.isFinite(timestamp)) return false;
  const from = bounds.fromInclusive ? parseSearchDateValue(bounds.fromInclusive) : Number.NEGATIVE_INFINITY;
  const to = bounds.toExclusive ? parseSearchDateValue(bounds.toExclusive) : Number.POSITIVE_INFINITY;
  return Number.isFinite(from) || Number.isFinite(to)
    ? timestamp >= from && timestamp < to
    : false;
}

async function getD1FilteredSearchRouteData(
  query: string,
  viewerProfileId: string | null,
  filters: HubSearchFilters,
) {
  const database = getHubD1();
  const terms = termsFromQuery(query);
  const hasTerms = terms.length > 0;
  const ftsHubpediaTerms = termsFromQuery(normalizeHubpediaSearchText(query));
  const [threadsPlan, threadPostsPlan, socialPostsPlan, hubpediaPlan] = await Promise.all([
    planFts(database, "threads", terms),
    planFts(database, "thread_posts", terms),
    planFts(database, "social_posts", terms),
    planFts(database, "hubpedia", ftsHubpediaTerms),
  ]);
  const plans = { threads: threadsPlan, thread_posts: threadPostsPlan, social_posts: socialPostsPlan, hubpedia: hubpediaPlan };
  const prep = (sql: string) => database.prepare(applyFtsPlans(sql, plans));
  const walletQuery = isWalletAddressQuery(query);
  const dateBounds = getHubSearchDateBounds(filters);
  const priceActive = Boolean(filters.maxPrice);
  const metadataActive = hasMetadataFilters(filters);
  const matchesUnannotated = matchesHubSearchMetadata(filters, {});
  const viewerId = viewerProfileId ?? "";
  const visibleCommunities = visibleCommunitySql("c", viewerProfileId);
  const visibleProfileSql = "(NOT EXISTS (SELECT 1 FROM profile_moderation_status moderation "
    + "WHERE moderation.profile_id = p.id AND moderation.status = 'suspended') "
    + "AND NOT EXISTS (SELECT 1 FROM thread_user_controls control "
    + "WHERE ? <> '' AND ((control.owner_profile_id = ? AND control.target_profile_id = p.id "
    + "AND (control.muted = 1 OR control.blocked = 1)) "
    + "OR (control.owner_profile_id = p.id AND control.target_profile_id = ? AND control.blocked = 1))))";
  const visibleProfileBindings = () => [viewerId, viewerId, viewerId];
  const visiblePostBaseSql = "(p.author_profile_id IS NULL OR ("
    + "NOT EXISTS (SELECT 1 FROM profile_moderation_status moderation "
    + "WHERE moderation.profile_id = p.author_profile_id AND moderation.status = 'suspended') "
    + "AND NOT EXISTS (SELECT 1 FROM thread_user_controls control "
    + "WHERE ? <> '' AND ((control.owner_profile_id = ? AND control.target_profile_id = p.author_profile_id "
    + "AND (control.muted = 1 OR control.blocked = 1)) "
    + "OR (control.owner_profile_id = p.author_profile_id AND control.target_profile_id = ? AND control.blocked = 1)))))";
  const visiblePostSql = `(${visiblePostBaseSql} AND ${notGatedSql("post", "p.id")})`;
  const visiblePostBindings = () => [viewerId, viewerId, viewerId];
  const hubpediaTerms = termsFromQuery(normalizeHubpediaSearchText(query));
  const boardWhere = hasTerms
    ? terms.map(() => "(lower(b.title || ' ' || b.slug || ' ' || b.description) LIKE ? ESCAPE '\\' OR lower(b.title || ' ' || b.slug || ' ' || b.description) LIKE ? ESCAPE '\\')").join(" AND ")
    : "1=1";
  const boardBindings = likeSpellingBindings(terms);
  const encyclopediaWhere = hubpediaTerms.length > 0
    ? hubpediaTerms.map(() => "(lower(r.title || ' ' || coalesce(r.summary, '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.reading'), '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.aliases'), '')) LIKE ? ESCAPE '\\' OR lower(r.title || ' ' || coalesce(r.summary, '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.reading'), '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.aliases'), '')) LIKE ? ESCAPE '\\')").join(" AND ")
    : "1=1";
  const encyclopediaBindings = likeSpellingBindings(hubpediaTerms);
  const communityMessageWhere = hasTerms
    ? terms.map(() => "(lower(m.body) LIKE ? ESCAPE '\\' OR lower(m.body) LIKE ? ESCAPE '\\')").join(" AND ")
    : "1=1";
  const communityMessageBindings = likeSpellingBindings(terms);
  const imageWhere = hasTerms
    ? terms.map(() => "(lower(coalesce(i.alt_text, '') || ' ' || p.display_name || ' ' || coalesce(p.handle, '') || ' ' || p.body) LIKE ? ESCAPE '\\' OR lower(coalesce(i.alt_text, '') || ' ' || p.display_name || ' ' || coalesce(p.handle, '') || ' ' || p.body) LIKE ? ESCAPE '\\')").join(" AND ")
    : "1=1";
  const imageBindings = likeSpellingBindings(terms);
  const normalizedImageQuery = query.normalize("NFKC").toLocaleLowerCase("ja").trim();
  const imageRelevanceSql = hasTerms
    ? "MAX(CASE WHEN lower(trim(coalesce(i.alt_text, ''))) = ? THEN 80 ELSE 0 END + CASE WHEN instr(lower(coalesce(i.alt_text, '')), ?) > 0 THEN 40 ELSE 0 END + CASE WHEN instr(lower(p.body), ?) > 0 THEN 20 ELSE 0 END + CASE WHEN instr(lower(p.display_name || ' ' || coalesce(p.handle, '')), ?) > 0 THEN 10 ELSE 0 END) AS relevance_score, "
    : "0 AS relevance_score, ";
  const imageRelevanceBindings = hasTerms
    ? [normalizedImageQuery, normalizedImageQuery, normalizedImageQuery, normalizedImageQuery]
    : [];
  const includeProfiles = !dateBounds.fromInclusive
    && !dateBounds.toExclusive
    && !metadataActive
    && !priceActive
    && (!filters.type || filters.type === "profiles");

  /* A maximum price only ever applied to the removed product catalogue, so nothing can match it. */
  if (priceActive) {
    return {
      query,
      counts: {
        boards: 0, profiles: 0, threads: 0, posts: 0, images: 0,
        hubpedia: 0, communities: 0, videos: 0, products: 0,
        lists: 0, tokens: 0, work: 0, listings: 0,
      },
      boards: [], profiles: [], threads: [], posts: [], images: [],
      hubpedia: [], communities: [], videos: [], products: [],
      lists: [], tokens: [], work: [], listings: [], coreEntities: [],
    };
  }

  const postDate = searchDateSql("p.created_at", dateBounds);
  const imageDate = searchDateSql("p.created_at", dateBounds);
  const threadDate = searchDateSql("t.updated_at", dateBounds);
  const boardDate = searchDateSql("b.updated_at", dateBounds);
  const legacyHubpediaDate = searchDateSql("COALESCE(NULLIF(a.published_at, ''), NULLIF(a.updated_at, ''))", dateBounds);
  const communityDate = searchDateSql("c.updated_at", dateBounds);
  const listDate = searchDateSql("l.updated_at", dateBounds);
  const [
    postResult,
    imagePostResult,
    threadResult,
    threadPostResult,
    boardResult,
    hubpediaResult,
    encyclopediaHubpediaResult,
    videoCatalog,
    tokenCatalog,
    workCatalog,
    publicListings,
    communityResult,
    communityMessageResult,
    listResult,
  ] = await Promise.all([
    hasTerms
      ? prep(
        "SELECT p.id, p.display_name, p.handle, p.identity_mode, p.body, p.created_at FROM social_posts_fts f JOIN social_posts p ON p.rowid = f.rowid WHERE social_posts_fts MATCH ? AND p.moderated_at IS NULL AND " + visiblePostSql + " AND " + postDate.sql + " ORDER BY bm25(social_posts_fts, 5.0, 4.0, 1.0), p.created_at DESC, p.id ASC",
      ).bind(socialPostsPlan.bind, ...visiblePostBindings(), ...postDate.bindings).all<PostRow>()
      : prep(
        "SELECT p.id, p.display_name, p.handle, p.identity_mode, p.body, p.created_at FROM social_posts p WHERE p.moderated_at IS NULL AND " + visiblePostSql + " AND " + postDate.sql + " ORDER BY p.created_at DESC, p.id ASC",
      ).bind(...visiblePostBindings(), ...postDate.bindings).all<PostRow>(),
    prep(
      "SELECT p.id, p.display_name, p.handle, p.identity_mode, p.body, p.created_at, "
      + imageRelevanceSql
      + "(SELECT count(*) FROM social_posts r WHERE r.reply_to_post_id = p.id AND r.moderated_at IS NULL) AS reply_count, "
      + "(SELECT count(*) FROM social_posts r WHERE r.repost_of_target_type = 'social_post' AND r.repost_of_target_id = p.id AND r.moderated_at IS NULL) AS repost_count, "
      + "(SELECT count(*) FROM social_posts r WHERE r.quote_of_target_type = 'social_post' AND r.quote_of_target_id = p.id AND r.moderated_at IS NULL) AS quote_repost_count, "
      + "(SELECT count(*) FROM reactions r WHERE r.target_type = 'social_post' AND r.target_id = p.id AND r.kind = 'like') AS like_count, "
      + "(SELECT count(*) FROM bookmarks b WHERE b.target_type = 'social_post' AND b.target_id = p.id) AS bookmark_count "
      + "FROM social_post_images i JOIN social_posts p ON p.id = i.post_id WHERE i.status = 'published' AND i.safety_status = 'clean' "
      + "AND p.moderated_at IS NULL AND " + visiblePostSql + " AND " + imageWhere + " AND " + imageDate.sql
      + " GROUP BY p.id ORDER BY relevance_score DESC, (reply_count * 3 + repost_count * 5 + quote_repost_count * 6 + like_count + bookmark_count * 4) DESC, p.created_at DESC, p.id ASC",
    ).bind(...imageRelevanceBindings, ...visiblePostBindings(), ...imageBindings, ...imageDate.bindings).all<ImagePostRow>(),
    hasTerms
      ? prep(
        "SELECT t.id, b.board_key, t.title, (SELECT count(*) FROM thread_posts tp WHERE tp.thread_id = t.id) AS post_count, t.updated_at, t.pinned, t.language, t.region FROM threads_fts f JOIN threads t ON t.rowid = f.rowid JOIN boards b ON b.id = t.board_id WHERE threads_fts MATCH ? AND " + notGatedSql("thread", "t.id") + " AND " + threadDate.sql + " ORDER BY bm25(threads_fts, 10.0), t.pinned DESC, t.updated_at DESC, t.id ASC",
      ).bind(threadsPlan.bind, ...threadDate.bindings).all<ThreadRow>()
      : prep(
        "SELECT t.id, b.board_key, t.title, (SELECT count(*) FROM thread_posts tp WHERE tp.thread_id = t.id) AS post_count, t.updated_at, t.pinned, t.language, t.region FROM threads t JOIN boards b ON b.id = t.board_id WHERE " + notGatedSql("thread", "t.id") + " AND " + threadDate.sql + " ORDER BY t.pinned DESC, t.updated_at DESC, t.id ASC",
      ).bind(...threadDate.bindings).all<ThreadRow>(),
    hasTerms
      ? prep(
        "SELECT DISTINCT t.id, b.board_key, t.title, (SELECT count(*) FROM thread_posts counted WHERE counted.thread_id = t.id) AS post_count, t.updated_at, t.pinned, t.language, t.region FROM thread_posts_fts f JOIN thread_posts tp ON tp.rowid = f.rowid JOIN threads t ON t.id = tp.thread_id JOIN boards b ON b.id = t.board_id WHERE thread_posts_fts MATCH ? AND tp.deleted_at IS NULL AND tp.moderated_at IS NULL AND " + notGatedSql("thread", "t.id") + " AND " + threadDate.sql + " ORDER BY t.pinned DESC, t.updated_at DESC, t.id ASC",
      ).bind(threadPostsPlan.bind, ...threadDate.bindings).all<ThreadRow>()
      : Promise.resolve({ results: [] as ThreadRow[] }),
    prep(
      "SELECT b.id, b.board_key, b.title, b.slug, b.description, (SELECT count(*) FROM threads t WHERE t.board_id = b.id) AS thread_count FROM boards b WHERE " + boardWhere + " AND " + boardDate.sql + " ORDER BY b.updated_at DESC, b.id ASC",
    ).bind(...boardBindings, ...boardDate.bindings).all<BoardRow>(),
    hasTerms
      ? prep(
        "SELECT a.slug, a.title, a.category, a.summary, a.published_at, a.updated_at FROM hubpedia_articles_fts f JOIN hubpedia_articles a ON a.rowid = f.rowid WHERE hubpedia_articles_fts MATCH ? AND a.status = 'published' AND EXISTS (SELECT 1 FROM hubpedia_publication_approvals approval WHERE approval.article_slug=a.slug AND approval.revoked_at IS NULL) AND " + legacyHubpediaDate.sql + " ORDER BY bm25(hubpedia_articles_fts, 12.0, 10.0, 8.0, 4.0, 1.0, 3.0), a.published_at DESC, a.slug ASC",
      ).bind(hubpediaPlan.bind, ...legacyHubpediaDate.bindings).all<ActiveHubpediaRow>()
      : prep(
        "SELECT a.slug, a.title, a.category, a.summary, a.published_at, a.updated_at FROM hubpedia_articles a WHERE a.status = 'published' AND EXISTS (SELECT 1 FROM hubpedia_publication_approvals approval WHERE approval.article_slug=a.slug AND approval.revoked_at IS NULL) AND " + legacyHubpediaDate.sql + " ORDER BY COALESCE(a.published_at, a.updated_at) DESC, a.slug ASC",
      ).bind(...legacyHubpediaDate.bindings).all<ActiveHubpediaRow>(),
    prep(
      "SELECT a.slug, r.title, coalesce(json_extract(r.generation_metadata, '$.categoryIds[0]'), t.topic_type) AS category, coalesce(r.summary, '') AS summary, approval.approved_at AS published_at, a.updated_at AS updated_at FROM encyclopedia_articles a JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id JOIN encyclopedia_topics t ON t.id = a.topic_id JOIN hubpedia_publication_approvals approval ON approval.article_slug=a.slug AND approval.revoked_at IS NULL AND approval.approved_revision_key='db:'||r.revision_number WHERE a.status = 'published' AND EXISTS (SELECT 1 FROM hubpedia_publication_eligible_articles eligible WHERE eligible.article_slug=a.slug AND eligible.revision_id=a.current_revision_id) AND " + encyclopediaWhere + " ORDER BY a.updated_at DESC, a.slug ASC",
    ).bind(...encyclopediaBindings).all<ActiveHubpediaRow>(),
    listD1ExternalVideosForSearch(database, dateBounds),
    listD1TokenRankingsForSearch(database, dateBounds),
    listD1WorkListingsForSearch(database, viewerProfileId, dateBounds),
    listD1PublicListings(database, { searchDateBounds: dateBounds, unbounded: true }),
    prep(
      "SELECT id, slug, name, description, category FROM communities c WHERE " + communityDate.sql + " AND " + visibleCommunities.sql + " ORDER BY c.updated_at DESC, c.id ASC",
    ).bind(...communityDate.bindings, ...visibleCommunities.bindings).all<CommunityRow>(),
    prep(
      "SELECT DISTINCT c.id FROM community_channel_messages m JOIN community_channels ch ON ch.id = m.channel_id JOIN communities c ON c.id = ch.community_id WHERE " + notGatedSql("channel", "m.channel_id") + " AND " + visibleCommunities.sql + " AND " + communityMessageWhere,
    ).bind(...visibleCommunities.bindings, ...communityMessageBindings).all<CommunityIdRow>(),
    prep(
      "SELECT l.id, l.name, l.description FROM user_lists l WHERE l.visibility = 'public' AND " + listDate.sql + " ORDER BY l.updated_at DESC, l.id ASC",
    ).bind(...listDate.bindings).all<ListRow>(),
  ]);

  const profileResult = includeProfiles
    ? await prep(
      "SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url FROM profiles p WHERE " + visibleProfileSql + " ORDER BY p.joined_at DESC, p.id ASC",
    ).bind(...visibleProfileBindings()).all<ProfileRow>()
    : { results: [] as ProfileRow[] };
  const walletProfileResult = includeProfiles && walletQuery
    ? await prep(
      "SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url FROM profile_wallet_links wallet JOIN profiles p ON p.id = wallet.profile_id WHERE lower(wallet.wallet_address) = ? AND wallet.visibility = 'public' AND " + visibleProfileSql + " ORDER BY p.joined_at DESC, p.id ASC",
    ).bind(query.toLocaleLowerCase("en"), ...visibleProfileBindings()).all<ProfileRow>()
    : { results: [] as ProfileRow[] };
  const matchedProfileRows = walletQuery
    ? []
    : profileResult.results.filter((profile) => !hasTerms || searchTextMatches(query, [profile.handle, profile.display_name, profile.bio]));
  const fullProfiles = [...walletProfileResult.results, ...matchedProfileRows]
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
    .map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
      bio: row.bio,
      avatarUrl: row.avatar_url,
    }));

  const postRows = [...postResult.results, ...imagePostResult.results].filter(
    (row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index,
  );
  const fullPosts = postRows.filter(() => matchesUnannotated).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    handle: row.handle,
    identityMode: row.identity_mode,
    body: row.body,
    createdAt: row.created_at,
    hubCategoryIds: resolveHubCategoryIds(row.body),
  }));
  const fullImagePosts = imagePostResult.results.filter(() => matchesUnannotated).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    handle: row.handle,
    identityMode: row.identity_mode,
    body: row.body,
    createdAt: row.created_at,
    replyCount: Number(row.reply_count),
    repostCount: Number(row.repost_count),
    quoteRepostCount: Number(row.quote_repost_count),
    likeCount: Number(row.like_count),
    score: calculateEngagementScore({
      replyCount: Number(row.reply_count),
      repostCount: Number(row.repost_count),
      quoteRepostCount: Number(row.quote_repost_count),
      likeCount: Number(row.like_count),
      bookmarkCount: Number(row.bookmark_count),
    }),
    relevanceScore: Number(row.relevance_score),
  }));
  await attachImagesToPostsAndImages(database, fullPosts, fullImagePosts);
  const fullImages = fullImagePosts;

  const fullThreads = [...threadResult.results, ...threadPostResult.results]
    .filter((row, index, rows) => rows.findIndex((candidate) => candidate.id === row.id) === index)
    .filter((row) => matchesHubSearchMetadata(filters, {
      language: row.language,
      regions: threadRegionMetadata(row.region),
    }))
    .map((row) => ({
      id: row.id,
      boardKey: row.board_key,
      title: row.title,
      postCount: row.post_count,
      updatedAt: row.updated_at,
      pinned: row.pinned === 1,
      hubCategoryIds: resolveHubCategoryIds(row.board_key, row.title),
    }))
    .sort((left, right) =>
      scoreSearchFields(query, [{ value: right.title, weight: 12 }, { value: right.boardKey, weight: 4 }])
      - scoreSearchFields(query, [{ value: left.title, weight: 12 }, { value: left.boardKey, weight: 4 }])
      || right.postCount - left.postCount
      || right.updatedAt.localeCompare(left.updatedAt)
      || left.id.localeCompare(right.id),
    );
  const fullBoards = boardResult.results
    .filter(() => matchesUnannotated)
    .map((row) => ({
      id: row.id,
      key: row.board_key,
      title: row.title,
      slug: row.slug,
      description: row.description,
      threadCount: row.thread_count,
      hubCategoryIds: resolveHubCategoryIds(row.title, row.slug, row.description),
    }))
    .sort((left, right) =>
      scoreSearchFields(query, [{ value: right.title, weight: 10 }, { value: right.slug, weight: 7 }, { value: right.description, weight: 2 }])
      - scoreSearchFields(query, [{ value: left.title, weight: 10 }, { value: left.slug, weight: 7 }, { value: left.description, weight: 2 }])
      || right.threadCount - left.threadCount
      || left.id.localeCompare(right.id),
    );

  const generatedHubpedia = encyclopediaHubpediaResult.results
    .filter((row) => searchDateMatches(row.published_at || row.updated_at, dateBounds))
    .filter((row) => matchesHubSearchMetadata(filters, { categories: [row.category] }))
    .map((row) => ({
      slug: row.slug,
      title: row.title,
      category: row.category,
      summary: row.summary,
      href: "/hubpedia/" + encodeURIComponent(row.slug),
      hubCategoryIds: resolveHubCategoryIds(row.category, row.title, row.summary),
    }));
  const databaseHubpedia = hubpediaResult.results
    .filter((row) => matchesHubSearchMetadata(filters, { categories: [row.category] }))
    .map((row) => ({
    slug: row.slug,
    title: row.title,
    category: row.category,
    summary: row.summary,
    href: "/hubpedia/" + encodeURIComponent(row.slug),
    hubCategoryIds: resolveHubCategoryIds(row.category, row.title, row.summary),
    }));
  const ledgerFullHubpedia = [...generatedHubpedia, ...databaseHubpedia].filter(
    (article, index, articles) => articles.findIndex((candidate) => candidate.slug === article.slug) === index,
  );
  /* Wikipedia base hits carry no date or category metadata, so they join only when no such filter is active. */
  const ledgerFullSlugs = new Set(ledgerFullHubpedia.map((article) => article.slug));
  const wikipediaFullHubpedia = hasTerms && !dateBounds.fromInclusive && !dateBounds.toExclusive && !metadataActive
    ? (await searchWikipediaBase(database, query, { limit: RESULT_LIMIT })).hits
      .filter((hit) => !ledgerFullSlugs.has(hit.slug))
      .map((hit) => ({ ...hit, hubCategoryIds: [] as ReturnType<typeof resolveHubCategoryIds> }))
    : [];
  const fullHubpedia = [...ledgerFullHubpedia, ...wikipediaFullHubpedia];
  const fullVideos = videoCatalog
    .filter((item) => matchesTerms([item.title, item.channel, item.category, item.topic], terms))
    .filter((item) => matchesHubSearchMetadata(filters, { categories: [item.category] }))
    .map((item) => ({
      id: item.id,
      title: item.title,
      channel: item.channel,
      category: item.category,
      topic: item.topic,
      provider: item.provider,
      /* A gated video shows its title only: no cover, and a lock mark for the card. */
      thumbnailUrl: item.accessGate ? undefined : item.thumbnailUrl,
      gated: Boolean(item.accessGate),
      hubCategoryIds: resolveHubCategoryIds(item.category, item.topic, item.title),
    }))
    .sort((left, right) =>
      scoreSearchFields(query, [{ value: right.title, weight: 12 }, { value: right.channel, weight: 7 }, { value: right.topic, weight: 5 }, { value: right.category, weight: 3 }])
      - scoreSearchFields(query, [{ value: left.title, weight: 12 }, { value: left.channel, weight: 7 }, { value: left.topic, weight: 5 }, { value: left.category, weight: 3 }])
      || left.id.localeCompare(right.id),
    );
  const communityMessageIds = new Set(communityMessageResult.results.map((entry) => entry.id));
  const fullCommunities = communityResult.results
    .filter((item) => matchesTerms([item.name, item.description, item.category], terms) || communityMessageIds.has(item.id))
    .filter((item) => matchesHubSearchMetadata(filters, { categories: [item.category] }))
    .map((item) => ({
      ...item,
      hubCategoryIds: resolveHubCategoryIds(item.category, item.name, item.description),
    }))
    .sort((left, right) =>
      scoreSearchFields(query, [{ value: right.name, weight: 12 }, { value: right.category, weight: 5 }, { value: right.description, weight: 2 }])
      - scoreSearchFields(query, [{ value: left.name, weight: 12 }, { value: left.category, weight: 5 }, { value: left.description, weight: 2 }])
      || left.id.localeCompare(right.id),
    );
  const fullLists = listResult.results
    .filter((item) => matchesTerms([item.name, item.description], terms))
    .filter(() => matchesUnannotated)
    .sort((left, right) =>
      scoreSearchFields(query, [{ value: right.name, weight: 12 }, { value: right.description, weight: 2 }])
      - scoreSearchFields(query, [{ value: left.name, weight: 12 }, { value: left.description, weight: 2 }])
      || left.id.localeCompare(right.id),
    );
  const fullTokens = tokenCatalog
    .filter((item) => matchesTerms([item.title, item.symbol, item.network, item.description], terms))
    .filter(() => matchesUnannotated)
    .sort((left, right) =>
      scoreSearchFields(query, [{ value: right.symbol, weight: 12 }, { value: right.title, weight: 10 }, { value: right.network, weight: 4 }, { value: right.description, weight: 2 }])
      - scoreSearchFields(query, [{ value: left.symbol, weight: 12 }, { value: left.title, weight: 10 }, { value: left.network, weight: 4 }, { value: left.description, weight: 2 }])
      || left.id.localeCompare(right.id),
    )
    .map((item) => ({
      id: item.id,
      title: item.title,
      symbol: item.symbol,
      network: item.network,
      description: item.description,
    }));
  const fullWork = workCatalog
    .filter((item) => item.status === "published")
    .filter((item) => matchesTerms([item.title, item.ownerName, item.ownerHandle, item.summary, item.category, item.location, item.compensationLabel, ...item.skills], terms))
    .filter((item) => matchesHubSearchMetadata(filters, { categories: [item.category] }))
    .map((item) => ({
      id: item.id,
      kind: item.kind === "request" ? ("project" as const) : item.kind,
      title: item.title,
      organization: item.ownerName,
      summary: item.summary,
      location: item.location,
      compensation: item.compensationLabel,
      tags: item.skills,
    }));
  const fullListings = publicListings
    .filter((item) => matchesTerms([item.title, item.summary, item.category, item.providerLabel, item.region, item.locality], terms))
    .filter((item) => matchesHubSearchMetadata(filters, {
      regions: [item.region, item.locality],
      categories: [item.category],
    }))
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      title: item.title,
      summary: item.summary,
      category: item.category,
      providerLabel: item.providerLabel,
      providerUrl: item.providerUrl,
      region: item.region,
      locality: item.locality,
      priceLabel: item.priceLabel,
      trustStatus: item.trustStatus,
      updatedAt: item.updatedAt,
    }));
  const fullPostResults = fullPosts
    .sort((left, right) =>
      scoreSearchFields(query, [{ value: right.handle, weight: 10 }, { value: right.displayName, weight: 8 }, { value: right.body, weight: 3 }])
      - scoreSearchFields(query, [{ value: left.handle, weight: 10 }, { value: left.displayName, weight: 8 }, { value: left.body, weight: 3 }])
      || right.createdAt.localeCompare(left.createdAt)
      || left.id.localeCompare(right.id),
    );
  const selectedProfiles = keepsSearchType(filters, "profiles") ? fullProfiles : [];
  const selectedPosts = keepsSearchType(filters, "posts") ? fullPostResults : [];
  const selectedImages = keepsSearchType(filters, "images") ? fullImages : [];
  const selectedThreads = keepsSearchType(filters, "threads") ? fullThreads : [];
  const selectedBoards = keepsSearchType(filters, "boards") ? fullBoards : [];
  const selectedHubpedia = keepsSearchType(filters, "hubpedia") ? fullHubpedia : [];
  const selectedCommunities = keepsSearchType(filters, "communities") ? fullCommunities : [];
  const selectedVideos = keepsSearchType(filters, "videos") ? fullVideos : [];
  const selectedLists = keepsSearchType(filters, "lists") ? fullLists : [];
  const selectedTokens = keepsSearchType(filters, "tokens") ? fullTokens : [];
  const selectedWork = keepsSearchType(filters, "work") ? fullWork : [];
  const selectedListings = keepsSearchType(filters, "listings") ? fullListings : [];
  const coreEntities = toD1SearchEntities({
    profiles: selectedProfiles,
    posts: selectedPosts,
    threads: selectedThreads,
    boards: selectedBoards,
    hubpedia: selectedHubpedia,
    communities: selectedCommunities,
    videos: selectedVideos,
    lists: selectedLists,
    tokens: selectedTokens,
    work: selectedWork,
    listings: selectedListings,
  });
  return {
    query,
    counts: {
      boards: selectedBoards.length,
      profiles: selectedProfiles.length,
      threads: selectedThreads.length,
      posts: selectedPosts.length,
      images: selectedImages.length,
      hubpedia: selectedHubpedia.length,
      communities: selectedCommunities.length,
      videos: selectedVideos.length,
      products: 0,
      lists: selectedLists.length,
      tokens: selectedTokens.length,
      work: selectedWork.length,
      listings: selectedListings.length,
    },
    boards: selectedBoards.slice(0, RESULT_LIMIT),
    profiles: selectedProfiles.slice(0, RESULT_LIMIT),
    threads: selectedThreads.slice(0, RESULT_LIMIT),
    posts: selectedPosts.slice(0, RESULT_LIMIT),
    images: selectedImages.slice(0, RESULT_LIMIT),
    hubpedia: selectedHubpedia.slice(0, RESULT_LIMIT),
    communities: selectedCommunities.slice(0, RESULT_LIMIT),
    videos: selectedVideos.slice(0, RESULT_LIMIT),
    products: [],
    lists: selectedLists.slice(0, RESULT_LIMIT),
    tokens: selectedTokens.slice(0, RESULT_LIMIT),
    work: selectedWork.slice(0, RESULT_LIMIT),
    listings: selectedListings.slice(0, RESULT_LIMIT),
    coreEntities,
  };
}

export async function getD1SearchRouteData(
  query: string,
  viewerProfileId: string | null = null,
  filters?: HubSearchFilters,
) {
  const terms = termsFromQuery(query);
  if (filters && hasHubSearchFilters(filters)) {
    return getD1FilteredSearchRouteData(query, viewerProfileId, filters);
  }
  if (terms.length === 0) {
    return {
      query,
      counts: {
        boards: 0,
        profiles: 0,
        threads: 0,
        posts: 0,
        images: 0,
        hubpedia: 0,
        communities: 0,
        videos: 0,
        products: 0,
        lists: 0,
        tokens: 0,
        work: 0,
        listings: 0,
      },
      boards: [],
      profiles: [],
      threads: [],
      posts: [],
      images: [],
      hubpedia: [],
      communities: [],
      videos: [],
      products: [],
      lists: [],
      tokens: [],
      work: [],
      listings: [],
      coreEntities: [],
    };
  }

  const database = getHubD1();
  const ftsHubpediaTerms = termsFromQuery(normalizeHubpediaSearchText(query));
  const [profilesPlan, threadsPlan, threadPostsPlan, socialPostsPlan, hubpediaPlan, communitiesPlan] = await Promise.all([
    planFts(database, "profiles", terms),
    planFts(database, "threads", terms),
    planFts(database, "thread_posts", terms),
    planFts(database, "social_posts", terms),
    planFts(database, "hubpedia", ftsHubpediaTerms),
    planFts(database, "communities", terms).catch((cause: unknown): FtsPlan => {
      /* Short terms scan the source table, long ones read communities_fts; a missing 0299 table must not fail the whole search. */
      if (isMissingSchemaError(cause)) return { table: "communities", ranked: true, bind: "\"\"" };
      throw cause;
    }),
  ]);
  const visibleCommunities = visibleCommunitySql("c", viewerProfileId);
  const plans = { profiles: profilesPlan, threads: threadsPlan, thread_posts: threadPostsPlan, social_posts: socialPostsPlan, hubpedia: hubpediaPlan, communities: communitiesPlan };
  const prep = (sql: string) => database.prepare(applyFtsPlans(sql, plans));
  const viewerId = viewerProfileId ?? "";
  const visibleProfileBindings = () => visibilityBindings(viewerProfileId);
  const visiblePostBindings = () => visibilityBindings(viewerProfileId);
  const walletQuery = isWalletAddressQuery(query);
  const publicWalletProfilesPromise = walletQuery
    ? prep
        (
          `SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url
        FROM profile_wallet_links wallet
        JOIN profiles p ON p.id = wallet.profile_id
        WHERE lower(wallet.wallet_address) = ? AND wallet.visibility = 'public' AND ${visibleProfileSql}
        LIMIT ?`,
        )
        .bind(
          query.toLocaleLowerCase("en"),
          ...visibleProfileBindings(),
          RESULT_LIMIT,
        )
        .all<ProfileRow>()
        .then((result) => result.results)
    : Promise.resolve([] as ProfileRow[]);
  const tokenCatalogPromise = listD1TokenRankings(database);
  const publicListingsPromise = listD1PublicListings(database, {
    query,
    limit: RESULT_LIMIT,
  }).catch(() => []);
  const workListingsPromise = listD1WorkListings(database, viewerProfileId);
  /* Japanese Wikipedia base layer: title prefix hits, appended after every Hub ledger result. */
  const wikipediaPromise = searchWikipediaBase(database, query, { limit: RESULT_LIMIT });
  const seedHubpedia = await getSeedHubpediaSearchResults(query, RESULT_LIMIT);
  const hubpediaTerms = termsFromQuery(normalizeHubpediaSearchText(query));
  const boardWhere = terms
    .map(
      () =>
        "(lower(b.title || ' ' || b.slug || ' ' || b.description) LIKE ? ESCAPE '\\' OR lower(b.title || ' ' || b.slug || ' ' || b.description) LIKE ? ESCAPE '\\')",
    )
    .join(" AND ");
  const boardBindings = likeSpellingBindings(terms);
  const encyclopediaWhere = hubpediaTerms
    .map(
      () =>
        "(lower(r.title || ' ' || coalesce(r.summary, '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.reading'), '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.aliases'), '')) LIKE ? ESCAPE '\\' OR lower(r.title || ' ' || coalesce(r.summary, '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.reading'), '') || ' ' || coalesce(json_extract(r.generation_metadata, '$.aliases'), '')) LIKE ? ESCAPE '\\')",
    )
    .join(" AND ");
  const encyclopediaBindings = likeSpellingBindings(hubpediaTerms);
  const communityMessageWhere = terms
    .map(() => "(lower(m.body) LIKE ? ESCAPE '\\' OR lower(m.body) LIKE ? ESCAPE '\\')")
    .join(" AND ");
  const communityMessageBindings = likeSpellingBindings(terms);

  const imageWhere = terms
    .map(
      () =>
        "(lower(coalesce(i.alt_text, '') || ' ' || p.display_name || ' ' || coalesce(p.handle, '') || ' ' || p.body) LIKE ? ESCAPE '\\' OR lower(coalesce(i.alt_text, '') || ' ' || p.display_name || ' ' || coalesce(p.handle, '') || ' ' || p.body) LIKE ? ESCAPE '\\')",
    )
    .join(" AND ");
  const imageBindings = likeSpellingBindings(terms);
  const normalizedImageQuery = query
    .normalize("NFKC")
    .toLocaleLowerCase("ja")
    .trim();
  /* The counts do not depend on the result queries, so they run alongside them instead of after. */
  const countsPromise = Promise.all([
    prep
      (
        `SELECT count(*) AS total_count FROM profiles_fts f JOIN profiles p ON p.rowid = f.rowid WHERE profiles_fts MATCH ? AND ${visibleProfileSql}`,
      )
      .bind(profilesPlan.bind, ...visibleProfileBindings())
      .first<CountRow>(),
    prep
      (
        `SELECT count(*) AS total_count FROM social_posts_fts f JOIN social_posts p ON p.rowid = f.rowid WHERE social_posts_fts MATCH ? AND p.moderated_at IS NULL AND ${visiblePostSql}`,
      )
      .bind(socialPostsPlan.bind, ...visiblePostBindings())
      .first<CountRow>(),
    prep
      (
        `SELECT count(*) AS total_count FROM (
      SELECT t.id AS id FROM threads_fts f JOIN threads t ON t.rowid = f.rowid WHERE threads_fts MATCH ? AND ${notGatedSql("thread", "t.id")}
      UNION
      SELECT tp.thread_id AS id FROM thread_posts_fts f JOIN thread_posts tp ON tp.rowid = f.rowid
      WHERE thread_posts_fts MATCH ? AND tp.deleted_at IS NULL AND tp.moderated_at IS NULL AND ${notGatedSql("thread", "tp.thread_id")}
    )`,
      )
      .bind(threadsPlan.bind, threadPostsPlan.bind)
      .first<CountRow>(),
    prep
      (
        `SELECT count(*) AS total_count FROM boards b WHERE ${boardWhere}`,
      )
      .bind(...boardBindings)
      .first<CountRow>(),
    prep
      (
        "SELECT count(*) AS total_count FROM hubpedia_articles_fts f JOIN hubpedia_articles a ON a.rowid = f.rowid WHERE hubpedia_articles_fts MATCH ? AND a.status = 'published' AND EXISTS (SELECT 1 FROM hubpedia_publication_approvals approval WHERE approval.article_slug=a.slug AND approval.revoked_at IS NULL)",
      )
      .bind(hubpediaPlan.bind)
      .first<CountRow>(),
    prep
      (
        `SELECT count(*) AS total_count FROM encyclopedia_articles a JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id WHERE a.status = 'published' AND EXISTS (SELECT 1 FROM hubpedia_publication_approvals approval WHERE approval.article_slug=a.slug AND approval.revoked_at IS NULL AND approval.approved_revision_key='db:'||r.revision_number) AND EXISTS (SELECT 1 FROM hubpedia_publication_eligible_articles eligible WHERE eligible.article_slug=a.slug AND eligible.revision_id=a.current_revision_id) AND ${encyclopediaWhere}`,
      )
      .bind(...encyclopediaBindings)
      .first<CountRow>(),
  ]);
  countsPromise.catch(() => undefined);
  const [
    profileResult,
    postResult,
    imagePostResult,
    threadResult,
    threadPostResult,
    boardResult,
    hubpediaResult,
    encyclopediaHubpediaResult,
    videoCatalog,
    communityResult,
    communityMessageResult,
    listResult,
  ] = await Promise.all([
    prep
      (
        `SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url, p.joined_at, bm25(profiles_fts, 10.0, 8.0, 1.0) AS rank_score FROM profiles_fts f JOIN profiles p ON p.rowid = f.rowid WHERE profiles_fts MATCH ? AND ${visibleProfileSql} ORDER BY bm25(profiles_fts, 10.0, 8.0, 1.0), p.joined_at DESC LIMIT ?`,
      )
      .bind(profilesPlan.bind, ...visibleProfileBindings(), RESULT_LIMIT)
      .all<ProfileRow>(),
    prep
      (
        `SELECT p.id, p.author_profile_id, p.display_name, p.handle, p.identity_mode, p.body, p.created_at, bm25(social_posts_fts, 5.0, 4.0, 1.0) AS rank_score FROM social_posts_fts f JOIN social_posts p ON p.rowid = f.rowid WHERE social_posts_fts MATCH ? AND p.moderated_at IS NULL AND ${visiblePostSql} ORDER BY bm25(social_posts_fts, 5.0, 4.0, 1.0), p.created_at DESC LIMIT ?`,
      )
      .bind(socialPostsPlan.bind, ...visiblePostBindings(), RESULT_LIMIT)
      .all<PostRow>(),
    prep
      (
        `SELECT p.id, p.author_profile_id, p.display_name, p.handle, p.identity_mode, p.body, p.created_at,
      MAX(
        CASE WHEN lower(trim(coalesce(i.alt_text, ''))) = ? THEN 80 ELSE 0 END +
        CASE WHEN instr(lower(coalesce(i.alt_text, '')), ?) > 0 THEN 40 ELSE 0 END +
        CASE WHEN instr(lower(p.body), ?) > 0 THEN 20 ELSE 0 END +
        CASE WHEN instr(lower(p.display_name || ' ' || coalesce(p.handle, '')), ?) > 0 THEN 10 ELSE 0 END
      ) AS relevance_score,
      (SELECT count(*) FROM social_posts r WHERE r.reply_to_post_id = p.id AND r.moderated_at IS NULL) AS reply_count,
      (SELECT count(*) FROM social_posts r WHERE r.repost_of_target_type = 'social_post' AND r.repost_of_target_id = p.id AND r.moderated_at IS NULL) AS repost_count,
      (SELECT count(*) FROM social_posts r WHERE r.quote_of_target_type = 'social_post' AND r.quote_of_target_id = p.id AND r.moderated_at IS NULL) AS quote_repost_count,
      (SELECT count(*) FROM reactions r WHERE r.target_type = 'social_post' AND r.target_id = p.id AND r.kind = 'like') AS like_count,
      (SELECT count(*) FROM bookmarks b WHERE b.target_type = 'social_post' AND b.target_id = p.id) AS bookmark_count
      FROM social_post_images i JOIN social_posts p ON p.id = i.post_id
      WHERE i.status = 'published' AND i.safety_status = 'clean'
        AND p.moderated_at IS NULL AND ${visiblePostSql} AND ${imageWhere}
      GROUP BY p.id
      ORDER BY relevance_score DESC,
        (reply_count * 3 + repost_count * 5 + quote_repost_count * 6 + like_count + bookmark_count * 4) DESC,
        p.created_at DESC LIMIT ?`,
      )
      .bind(
        normalizedImageQuery,
        normalizedImageQuery,
        normalizedImageQuery,
        normalizedImageQuery,
        ...visiblePostBindings(),
        ...imageBindings,
        RESULT_LIMIT,
      )
      .all<ImagePostRow>(),
    prep
      (
        `SELECT t.id, b.board_key, t.title, (SELECT count(*) FROM thread_posts tp WHERE tp.thread_id = t.id) AS post_count, t.updated_at, t.pinned, bm25(threads_fts, 10.0) AS rank_score FROM threads_fts f JOIN threads t ON t.rowid = f.rowid JOIN boards b ON b.id = t.board_id WHERE threads_fts MATCH ? AND ${notGatedSql("thread", "t.id")} ORDER BY bm25(threads_fts, 10.0), t.pinned DESC, t.updated_at DESC LIMIT ?`,
      )
      .bind(threadsPlan.bind, RESULT_LIMIT)
      .all<ThreadRow>(),
    prep
      (
        `SELECT DISTINCT t.id, b.board_key, t.title,
      (SELECT count(*) FROM thread_posts counted WHERE counted.thread_id = t.id) AS post_count,
      t.updated_at, t.pinned
      FROM thread_posts_fts f
      JOIN thread_posts tp ON tp.rowid = f.rowid
      JOIN threads t ON t.id = tp.thread_id
      JOIN boards b ON b.id = t.board_id
      WHERE thread_posts_fts MATCH ?
        AND tp.deleted_at IS NULL
        AND tp.moderated_at IS NULL
        AND ${notGatedSql("thread", "t.id")}
      ORDER BY t.pinned DESC, t.updated_at DESC LIMIT ?`,
      )
      .bind(threadPostsPlan.bind, RESULT_LIMIT)
      .all<ThreadRow>(),
    prep
      (
        `SELECT b.id, b.board_key, b.title, b.slug, b.description, (SELECT count(*) FROM threads t WHERE t.board_id = b.id) AS thread_count FROM boards b WHERE ${boardWhere} ORDER BY b.updated_at DESC LIMIT ?`,
      )
      .bind(...boardBindings, RESULT_LIMIT)
      .all<BoardRow>(),
    prep
      (
        `SELECT a.slug, a.title, a.category, a.summary, bm25(hubpedia_articles_fts, 12.0, 10.0, 8.0, 4.0, 1.0, 3.0) AS rank_score FROM hubpedia_articles_fts f JOIN hubpedia_articles a ON a.rowid = f.rowid WHERE hubpedia_articles_fts MATCH ? AND a.status = 'published' AND EXISTS (SELECT 1 FROM hubpedia_publication_approvals approval WHERE approval.article_slug=a.slug AND approval.revoked_at IS NULL) ORDER BY bm25(hubpedia_articles_fts, 12.0, 10.0, 8.0, 4.0, 1.0, 3.0), a.published_at DESC LIMIT ?`,
      )
      .bind(hubpediaPlan.bind, RESULT_LIMIT)
      .all<HubpediaRow>(),
    prep
      (
        `SELECT a.slug, r.title, coalesce(json_extract(r.generation_metadata, '$.categoryIds[0]'), t.topic_type) AS category, coalesce(r.summary, '') AS summary FROM encyclopedia_articles a JOIN encyclopedia_article_revisions r ON r.id = a.current_revision_id JOIN encyclopedia_topics t ON t.id = a.topic_id WHERE a.status = 'published' AND EXISTS (SELECT 1 FROM hubpedia_publication_approvals approval WHERE approval.article_slug=a.slug AND approval.revoked_at IS NULL AND approval.approved_revision_key='db:'||r.revision_number) AND EXISTS (SELECT 1 FROM hubpedia_publication_eligible_articles eligible WHERE eligible.article_slug=a.slug AND eligible.revision_id=a.current_revision_id) AND ${encyclopediaWhere} ORDER BY a.updated_at DESC LIMIT ?`,
      )
      .bind(...encyclopediaBindings, RESULT_LIMIT)
      .all<HubpediaRow>(),
    listD1ExternalVideos(database),
    prep
      (
        `SELECT c.id, c.slug, c.name, c.description, c.category FROM communities_fts f JOIN communities c ON c.rowid = f.rowid WHERE communities_fts MATCH ? AND ${visibleCommunities.sql} ORDER BY bm25(communities_fts, 10.0, 1.0, 4.0), c.updated_at DESC LIMIT ?`,
      )
      .bind(communitiesPlan.bind, ...visibleCommunities.bindings, RESULT_LIMIT)
      .all<CommunityRow>()
      /* Code may deploy before migration 0299 creates communities_fts: no community results, not an error. */
      .catch((cause: unknown) => {
        if (isMissingSchemaError(cause)) return { results: [] as CommunityRow[] };
        throw cause;
      }),
    prep
      (
        `SELECT DISTINCT c.id FROM (SELECT channel_id, body FROM community_channel_messages ORDER BY rowid DESC LIMIT ${COMMUNITY_MESSAGE_SCAN_ROWS}) m
      JOIN community_channels ch ON ch.id = m.channel_id
      JOIN communities c ON c.id = ch.community_id
      WHERE ${notGatedSql("channel", "m.channel_id")} AND ${visibleCommunities.sql} AND ${communityMessageWhere} LIMIT ${COMMUNITY_MESSAGE_MATCHES}`,
      )
      .bind(...visibleCommunities.bindings, ...communityMessageBindings)
      .all<CommunityIdRow>(),
    prep
      (
        "SELECT id, name, description FROM user_lists WHERE visibility = 'public' ORDER BY updated_at DESC LIMIT 200",
      )
      .all<ListRow>(),
  ]);

  const [
    profileCount,
    postCount,
    threadCount,
    boardCount,
    hubpediaCount,
    encyclopediaHubpediaCount,
  ] = await countsPromise;

  const walletProfiles = await publicWalletProfilesPromise;
  const profiles = [...walletProfiles, ...profileResult.results]
    .filter(
      (row, index, rows) =>
        rows.findIndex((candidate) => candidate.id === row.id) === index,
    )
    .map((row) => ({
      id: row.id,
      handle: row.handle,
      displayName: row.display_name,
      bio: row.bio,
      avatarUrl: row.avatar_url,
    }))
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.handle, weight: 12 },
          { value: right.displayName, weight: 10 },
          { value: right.bio, weight: 2 },
        ]) -
        scoreSearchFields(query, [
          { value: left.handle, weight: 12 },
          { value: left.displayName, weight: 10 },
          { value: left.bio, weight: 2 },
        ]),
    );
  const postRows = [...postResult.results, ...imagePostResult.results]
    .filter(
      (row, index, rows) =>
        rows.findIndex((candidate) => candidate.id === row.id) === index,
    )
    .slice(0, RESULT_LIMIT);
  const posts = postRows
    .map((row) => ({
      id: row.id,
      displayName: row.display_name,
      handle: row.handle,
      identityMode: row.identity_mode,
      body: row.body,
      createdAt: row.created_at,
      hubCategoryIds: resolveHubCategoryIds(row.body),
    }))
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.handle, weight: 10 },
          { value: right.displayName, weight: 8 },
          { value: right.body, weight: 3 },
        ]) -
          scoreSearchFields(query, [
            { value: left.handle, weight: 10 },
            { value: left.displayName, weight: 8 },
            { value: left.body, weight: 3 },
          ]) || right.createdAt.localeCompare(left.createdAt),
    );
  const images = imagePostResult.results.map((row) => ({
    id: row.id,
    displayName: row.display_name,
    handle: row.handle,
    identityMode: row.identity_mode,
    body: row.body,
    createdAt: row.created_at,
    replyCount: Number(row.reply_count),
    repostCount: Number(row.repost_count),
    quoteRepostCount: Number(row.quote_repost_count),
    likeCount: Number(row.like_count),
    score: calculateEngagementScore({
      replyCount: Number(row.reply_count),
      repostCount: Number(row.repost_count),
      quoteRepostCount: Number(row.quote_repost_count),
      likeCount: Number(row.like_count),
      bookmarkCount: Number(row.bookmark_count),
    }),
    relevanceScore: Number(row.relevance_score),
  }));
  await attachImagesToPostsAndImages(database, posts, images);
  const threads = [...threadResult.results, ...threadPostResult.results]
    .filter(
      (row, index, rows) =>
        rows.findIndex((candidate) => candidate.id === row.id) === index,
    )
    .slice(0, RESULT_LIMIT)
    .map((row) => ({
      id: row.id,
      boardKey: row.board_key,
      title: row.title,
      postCount: row.post_count,
      updatedAt: row.updated_at,
      pinned: row.pinned === 1,
      hubCategoryIds: resolveHubCategoryIds(row.board_key, row.title),
    }))
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.title, weight: 12 },
          { value: right.boardKey, weight: 4 },
        ]) -
          scoreSearchFields(query, [
            { value: left.title, weight: 12 },
            { value: left.boardKey, weight: 4 },
          ]) ||
        right.postCount - left.postCount ||
        right.updatedAt.localeCompare(left.updatedAt),
    );
  const boards = boardResult.results
    .map((row) => ({
      id: row.id,
      key: row.board_key,
      title: row.title,
      slug: row.slug,
      description: row.description,
      threadCount: row.thread_count,
      hubCategoryIds: resolveHubCategoryIds(
        row.title,
        row.slug,
        row.description,
      ),
    }))
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.title, weight: 10 },
          { value: right.slug, weight: 7 },
          { value: right.description, weight: 2 },
        ]) -
          scoreSearchFields(query, [
            { value: left.title, weight: 10 },
            { value: left.slug, weight: 7 },
            { value: left.description, weight: 2 },
          ]) || right.threadCount - left.threadCount,
    );
  const databaseHubpedia = hubpediaResult.results.map((row) => ({
    slug: row.slug,
    title: row.title,
    category: row.category,
    summary: row.summary,
    href: `/hubpedia/${encodeURIComponent(row.slug)}`,
    hubCategoryIds: resolveHubCategoryIds(row.category, row.title, row.summary),
  }));
  const generatedHubpedia = encyclopediaHubpediaResult.results.map((row) => ({
    slug: row.slug,
    title: row.title,
    category: row.category,
    summary: row.summary,
    href: `/hubpedia/${encodeURIComponent(row.slug)}`,
    hubCategoryIds: resolveHubCategoryIds(row.category, row.title, row.summary),
  }));
  const publicIndexedSeedHubpedia = databaseHubpedia.filter((article) =>
    isPublicHubpediaSlug(article.slug),
  );
  const ledgerHubpedia = [
    ...generatedHubpedia,
    ...seedHubpedia.results,
    ...publicIndexedSeedHubpedia,
  ].filter(
    (article, index, articles) =>
      articles.findIndex((candidate) => candidate.slug === article.slug) ===
      index,
  );
  const ledgerSlugs = new Set(ledgerHubpedia.map((article) => article.slug));
  const wikipediaHubpedia = (await wikipediaPromise).hits
    .filter((hit) => !ledgerSlugs.has(hit.slug))
    .map((hit) => ({ ...hit, hubCategoryIds: [] as ReturnType<typeof resolveHubCategoryIds> }));
  const hubpedia = [...ledgerHubpedia, ...wikipediaHubpedia].slice(0, RESULT_LIMIT);
  const videos = videoCatalog
    .filter((item) =>
      matchesTerms(
        [item.title, item.channel, item.category, item.topic],
        terms,
      ),
    )
    .slice(0, RESULT_LIMIT)
    .map((item) => ({
      id: item.id,
      title: item.title,
      channel: item.channel,
      category: item.category,
      topic: item.topic,
      provider: item.provider,
      /* A gated video shows its title only: no cover, and a lock mark for the card. */
      thumbnailUrl: item.accessGate ? undefined : item.thumbnailUrl,
      gated: Boolean(item.accessGate),
      hubCategoryIds: resolveHubCategoryIds(
        item.category,
        item.topic,
        item.title,
      ),
    }))
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.title, weight: 12 },
          { value: right.channel, weight: 7 },
          { value: right.topic, weight: 5 },
          { value: right.category, weight: 3 },
        ]) -
        scoreSearchFields(query, [
          { value: left.title, weight: 12 },
          { value: left.channel, weight: 7 },
          { value: left.topic, weight: 5 },
          { value: left.category, weight: 3 },
        ]),
    );
  const knownCommunityIds = new Set(communityResult.results.map((item) => item.id));
  const messageOnlyIds = communityMessageResult.results
    .map((item) => item.id)
    .filter((id) => !knownCommunityIds.has(id))
    .slice(0, RESULT_LIMIT);
  const messageCommunities = messageOnlyIds.length
    ? (await prep("SELECT id, slug, name, description, category FROM communities WHERE id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(messageOnlyIds))
        .all<CommunityRow>()).results
    : [];
  const communities = [...communityResult.results, ...messageCommunities]
    .slice(0, RESULT_LIMIT)
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.name, weight: 12 },
          { value: right.category, weight: 5 },
          { value: right.description, weight: 2 },
        ]) -
        scoreSearchFields(query, [
          { value: left.name, weight: 12 },
          { value: left.category, weight: 5 },
          { value: left.description, weight: 2 },
        ]),
    );
  const categorizedCommunities = communities.map((item) => ({
    ...item,
    hubCategoryIds: resolveHubCategoryIds(
      item.category,
      item.name,
      item.description,
    ),
  }));
  const lists = listResult.results
    .filter((item) => matchesTerms([item.name, item.description], terms))
    .slice(0, RESULT_LIMIT)
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.name, weight: 12 },
          { value: right.description, weight: 2 },
        ]) -
        scoreSearchFields(query, [
          { value: left.name, weight: 12 },
          { value: left.description, weight: 2 },
        ]),
    );
  const tokens = (await tokenCatalogPromise)
    .filter((item) =>
      matchesTerms(
        [item.title, item.symbol, item.network, item.description],
        terms,
      ),
    )
    .sort(
      (left, right) =>
        scoreSearchFields(query, [
          { value: right.symbol, weight: 12 },
          { value: right.title, weight: 10 },
          { value: right.network, weight: 4 },
          { value: right.description, weight: 2 },
        ]) -
        scoreSearchFields(query, [
          { value: left.symbol, weight: 12 },
          { value: left.title, weight: 10 },
          { value: left.network, weight: 4 },
          { value: left.description, weight: 2 },
        ]),
    )
    .slice(0, RESULT_LIMIT)
    .map((item) => ({
      id: item.id,
      title: item.title,
      symbol: item.symbol,
      network: item.network,
      description: item.description,
    }));
  const work = (await workListingsPromise)
    .filter((item) => item.status === "published")
    .filter((item) =>
      matchesTerms(
        [
          item.title,
          item.ownerName,
          item.ownerHandle,
          item.summary,
          item.category,
          item.location,
          item.compensationLabel,
          ...item.skills,
        ],
        terms,
      ),
    )
    .slice(0, RESULT_LIMIT)
    .map((item) => ({
      id: item.id,
      kind: item.kind === "request" ? ("project" as const) : item.kind,
      title: item.title,
      organization: item.ownerName,
      summary: item.summary,
      location: item.location,
      compensation: item.compensationLabel,
      tags: item.skills,
    }));
  const listings = (await publicListingsPromise).map((item) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    summary: item.summary,
    category: item.category,
    providerLabel: item.providerLabel,
    providerUrl: item.providerUrl,
    region: item.region,
    locality: item.locality,
    priceLabel: item.priceLabel,
    trustStatus: item.trustStatus,
    updatedAt: item.updatedAt,
  }));
  /*
   * One score per result, so the "all" view merges the kinds by score instead of taking turns.
   * Formula and weights: lib/search-score.ts. bm25 comes from the FTS rows already read; engagement
   * uses only counts that are on the row (thread post_count); the follow boost is one indexed
   * lookup over at most 60 author ids, and only for a signed-in viewer.
   */
  const nowMs = Date.now();
  const heuristic = (raw: number) => Math.min(1, Math.max(0, raw / 40));
  const profileRows = new Map(profileResult.results.map((row) => [row.id, row]));
  const postAuthors = new Map<string, string | null>();
  for (const row of [...postResult.results, ...imagePostResult.results]) postAuthors.set(row.id, row.author_profile_id ?? null);
  const postRanks = new Map(postResult.results.map((row) => [row.id, row.rank_score]));
  const threadRanks = new Map(threadResult.results.map((row) => [row.id, row.rank_score]));
  const hubpediaRanks = new Map(hubpediaResult.results.map((row) => [row.slug, row.rank_score]));
  const followedIds = new Set<string>();
  if (viewerProfileId) {
    const candidateIds = [...new Set([...profiles.map((row) => row.id), ...[...postAuthors.values()].filter((id): id is string => Boolean(id))])].slice(0, 60);
    if (candidateIds.length) {
      try {
        const followRows = await database
          .prepare(`SELECT followed_profile_id FROM follows WHERE follower_profile_id = ? AND followed_profile_id IN (${candidateIds.map(() => "?").join(",")})`)
          .bind(viewerProfileId, ...candidateIds)
          .all<{ followed_profile_id: string }>();
        for (const row of followRows.results ?? []) followedIds.add(row.followed_profile_id);
      } catch {
        /* The boost is optional; a failed lookup only drops it. */
      }
    }
  }
  const scores = new Map<string, number>();
  const put = (group: string, id: string, input: Omit<Parameters<typeof scoreSearchResult>[0], "nowMs">) =>
    scores.set(`${group}:${id}`, scoreSearchResult({ nowMs, ...input }));
  for (const item of profiles) {
    put("profiles", item.id, {
      bm25: profileRows.get(item.id)?.rank_score,
      heuristic: heuristic(scoreSearchFields(query, [{ value: item.handle, weight: 12 }, { value: item.displayName, weight: 10 }, { value: item.bio, weight: 2 }])),
      followedAuthor: followedIds.has(item.id),
    });
  }
  for (const item of posts) {
    const author = postAuthors.get(item.id);
    put("posts", item.id, {
      bm25: postRanks.get(item.id),
      heuristic: heuristic(scoreSearchFields(query, [{ value: item.handle, weight: 10 }, { value: item.displayName, weight: 8 }, { value: item.body, weight: 3 }])),
      timestampMs: parseRowTimestamp(item.createdAt),
      followedAuthor: author ? followedIds.has(author) : false,
    });
  }
  for (const item of threads) {
    put("threads", item.id, {
      bm25: threadRanks.get(item.id),
      heuristic: heuristic(scoreSearchFields(query, [{ value: item.title, weight: 12 }, { value: item.boardKey, weight: 4 }])),
      timestampMs: parseRowTimestamp(item.updatedAt),
      postCount: item.postCount,
    });
  }
  for (const item of boards) {
    put("boards", item.id, {
      heuristic: heuristic(scoreSearchFields(query, [{ value: item.title, weight: 10 }, { value: item.slug, weight: 7 }, { value: item.description, weight: 2 }])),
      postCount: item.threadCount,
    });
  }
  for (const item of hubpedia) {
    put("hubpedia", item.slug, {
      bm25: hubpediaRanks.get(item.slug),
      heuristic: heuristic(scoreSearchFields(query, [{ value: item.title, weight: 12 }, { value: item.summary, weight: 3 }])),
    });
  }
  for (const item of videos) {
    put("videos", item.id, { heuristic: heuristic(scoreSearchFields(query, [{ value: item.title, weight: 12 }, { value: item.channel, weight: 7 }, { value: item.topic, weight: 5 }])) });
  }
  for (const item of categorizedCommunities) {
    put("communities", item.id, { heuristic: heuristic(scoreSearchFields(query, [{ value: item.name, weight: 12 }, { value: item.category, weight: 5 }, { value: item.description, weight: 2 }])) });
  }
  for (const item of lists) {
    put("lists", item.id, { heuristic: heuristic(scoreSearchFields(query, [{ value: item.name, weight: 12 }, { value: item.description, weight: 2 }])) });
  }
  for (const item of tokens) {
    put("tokens", item.id, { heuristic: heuristic(scoreSearchFields(query, [{ value: item.symbol, weight: 12 }, { value: item.title, weight: 10 }, { value: item.description, weight: 2 }])) });
  }
  for (const item of work) {
    put("work", item.id, { heuristic: heuristic(scoreSearchFields(query, [{ value: item.title, weight: 12 }, { value: item.summary, weight: 3 }])) });
  }
  for (const item of listings) {
    put("listings", item.id, {
      heuristic: heuristic(scoreSearchFields(query, [{ value: item.title, weight: 12 }, { value: item.summary, weight: 3 }])),
      timestampMs: parseRowTimestamp(item.updatedAt),
    });
  }
  const coreEntities = toD1SearchEntities({
    profiles,
    posts,
    threads,
    boards,
    hubpedia,
    communities: categorizedCommunities,
    videos,
    lists,
    tokens,
    work,
    listings,
  })
    .map((entity) => ({ ...entity, score: Math.round((scores.get(`${entity.sourceGroup}:${entity.ref.id}`) ?? 0) * 10_000) / 10_000 }))
    .sort((left, right) => right.score - left.score);

  return {
    query,
    counts: {
      boards: Number(boardCount?.total_count ?? 0),
      profiles: Math.max(
        Number(profileCount?.total_count ?? 0),
        profiles.length,
      ),
      threads: Number(threadCount?.total_count ?? 0),
      posts: Number(postCount?.total_count ?? 0),
      images: images.length,
      hubpedia: hubpedia.length,
      communities: communities.length,
      videos: videos.length,
      products: 0,
      lists: lists.length,
      tokens: tokens.length,
      work: work.length,
      listings: listings.length,
    },
    boards,
    profiles,
    threads,
    posts,
    images,
    hubpedia,
    communities: categorizedCommunities,
    videos,
    products: [],
    lists,
    tokens,
    work,
    listings,
    coreEntities,
  };
}
