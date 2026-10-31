import "server-only";

import { cache } from "react";
import type { D1Database } from "@cloudflare/workers-types";

import type { MessageConversation, Profile, ThreadSummary } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { getD1PinnedProfilePostId } from "@/lib/server/profile-pinned-posts";
import { countD1VisibleUnreadNotifications } from "@/lib/server/visible-notification-count";
import { countD1VisibleUnreadMessages } from "@/lib/server/visible-message-count";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import type { ServerTimelinePost } from "@/lib/server/social-timeline-post";

export type ProfileThreadItem = Pick<ThreadSummary, "id" | "boardKey" | "title" | "postCount" | "updatedAt">;
export type ProfileListItem = Pick<Profile, "id" | "handle" | "displayName" | "avatarUrl">;
export type ProfileCommunityItem = { id: string; slug: string; name: string; imageUrl?: string; published: boolean };
export type ProfileWalletItem = { address: string; network: string; published: boolean };
export type ProfileLinkItem = { label: string; url: string };

interface MissingProfilePageData {
  profile: null;
}

interface FoundProfilePageData {
  profile: Profile;
  currentProfile: Profile;
  notificationCount: number;
  messageCount: number;
  existingConversation: MessageConversation | undefined;
  following: boolean;
  followerCount: number;
  followingCount: number;
  isCurrentUser: boolean;
  /** 他のハブの人（影のプロフィール）。DM は送れない。 */
  isRemote: boolean;
  posts: ServerTimelinePost[];
  threads: ProfileThreadItem[];
  pinnedPostId: string | null;
  followers: ProfileListItem[];
  followingProfiles: ProfileListItem[];
  externalLinks: ProfileLinkItem[];
  communities: ProfileCommunityItem[];
  wallets: ProfileWalletItem[];
  profileControl: { muted: boolean; blocked: boolean };
}

export type ProfilePageData = MissingProfilePageData | FoundProfilePageData;

type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  joined_at: string;
  kind?: string | null;
};

type CountRow = { total: number };
type ThreadRow = {
  id: string;
  board_key: string;
  title: string;
  post_count: number;
  updated_at: string;
};
type ProfileListRow = { id: string; handle: string; display_name: string; avatar_url: string | null };
type LinkRow = { label: string; url: string };
type CommunityRow = { id: string; slug: string; name: string; image_url: string | null; profile_visibility: "private" | "public" };
type WalletRow = { wallet_address: string; network: string; visibility: "private" | "public" };
type ControlRow = { muted: number; blocked: number };

async function getD1ProfilePageData(database: D1Database, handle: string, skipCounts: boolean): Promise<ProfilePageData> {
  return getD1ProfilePageDataForViewer(database, handle, await getHubViewer(), { skipCounts });
}

/** viewerを外から渡す版——クライアントAPI（desktop assertion）でも同じ形で返せるように。 */
export async function getD1ProfilePageDataForViewer(
  database: D1Database,
  handle: string,
  viewer: Profile | null,
  options: { skipCounts?: boolean } = {},
): Promise<ProfilePageData> {
  const viewerId = viewer?.id ?? null;
  const visibleConnectionProfileFilter = `NOT EXISTS (
      SELECT 1
      FROM profile_moderation_status connection_moderation
      WHERE connection_moderation.profile_id = connection_profile.id
        AND connection_moderation.status = 'suspended'
    )
    AND (
      ? = ''
      OR NOT EXISTS (
        SELECT 1
        FROM thread_user_controls connection_control
        WHERE connection_control.blocked = 1
          AND (
            (
              connection_control.owner_profile_id = ?
              AND connection_control.target_profile_id = connection_profile.id
            )
            OR (
              connection_control.owner_profile_id = connection_profile.id
              AND connection_control.target_profile_id = ?
            )
          )
      )
    )`;
  const row = await database.prepare(`SELECT id, handle, display_name, bio, avatar_url, joined_at, kind
    FROM profiles p
    WHERE p.handle = ? COLLATE NOCASE
      AND NOT EXISTS (
        SELECT 1 FROM profile_moderation_status moderation
        WHERE moderation.profile_id = p.id AND moderation.status = 'suspended'
      )
      AND (? = '' OR NOT EXISTS (
        SELECT 1 FROM thread_user_controls control
        WHERE control.blocked = 1 AND (
          (control.owner_profile_id = ? AND control.target_profile_id = p.id)
          OR (control.owner_profile_id = p.id AND control.target_profile_id = ?)
        )
      ))
    LIMIT 1`).bind(handle, viewerId ?? "", viewerId ?? "", viewerId ?? "").first<ProfileRow>();
  if (!row) return { profile: null };

  const [posts, followerCount, followingCount, following, notificationCount, messageCount, pinnedPostId, threadRows,
    followerRows, followingRows, linkRows, communityRows, walletRows, controlRow] = await Promise.all([
    listD1TimelinePosts(database, viewerId, row.id, 100),
    database.prepare(`SELECT count(*) AS total
      FROM follows f
      JOIN profiles connection_profile ON connection_profile.id = f.follower_profile_id
      WHERE f.followed_profile_id = ?
        AND ${visibleConnectionProfileFilter}`)
      .bind(row.id, viewerId ?? "", viewerId ?? "", viewerId ?? "").first<CountRow>(),
    database.prepare(`SELECT count(*) AS total
      FROM follows f
      JOIN profiles connection_profile ON connection_profile.id = f.followed_profile_id
      WHERE f.follower_profile_id = ?
        AND ${visibleConnectionProfileFilter}`)
      .bind(row.id, viewerId ?? "", viewerId ?? "", viewerId ?? "").first<CountRow>(),
    viewerId
      ? database.prepare("SELECT 1 AS total FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1")
        .bind(viewerId, row.id).first<CountRow>()
      : Promise.resolve(null),
    viewerId && !options.skipCounts
      ? countD1VisibleUnreadNotifications(database, viewerId)
      : Promise.resolve(null),
    viewerId && !options.skipCounts
      ? countD1VisibleUnreadMessages(database, viewerId)
      : Promise.resolve(null),
    getD1PinnedProfilePostId(database, row.id),
    database.prepare(`SELECT t.id, b.board_key, t.title,
        (SELECT count(*) FROM thread_posts tp WHERE tp.thread_id = t.id) AS post_count,
        t.updated_at
      FROM threads t JOIN boards b ON b.id = t.board_id
      WHERE t.created_by_profile_id = ?
      ORDER BY t.updated_at DESC LIMIT 100`).bind(row.id).all<ThreadRow>(),
    database.prepare(`SELECT
        connection_profile.id,
        connection_profile.handle,
        connection_profile.display_name,
        connection_profile.avatar_url
      FROM follows f
      JOIN profiles connection_profile ON connection_profile.id = f.follower_profile_id
      WHERE f.followed_profile_id = ?
        AND ${visibleConnectionProfileFilter}
      ORDER BY f.created_at DESC
      LIMIT 100`)
      .bind(row.id, viewerId ?? "", viewerId ?? "", viewerId ?? "").all<ProfileListRow>(),
    database.prepare(`SELECT
        connection_profile.id,
        connection_profile.handle,
        connection_profile.display_name,
        connection_profile.avatar_url
      FROM follows f
      JOIN profiles connection_profile ON connection_profile.id = f.followed_profile_id
      WHERE f.follower_profile_id = ?
        AND ${visibleConnectionProfileFilter}
      ORDER BY f.created_at DESC
      LIMIT 100`)
      .bind(row.id, viewerId ?? "", viewerId ?? "", viewerId ?? "").all<ProfileListRow>(),
    database.prepare(`SELECT label, url FROM profile_external_links WHERE profile_id = ? ORDER BY position`)
      .bind(row.id).all<LinkRow>(),
    database.prepare(`SELECT c.id, c.slug, c.name, c.image_url, m.profile_visibility
      FROM community_memberships m JOIN communities c ON c.id = m.community_id
      WHERE m.profile_id = ? AND (m.profile_visibility = 'public' OR ? = ?)
      ORDER BY m.joined_at DESC LIMIT 100`).bind(row.id, viewerId ?? "", row.id).all<CommunityRow>(),
    database.prepare(`SELECT wallet_address, network, visibility FROM profile_wallet_links
      WHERE profile_id = ? AND (visibility = 'public' OR ? = ?)
      ORDER BY verified_at DESC LIMIT 20`).bind(row.id, viewerId ?? "", row.id).all<WalletRow>(),
    viewerId && viewerId !== row.id
      ? database.prepare(`SELECT muted, blocked FROM thread_user_controls
        WHERE owner_profile_id = ? AND target_profile_id = ? LIMIT 1`).bind(viewerId, row.id).first<ControlRow>()
      : Promise.resolve(null),
  ]);

  const profile: Profile = {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined,
    joinedAt: row.joined_at,
    isCurrentUser: viewerId === row.id,
  };
  const publicViewer: Profile = viewer ?? { id: "", handle: "guest", displayName: "ゲスト", bio: "", joinedAt: "" };
  return {
    profile,
    currentProfile: publicViewer,
    notificationCount: Number(notificationCount ?? 0),
    messageCount: Number(messageCount ?? 0),
    existingConversation: undefined,
    following: Boolean(following),
    followerCount: Number(followerCount?.total ?? 0),
    followingCount: Number(followingCount?.total ?? 0),
    isCurrentUser: viewerId === row.id,
    isRemote: row.kind === "remote",
    posts,
    threads: threadRows.results.map((thread) => ({
      id: thread.id,
      boardKey: thread.board_key,
      title: thread.title,
      postCount: Number(thread.post_count),
      updatedAt: thread.updated_at,
    })),
    pinnedPostId,
    followers: followerRows.results.map((item) => ({ id: item.id, handle: item.handle, displayName: item.display_name, avatarUrl: item.avatar_url ?? undefined })),
    followingProfiles: followingRows.results.map((item) => ({ id: item.id, handle: item.handle, displayName: item.display_name, avatarUrl: item.avatar_url ?? undefined })),
    externalLinks: linkRows.results,
    communities: communityRows.results.map((item) => ({ id: item.id, slug: item.slug, name: item.name, imageUrl: item.image_url ?? undefined, published: item.profile_visibility === "public" })),
    wallets: walletRows.results.map((item) => ({ address: item.wallet_address, network: item.network, published: item.visibility === "public" })),
    profileControl: { muted: Boolean(controlRow?.muted), blocked: Boolean(controlRow?.blocked) },
  };
}

/*
 * generateMetadata and the page share one build per request. Pass skipCounts = true when the
 * caller already has the unread counts from the app shell (every v2 page does).
 */
export const getProfilePageData = cache(async (handle: string, skipCounts = false): Promise<ProfilePageData> => {
  return getD1ProfilePageData(getHubD1(), handle, skipCounts);
});
