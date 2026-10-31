import type { D1Database } from "@cloudflare/workers-types";

import { listD1ExternalVideosByIds, type PublicVideoEntry } from "./d1-videos";
import { listD1MusicWorksByIds } from "./d1-music";
import { listFollowedTags } from "./d1-user-article-tag-follows";
import type { MusicWork } from "@/lib/music-catalog";

/**
 * デスクトップの内側左列（2026-10-15）。署名済みの本人だけを相手に、
 * フォロー中のタグと「登録チャンネル」（その画面に出す人・チャンネル）を返す。
 *
 * 費用の決まり（D1 は読んだ行で課金）:
 * - 一覧はキーセット（主キーの並び）で1頁ずつ読む。OFFSET も集計も使わない。
 * - 「その種類を公開しているか」は 1 行で止まる EXISTS（作者の索引を使う）。
 * - 並びは主キー順。名前順にすると毎回フォロー全件を読むことになる。
 */

export const SIDEBAR_KINDS = ["feed", "videos", "music", "articles"] as const;
export type SidebarKind = (typeof SIDEBAR_KINDS)[number];
export const SIDEBAR_PAGE_SIZE = 30;
/** 登録チャンネルの新着を探すとき、新しい動画を何件まで遡るか（読む行の上限）。 */
export const SUBSCRIPTION_VIDEO_SCAN = 500;
/** 登録チャンネルの新着の件数。 */
export const SUBSCRIPTION_LIMIT = 30;
/** 新着の音楽で見るフォローの上限。 */
export const SUBSCRIPTION_FOLLOW_SCAN = 500;

export class SidebarRequestError extends Error {
  constructor() {
    super("指定が正しくありません。");
    this.name = "SidebarRequestError";
  }
}

export type SidebarChannel =
  | { type: "profile"; id: string; handle: string; name: string; avatarUrl: string | null }
  | { type: "video_channel"; id: string; name: string; provider: string };

export interface SidebarPage {
  kind: SidebarKind;
  followedTags?: string[];
  channels: SidebarChannel[];
  nextCursor: string | null;
}

export function parseSidebarKind(value: unknown): SidebarKind {
  if (typeof value === "string" && (SIDEBAR_KINDS as readonly string[]).includes(value)) return value as SidebarKind;
  throw new SidebarRequestError();
}

/** 頁の続きは最後の主キーを base64url にしたもの（パスの1区切りに収まる文字だけ）。 */
export function encodeSidebarCursor(key: string): string {
  return Buffer.from(key, "utf8").toString("base64url");
}

export function decodeSidebarCursor(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 200 || !/^[A-Za-z0-9_-]+$/u.test(value)) throw new SidebarRequestError();
  const key = Buffer.from(value, "base64url").toString("utf8");
  if (!key || key.length > 150 || /[\u0000-\u001f\u007f]/u.test(key) || encodeSidebarCursor(key) !== value) throw new SidebarRequestError();
  return key;
}

type ProfileRow = { id: string; handle: string; display_name: string; avatar_url: string | null };
type ChannelRow = { channel_key: string; display_name: string; provider: string };

const PUBLISHES: Record<Exclude<SidebarKind, "videos">, string> = {
  feed: "",
  articles: `AND EXISTS (SELECT 1 FROM hub_user_articles a
    WHERE a.author_profile_id = f.followed_profile_id AND a.status = 'published' AND a.moderated_at IS NULL LIMIT 1)`,
  music: `AND EXISTS (SELECT 1 FROM music_works m
    WHERE m.submitted_by_profile_id = f.followed_profile_id AND m.status = 'active' LIMIT 1)`,
};

/** 本人のサイドバーの1頁。cursor が無い最初の頁だけフォロー中のタグを添える。 */
export async function getClientSidebarPage(
  database: D1Database,
  viewerId: string,
  kind: SidebarKind,
  cursor: string | null = null,
): Promise<SidebarPage> {
  const after = cursor === null ? "" : decodeSidebarCursor(cursor);
  const take = SIDEBAR_PAGE_SIZE + 1;
  let channels: SidebarChannel[];
  let keys: string[];
  if (kind === "videos") {
    const result = await database.prepare(`SELECT f.channel_key, c.display_name, c.provider
      FROM video_channel_follows f
      JOIN video_channels c ON c.channel_key = f.channel_key AND c.status = 'active'
      WHERE f.profile_id = ? AND f.channel_key > ?
      ORDER BY f.channel_key
      LIMIT ${take}`).bind(viewerId, after).all<ChannelRow>();
    const rows = result.results ?? [];
    keys = rows.map((row) => row.channel_key);
    channels = rows.map((row) => ({ type: "video_channel", id: row.channel_key, name: row.display_name, provider: row.provider }));
  } else {
    const result = await database.prepare(`SELECT p.id, p.handle, p.display_name, p.avatar_url
      FROM follows f
      JOIN profiles p ON p.id = f.followed_profile_id
      WHERE f.follower_profile_id = ? AND f.followed_profile_id > ? ${PUBLISHES[kind]}
      ORDER BY f.followed_profile_id
      LIMIT ${take}`).bind(viewerId, after).all<ProfileRow>();
    const rows = result.results ?? [];
    keys = rows.map((row) => row.id);
    channels = rows.map((row) => ({ type: "profile", id: row.id, handle: row.handle, name: row.display_name, avatarUrl: row.avatar_url ?? null }));
  }
  const more = channels.length > SIDEBAR_PAGE_SIZE;
  const page: SidebarPage = {
    kind,
    channels: channels.slice(0, SIDEBAR_PAGE_SIZE),
    nextCursor: more ? encodeSidebarCursor(keys[SIDEBAR_PAGE_SIZE - 1]) : null,
  };
  if (cursor === null) page.followedTags = await listFollowedTags(database, viewerId);
  return page;
}

/** 登録チャンネルの新着。動画は追っているチャンネル、音楽は追っている人の登録した曲。 */
export async function getClientSubscriptions(
  database: D1Database,
  viewerId: string,
  kind: "videos" | "music",
): Promise<{ kind: "videos"; videos: PublicVideoEntry[] } | { kind: "music"; works: MusicWork[] }> {
  if (kind === "videos") {
    const result = await database.prepare(`SELECT v.id FROM (
        SELECT id, channel, provider, published_at, created_at FROM external_videos
        WHERE status = 'active'
        ORDER BY published_at DESC, created_at DESC
        LIMIT ${SUBSCRIPTION_VIDEO_SCAN}
      ) v
      WHERE lower(trim(v.channel)) || ':' || v.provider IN (SELECT channel_key FROM video_channel_follows WHERE profile_id = ?)
      ORDER BY v.published_at DESC, v.created_at DESC
      LIMIT ${SUBSCRIPTION_LIMIT}`).bind(viewerId).all<{ id: string }>();
    const ids = (result.results ?? []).map((row) => row.id);
    return { kind, videos: await listD1ExternalVideosByIds(database, ids, viewerId) };
  }
  const result = await database.prepare(`SELECT m.id FROM music_works m
    WHERE m.status = 'active' AND m.submitted_by_profile_id IN (
      SELECT followed_profile_id FROM follows WHERE follower_profile_id = ? LIMIT ${SUBSCRIPTION_FOLLOW_SCAN}
    )
    ORDER BY m.created_at DESC
    LIMIT ${SUBSCRIPTION_LIMIT}`).bind(viewerId).all<{ id: string }>();
  const ids = (result.results ?? []).map((row) => row.id);
  const works = await listD1MusicWorksByIds(database, ids);
  const byId = new Map(works.map((work) => [work.id, work]));
  return { kind, works: ids.flatMap((id) => byId.get(id) ?? []) };
}
