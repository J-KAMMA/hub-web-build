import type { D1Database } from "@cloudflare/workers-types";

import { listD1AuthorHubVideosPage, type AuthorHubVideoCard } from "@/lib/server/d1-videos";
import { encodeWorkCursor, findListableAuthorId, type WorkCursor } from "@/lib/server/profile-works";

export const CHANNEL_FOLLOWER_CAP = 1000;
export const CHANNEL_PAGE_SIZE = 24;

export type VideoChannelHeader = {
  profileId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  followerCount: number;
  followerCountCapped: boolean;
  viewerFollows: boolean;
  isViewer: boolean;
};

export type VideoChannel = {
  channel: VideoChannelHeader;
  videos: AuthorHubVideoCard[];
  nextCursor: string | null;
};

/**
 * One Hub author's video channel: header plus a keyset page of their Hub-made videos. The follower
 * count is bounded (at most CAP + 1 rows are read) and reported as capped rather than exact. Gated
 * videos keep only their public descriptor (listD1AuthorHubVideosPage -> redactGated).
 */
export async function getD1VideoChannel(
  database: D1Database,
  handle: string,
  viewerProfileId: string | null,
  cursor: WorkCursor | null,
): Promise<VideoChannel | null> {
  const profileId = await findListableAuthorId(database, handle);
  if (!profileId) return null;
  const [profile, followers, follows, page] = await Promise.all([
    database.prepare("SELECT handle, display_name, avatar_url, bio FROM profiles WHERE id = ? LIMIT 1")
      .bind(profileId)
      .first<{ handle: string; display_name: string; avatar_url: string | null; bio: string | null }>(),
    database.prepare(`SELECT COUNT(*) AS n FROM (SELECT 1 FROM follows WHERE followed_profile_id = ? LIMIT ${CHANNEL_FOLLOWER_CAP + 1})`)
      .bind(profileId)
      .first<{ n: number }>(),
    viewerProfileId && viewerProfileId !== profileId
      ? database.prepare("SELECT 1 AS f FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1")
        .bind(viewerProfileId, profileId)
        .first()
      : Promise.resolve(null),
    listD1AuthorHubVideosPage(database, profileId, { limit: CHANNEL_PAGE_SIZE, before: cursor, viewerProfileId }),
  ]);
  if (!profile) return null;
  const rows = Number(followers?.n ?? 0);
  const capped = rows > CHANNEL_FOLLOWER_CAP;
  return {
    channel: {
      profileId,
      handle: profile.handle,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url ?? null,
      bio: profile.bio ?? "",
      followerCount: capped ? CHANNEL_FOLLOWER_CAP : rows,
      followerCountCapped: capped,
      viewerFollows: Boolean(follows),
      isViewer: Boolean(viewerProfileId) && viewerProfileId === profileId,
    },
    videos: page.videos,
    nextCursor: page.nextCursor ? encodeWorkCursor(page.nextCursor) : null,
  };
}

export type VideoFollowState =
  | { kind: "profile"; profileId: string; following: boolean }
  | { kind: "channel"; channel: string; provider: string; following: boolean };

const channelKey = (channel: string, provider: string) => `${channel.trim().toLocaleLowerCase("ja")}:${provider}`;

/**
 * What the watch page's follow button should act on, with the viewer's current state (single PK
 * probe). Hub videos follow the owner profile; external videos follow the (channel, provider)
 * pair, the same key /api/videos/channels uses. Returns null when the viewer owns the channel.
 */
export async function getVideoFollowState(
  database: D1Database,
  video: { provider: string; channel: string; channelHandle?: string },
  viewerProfileId: string | null,
): Promise<VideoFollowState | null> {
  if (video.provider === "hub") {
    if (!video.channelHandle) return null;
    const profileId = await findListableAuthorId(database, video.channelHandle);
    if (!profileId || profileId === viewerProfileId) return null;
    const row = viewerProfileId
      ? await database.prepare("SELECT 1 AS f FROM follows WHERE follower_profile_id = ? AND followed_profile_id = ? LIMIT 1").bind(viewerProfileId, profileId).first()
      : null;
    return { kind: "profile", profileId, following: Boolean(row) };
  }
  const channel = video.channel.trim().slice(0, 160);
  if (!channel) return null;
  const row = viewerProfileId
    ? await database.prepare("SELECT 1 AS f FROM video_channel_follows WHERE profile_id = ? AND channel_key = ? LIMIT 1").bind(viewerProfileId, channelKey(channel, video.provider)).first()
    : null;
  return { kind: "channel", channel, provider: video.provider, following: Boolean(row) };
}
