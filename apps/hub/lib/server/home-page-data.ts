import "server-only";

import type { EngagementSummary, FollowRelation, Profile, SocialPost, ThreadPost, UserList } from "@/lib/domain";
import { getD1ViewerData } from "@/lib/server/d1-viewer-data";
import { getHubD1 } from "@/lib/server/hub-d1";

interface HomeTimelinePost extends SocialPost {
  avatarUrl?: string;
  replyCount: number;
  repostCount: number;
  quoteRepostCount: number;
  likeCount: number;
  score: number;
  bookmarked: boolean;
  viewerReaction: EngagementSummary["viewerReaction"];
  referenced: { label: string; title: string; body: string; href: string; contextLabel?: string; avatarUrl?: string; avatarLabel?: string } | null;
}

export interface HomeThreadResponse extends ThreadPost {
  threadTitle: string;
  authorAvatarUrl?: string;
  authorHandle?: string;
  engagement: EngagementSummary;
}

export interface HomePageData {
  authenticated: boolean;
  currentProfile: Profile;
  notificationCount: number;
  messageCount: number;
  posts: HomeTimelinePost[];
  threadResponses: HomeThreadResponse[];
  follows: FollowRelation[];
  lists: Array<UserList & {
    profileItems: Array<{ id: string; displayName: string; handle: string }>;
    threadItems: Array<{ id: string; title: string }>;
  }>;
}

export async function getHomePageData(): Promise<HomePageData> {
  getHubD1();
  const data = await getD1ViewerData();
  return {
    authenticated: data.authenticated,
    currentProfile: data.currentProfile,
    notificationCount: data.notificationCount,
    messageCount: data.messageCount,
    posts: data.socialPosts,
    threadResponses: [],
    follows: data.follows,
    lists: data.lists,
  };
}
