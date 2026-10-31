import type { D1Database } from "@cloudflare/workers-types";

import {
  applyLibraryPins,
  isLibraryItemKey,
  LIBRARY_PIN_MAX,
  LIBRARY_READ_MAX,
  safeLibraryImage,
  type LibraryColumnData,
  type LibraryGroup,
  type LibraryItem,
  type LibraryPopularTags,
  type LibrarySection,
} from "@/lib/library-column";
import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { tagHref, type TagChipKind } from "@/lib/tag-href";
import { navItemHref } from "@/lib/v2-feed-nav";

/*
 * 左の列の「自分のもの」(2026-10-29)。節ごとに群の数だけ読む（群ごとに1本、LIMIT つき、並列。N+1 なし）。
 * D1 は読んだ行数で課金されるので、群は新しい順に LIBRARY_READ_MAX 行で打ち切り、固定の並べ替えは取れた行の中で行う。
 * 数えるのは LIMIT 100 の内側だけ。本人以外の非公開・ゲート付き・非表示は読まない（SQL で除く）。
 * 呼び出し側は Cache-Control を付けず、本人のセッションのときだけ呼ぶ。
 */
const READ = LIBRARY_READ_MAX;
const POPULAR_LIMIT = 10;
const COUNT_CAP = 100;

const gate = (type: string, idColumn: string) =>
  `NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.target_type = '${type}' AND g.target_id = ${idColumn})`;

async function rowsOf<T>(database: D1Database, sql: string, ...binds: unknown[]): Promise<T[]> {
  const result = await database.prepare(sql).bind(...binds).all<T>();
  return result.results ?? [];
}

async function countOf(database: D1Database, sql: string, ...binds: unknown[]): Promise<number> {
  const row = await database.prepare(`SELECT count(*) AS n FROM (${sql} LIMIT ${COUNT_CAP})`).bind(...binds).first<{ n: number }>();
  return row?.n ?? 0;
}

/* ---------- 群ごとの読み出し（新しい順、READ+1 行まで） ---------- */

async function followedTags(database: D1Database, profileId: string, chipKind?: TagChipKind): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ tag: string }>(database, `SELECT tag FROM hub_article_tag_follows WHERE profile_id = ?
    ORDER BY created_at DESC, tag LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `tag:${row.tag}`, label: `#${row.tag}`, href: tagHref(row.tag, chipKind), icon: "bookmark" as const, pinnable: true, tag: row.tag, chipKind }));
}

/* 節ごとの「よく使われているタグ」。公開（public_visible=1）の結びつきだけを、その節の対象の種類で数える。
 * 公開データなので 15 分だけプロセス内に覚える（集計は読む行が多いため。本人のデータは覚えない）。 */
const POPULAR_TARGETS: Partial<Record<LibrarySection, { types: string[]; kind: TagChipKind; remote: "music" | "market" | null }>> = {
  feed: { types: ["social_post", "thread"], kind: "posts", remote: null },
  articles: { types: ["user_article"], kind: "articles", remote: null },
  videos: { types: ["video"], kind: "videos", remote: null },
  music: { types: ["music_work"], kind: "music", remote: "music" },
  market: { types: [], kind: "market", remote: "market" },
};
const POPULAR_TTL_MS = 15 * 60 * 1000;
const popularCache = new Map<string, { at: number; tags: string[] }>();
export function clearPopularTagCache() { popularCache.clear(); }

async function popularTags(database: D1Database, section: LibrarySection, now = Date.now()): Promise<LibraryPopularTags | null> {
  const spec = POPULAR_TARGETS[section];
  if (!spec) return null;
  if (!spec.types.length) return { kind: spec.kind, tags: [], remote: spec.remote };
  const cached = popularCache.get(section);
  if (cached && now - cached.at < POPULAR_TTL_MS) return { kind: spec.kind, tags: cached.tags, remote: spec.remote };
  const marks = spec.types.map(() => "?").join(",");
  const rows = await rowsOf<{ name: string }>(database, `SELECT t.display_name AS name
    FROM content_tag_links l JOIN content_tags t ON t.id = l.tag_id
    WHERE l.public_visible = 1 AND l.target_type IN (${marks})
    GROUP BY l.tag_id ORDER BY count(*) DESC, t.display_name LIMIT ${POPULAR_LIMIT}`, ...spec.types);
  const tags = rows.map((row) => row.name);
  popularCache.set(section, { at: now, tags });
  return { kind: spec.kind, tags, remote: spec.remote };
}

async function joinedCommunities(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; name: string; image_url: string | null }>(database, `SELECT c.id, c.name, c.image_url
    FROM community_memberships m JOIN communities c ON c.id = m.community_id
    WHERE m.profile_id = ? AND m.status = 'active' ORDER BY m.joined_at DESC, c.id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `community:${row.id}`, label: row.name, href: navItemHref("community", row.id), icon: "people" as const, imageUrl: safeLibraryImage(row.image_url), shape: "place" as const, pinnable: true }));
}

async function ownLists(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; name: string }>(database, `SELECT id, name FROM user_lists
    WHERE owner_profile_id = ? ORDER BY created_at DESC, id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `list:${row.id}`, label: row.name, href: navItemHref("list", row.id), icon: "list" as const, pinnable: true }));
}

async function followedWriters(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; handle: string; display_name: string; avatar_url: string | null }>(database, `SELECT p.id, p.handle, p.display_name, p.avatar_url
    FROM follows f JOIN profiles p ON p.id = f.followed_profile_id
    WHERE f.follower_profile_id = ?
      AND EXISTS (SELECT 1 FROM hub_user_articles a WHERE a.author_profile_id = f.followed_profile_id AND a.status = 'published' AND a.moderated_at IS NULL LIMIT 1)
    ORDER BY f.created_at DESC, f.followed_profile_id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `profile:${row.id}`, label: row.display_name, href: `/v2/profile/${encodeURIComponent(row.handle)}`, icon: "people" as const, imageUrl: safeLibraryImage(row.avatar_url), shape: "person" as const, pinnable: true }));
}

async function savedArticles(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; title: string }>(database, `SELECT a.id, a.title
    FROM hub_user_article_saves s JOIN hub_user_articles a ON a.id = s.article_id
    WHERE s.profile_id = ? AND a.status = 'published' AND a.audience = 'general' AND a.moderated_at IS NULL AND ${gate("article", "a.id")}
    ORDER BY s.created_at DESC, a.id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `article:${row.id}`, label: row.title, href: `/v2/articles/${encodeURIComponent(row.id)}`, icon: "article" as const, pinnable: true }));
}

async function subscribedChannels(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ channel_key: string; display_name: string }>(database, `SELECT f.channel_key, c.display_name
    FROM video_channel_follows f JOIN video_channels c ON c.channel_key = f.channel_key AND c.status = 'active'
    WHERE f.profile_id = ? ORDER BY f.created_at DESC, f.channel_key LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `channel:${row.channel_key}`, label: row.display_name, href: `/v2/videos?q=${encodeURIComponent(row.display_name)}`, icon: "video" as const, shape: "person" as const, pinnable: true }));
}

async function watchLater(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; title: string }>(database, `SELECT v.id, v.title
    FROM external_video_saves s JOIN external_videos v ON v.id = s.video_id
    WHERE s.profile_id = ? AND v.status = 'active' AND ${gate("video", "v.id")}
    ORDER BY s.created_at DESC, v.id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `video:${row.id}`, label: row.title, href: `/v2/videos/${encodeURIComponent(row.id)}`, icon: "clock" as const, pinnable: true }));
}

async function ownVideos(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; title: string; state: string; external_video_id: string | null }>(database, `SELECT id, title, state, external_video_id
    FROM hub_videos WHERE profile_id = ? AND state <> 'deleted' AND title <> ''
    ORDER BY created_at DESC, id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({
    key: `hubvideo:${row.id}`,
    label: row.title,
    href: row.state === "published" && row.external_video_id ? `/v2/videos/${encodeURIComponent(row.external_video_id)}` : "/v2/studio/videos",
    icon: "video" as const,
    pinnable: true,
  }));
}

async function musicPlaylists(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; title: string }>(database, `SELECT id, title FROM music_playlists
    WHERE owner_profile_id = ? ORDER BY updated_at DESC, id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `playlist:${row.id}`, label: row.title, href: "/v2/lists?tab=playlists", icon: "music" as const, pinnable: true }));
}

async function ownListings(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const [work, classified] = await Promise.all([
    rowsOf<{ id: string; title: string; at: string }>(database, `SELECT id, title, updated_at AS at FROM work_listings
      WHERE owner_profile_id = ? AND status = 'published' ORDER BY updated_at DESC, id LIMIT ${READ}`, profileId),
    rowsOf<{ id: string; title: string; at: string }>(database, `SELECT id, title, updated_at AS at FROM classified_listings
      WHERE owner_profile_id = ? AND status = 'published' ORDER BY updated_at DESC, id LIMIT ${READ}`, profileId),
  ]);
  return [
    ...work.map((row) => ({ at: row.at, item: { key: `work:${row.id}`, label: row.title, href: "/v2/work", icon: "store" as const, pinnable: true } })),
    ...classified.map((row) => ({ at: row.at, item: { key: `classified:${row.id}`, label: row.title, href: "/v2/market", icon: "store" as const, pinnable: true } })),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, READ + 1).map((entry) => entry.item);
}

async function ownedGames(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ game_id: string; slug: string; title: string; image_url: string | null }>(database, `SELECT l.game_id, g.slug, g.title, g.image_url
    FROM hub_game_library l JOIN game_guide_hubs g ON g.id = l.game_id
    WHERE l.profile_id = ? ORDER BY l.added_at DESC, l.game_id DESC LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `game:${row.game_id}`, label: row.title, href: `/v2/games/${encodeURIComponent(row.slug)}`, icon: "game" as const, imageUrl: safeLibraryImage(row.image_url), shape: "place" as const, pinnable: true }));
}

async function ownProjects(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; title: string }>(database, `SELECT id, title FROM research_projects
    WHERE owner_profile_id = ? AND status <> 'withdrawn' ORDER BY updated_at DESC, id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `project:${row.id}`, label: row.title, href: `/v2/research/${encodeURIComponent(row.id)}`, icon: "research" as const, pinnable: true }));
}

async function followedProjects(database: D1Database, profileId: string): Promise<LibraryItem[]> {
  const rows = await rowsOf<{ id: string; title: string }>(database, `SELECT p.id, p.title
    FROM hub_research_project_follows f JOIN research_projects p ON p.id = f.project_id
    WHERE f.profile_id = ? AND p.visibility = 'public' AND p.status IN ('active', 'paused', 'completed')
    ORDER BY f.created_at DESC, p.id LIMIT ${READ}`, profileId);
  return rows.map((row) => ({ key: `fproject:${row.id}`, label: row.title, href: `/v2/research/${encodeURIComponent(row.id)}`, icon: "research" as const, pinnable: true }));
}

/* ---------- 群の組み立て ---------- */

const t = (japanese: boolean, ja: string, en: string) => (japanese ? ja : en);

function group(id: string, title: string, rows: LibraryItem[], pins: ReadonlySet<string>, empty: LibraryGroup["empty"], seeAllHref?: string): LibraryGroup {
  const overflow = rows.length > READ;
  const { items, more } = applyLibraryPins(rows.slice(0, READ), pins);
  const hasMore = more || overflow;
  return { id, title, items, more: hasMore, seeAllHref: hasMore || seeAllHref ? seeAllHref : undefined, empty };
}

export async function listLibraryPins(database: D1Database, profileId: string, section: LibrarySection): Promise<string[]> {
  const rows = await rowsOf<{ item_key: string }>(database, `SELECT item_key FROM hub_library_pins WHERE profile_id = ? AND section = ?
    ORDER BY pinned_at DESC, item_key LIMIT ${LIBRARY_PIN_MAX}`, profileId, section);
  return rows.map((row) => row.item_key);
}

export class LibraryPinError extends Error {
  constructor(readonly code: "bad_key" | "limit") {
    super(code === "limit" ? `固定できるのは1つの節で${LIBRARY_PIN_MAX}件までです。` : "固定する行の形が正しくありません。");
    this.name = "LibraryPinError";
  }
}

export async function setLibraryPin(database: D1Database, profileId: string, section: LibrarySection, itemKey: string, pinned: boolean, now = new Date().toISOString()): Promise<void> {
  if (!isLibraryItemKey(itemKey)) throw new LibraryPinError("bad_key");
  if (!pinned) {
    await database.prepare("DELETE FROM hub_library_pins WHERE profile_id = ? AND section = ? AND item_key = ?").bind(profileId, section, itemKey).run();
    return;
  }
  const existing = await database.prepare("SELECT 1 AS found FROM hub_library_pins WHERE profile_id = ? AND section = ? AND item_key = ?").bind(profileId, section, itemKey).first();
  if (existing) return;
  if ((await countOf(database, "SELECT 1 FROM hub_library_pins WHERE profile_id = ? AND section = ?", profileId, section)) >= LIBRARY_PIN_MAX) throw new LibraryPinError("limit");
  await database.prepare("INSERT OR IGNORE INTO hub_library_pins(profile_id, section, item_key, pinned_at) VALUES(?, ?, ?, ?)").bind(profileId, section, itemKey, now).run();
}

/** 失敗した群は空として返す（列全体を落とさない）。 */
async function safely<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}

export async function loadLibraryColumn(database: D1Database, profileId: string, section: LibrarySection, japanese = true): Promise<LibraryColumnData> {
  const pinKeys = await safely(listLibraryPins(database, profileId, section), [] as string[]);
  const pins = new Set(pinKeys);
  const j = japanese;
  const empty = (ja: string, en: string, label: string, enLabel: string, href: string): LibraryGroup["empty"] => ({ text: t(j, ja, en), action: { label: t(j, label, enLabel), href } });
  const none: LibraryItem[] = [];
  let groups: LibraryGroup[] = [];
  const chipKind = POPULAR_TARGETS[section]?.kind;
  const [tags, popular] = await Promise.all([
    safely(followedTags(database, profileId, chipKind), none),
    safely(popularTags(database, section), null as LibraryPopularTags | null),
  ]);
  const tagsGroup = group("tags", t(j, "フォロー中のタグ", "Followed tags"), tags, pins, empty("まだタグをフォローしていません", "No followed tags", "タグを探す", "Find tags", "/v2/search"));

  if (section === "feed") {
    const [communities, lists] = await Promise.all([
      safely(joinedCommunities(database, profileId), none), safely(ownLists(database, profileId), none),
    ]);
    groups = [
      group("communities", t(j, "参加中のコミュニティ", "Your communities"), communities, pins, empty("参加中のコミュニティはありません", "No communities yet", "コミュニティを探す", "Find communities", "/v2/community"), "/v2/community"),
      group("lists", t(j, "リスト", "Lists"), lists, pins, empty("リストはまだありません", "No lists yet", "リストを作る", "Create a list", "/v2/lists"), "/v2/lists"),
    ];
  } else if (section === "articles") {
    const [writers, drafts, saved] = await Promise.all([
      safely(followedWriters(database, profileId), none),
      safely(countOf(database, "SELECT 1 FROM hub_user_article_drafts WHERE author_profile_id = ? AND status = 'draft'", profileId), 0),
      safely(savedArticles(database, profileId), none),
    ]);
    groups = [
      group("writers", t(j, "フォロー中の書き手", "Followed writers"), writers, pins, empty("フォロー中の書き手はいません", "No followed writers", "記事を読む", "Read articles", "/v2/articles")),
      {
        id: "drafts", title: t(j, "下書き", "Drafts"), empty: empty("下書きはありません", "No drafts", "記事を書く", "Write", "/v2/articles/new"),
        items: drafts ? [{ key: "drafts:all", label: t(j, "下書き", "Drafts"), href: "/v2/articles/drafts", icon: "edit", count: drafts, pinnable: false }] : [],
      },
      group("saved", t(j, "保存した記事", "Saved articles"), saved, pins, empty("保存した記事はありません", "No saved articles", "記事を読む", "Read articles", "/v2/articles"), "/v2/articles/saved"),
    ];
  } else if (section === "videos") {
    const [channels, later, mine] = await Promise.all([
      safely(subscribedChannels(database, profileId), none), safely(watchLater(database, profileId), none), safely(ownVideos(database, profileId), none),
    ]);
    groups = [
      group("channels", t(j, "登録チャンネル", "Subscriptions"), channels, pins, empty("登録チャンネルはありません", "No subscriptions", "動画を探す", "Find videos", "/v2/videos"), "/v2/videos?mode=subscriptions"),
      group("later", t(j, "あとで見る", "Watch later"), later, pins, empty("あとで見る動画はありません", "Nothing saved", "動画を探す", "Find videos", "/v2/videos"), "/v2/videos?mode=saved"),
      group("mine", t(j, "自分の動画", "Your videos"), mine, pins, empty("投稿した動画はありません", "No videos yet", "動画を投稿", "Upload", "/v2/studio/videos"), "/v2/studio/videos"),
    ];
  } else if (section === "music") {
    const [playlists, favorites] = await Promise.all([
      safely(musicPlaylists(database, profileId), none),
      safely(countOf(database, "SELECT 1 FROM music_favorites WHERE owner_profile_id = ?", profileId), 0),
    ]);
    groups = [
      group("playlists", t(j, "プレイリスト", "Playlists"), playlists, pins, empty("プレイリストはありません", "No playlists", "曲を探す", "Find music", "/v2/music"), "/v2/lists?tab=playlists"),
      {
        id: "favorites", title: t(j, "お気に入り", "Favorites"), empty: empty("お気に入りはありません", "No favorites", "曲を探す", "Find music", "/v2/music"),
        items: favorites ? [{ key: "favorites:all", label: t(j, "お気に入りの曲", "Favorite tracks"), href: "/v2/music/library", icon: "heart", count: favorites, pinnable: false }] : [],
      },
      {
        id: "recent", title: t(j, "最近聴いた曲", "Recently played"), empty: empty("履歴はありません", "No history", "曲を探す", "Find music", "/v2/music"),
        items: [{ key: "recent:all", label: t(j, "再生履歴", "Play history"), href: "/v2/music/history", icon: "clock", pinnable: false }],
      },
    ];
  } else if (section === "market") {
    const listings = await safely(ownListings(database, profileId), none);
    groups = [
      { id: "cart", title: t(j, "カート", "Cart"), empty: empty("", "", "", "", "/v2/market/cart"), items: [{ key: "cart:local", label: t(j, "カート", "Cart"), href: "/v2/market/cart", icon: "store", pinnable: false }] },
      group("listings", t(j, "出品中の自分の商品", "Your listings"), listings, pins, empty("出品中の商品はありません", "No active listings", "出品する", "Sell", "/v2/market/sell"), "/v2/market/sell"),
    ];
  } else if (section === "games") {
    const games = await safely(ownedGames(database, profileId), none);
    groups = [group("library", t(j, "ライブラリ", "Library"), games, pins, empty("ライブラリは空です", "Your library is empty", "ストアを見る", "Browse the store", "/v2/games"), "/v2/games/library")];
  } else {
    const [mine, followed] = await Promise.all([safely(ownProjects(database, profileId), none), safely(followedProjects(database, profileId), none)]);
    groups = [
      group("mine", t(j, "自分のプロジェクト", "Your projects"), mine, pins, empty("プロジェクトはありません", "No projects yet", "プロジェクトを見る", "Browse projects", "/v2/research"), "/v2/research"),
      group("followed", t(j, "フォロー中のプロジェクト", "Followed projects"), followed, pins, empty("フォロー中のプロジェクトはありません", "No followed projects", "プロジェクトを見る", "Browse projects", "/v2/research"), "/v2/research"),
    ];
  }
  return { section, groups: [tagsGroup, ...groups], popular, pins: pinKeys };
}

/** ページ用。未ログイン・D1 なし・失敗は null（列は何も足さない／未ログインの一文だけ）。 */
export async function loadViewerLibrary(viewerId: string | null | undefined, section: LibrarySection, japanese: boolean): Promise<LibraryColumnData | null> {
  if (!viewerId) return null;
  const database = getOptionalHubD1();
  if (!database) return null;
  try {
    return await loadLibraryColumn(database, viewerId, section, japanese);
  } catch {
    return null;
  }
}
