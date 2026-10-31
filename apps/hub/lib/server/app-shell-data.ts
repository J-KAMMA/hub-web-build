import "server-only";

import { EngagementSummary, FollowRelation, Profile, SocialPost, UserList } from "@/lib/domain";
import { getD1ViewerData } from "@/lib/server/d1-viewer-data";

export interface AppShellTimelinePost extends SocialPost {
  avatarUrl?: string;
  replyCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: EngagementSummary["viewerReaction"];
}

export interface AppShellData {
  currentProfile: Profile;
  socialPosts: AppShellTimelinePost[];
  follows: FollowRelation[];
  lists: UserList[];
  unreadIndicatorCount: number;
  unreadMessageCount: number;
}

/**
 * Shell pages render the viewer, counts and the aside timeline. follows/lists are
 * empty unless a caller passes { relations: true }; no shell consumer reads them.
 */
export async function getAppShellData(options: { relations?: boolean } = {}): Promise<AppShellData> {
  const data = await getD1ViewerData({ relations: options.relations === true });
  return {
    currentProfile: data.currentProfile,
    socialPosts: data.socialPosts,
    follows: data.follows,
    lists: data.lists,
    unreadIndicatorCount: data.notificationCount,
    unreadMessageCount: data.messageCount
  };
}
