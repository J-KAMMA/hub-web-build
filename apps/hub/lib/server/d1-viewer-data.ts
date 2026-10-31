import "server-only";

import type { FollowRelation, Profile, UserList } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { countD1VisibleUnreadNotifications } from "@/lib/server/visible-notification-count";
import { countD1VisibleUnreadMessages } from "@/lib/server/visible-message-count";
import { getHubViewer } from "@/lib/server/hub-viewer";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";

type FollowRow = { follower_profile_id: string; followed_profile_id: string };
type ListRow = { id: string; name: string; description: string; visibility: "public" | "private"; sort_order: number };
type ListProfileRow = { list_id: string; id: string; display_name: string; handle: string };
type ListThreadRow = { list_id: string; id: string; title: string };

const INITIAL_TIMELINE_POST_LIMIT = 12;

const PUBLIC_VIEWER: Profile = {
  id: "",
  handle: "guest",
  displayName: "ゲスト",
  bio: "",
  joinedAt: "1970-01-01T00:00:00.000Z"
};

export interface D1ViewerDataOptions {
  /** Load follows, lists, list members and list threads. Defaults to true; the app shell opts out. */
  relations?: boolean;
}

export async function getD1ViewerData(options: D1ViewerDataOptions = {}) {
  const loadRelations = options.relations !== false;
  const database = getHubD1();
  const viewer = await getHubViewer();
  const viewerId = viewer?.id ?? null;

  const [socialPosts, followsResult, listResult, listProfilesResult, listThreadsResult, notificationCount, messageCount] = await Promise.all([
    listD1TimelinePosts(database, viewerId, undefined, INITIAL_TIMELINE_POST_LIMIT, 0),
    viewerId && loadRelations
      ? database.prepare("SELECT follower_profile_id, followed_profile_id FROM follows WHERE follower_profile_id = ? OR followed_profile_id = ?")
        .bind(viewerId, viewerId).all<FollowRow>()
      : Promise.resolve({ results: [] as FollowRow[] }),
    viewerId && loadRelations
      ? database.prepare("SELECT id, name, description, visibility, sort_order FROM user_lists WHERE owner_profile_id = ? ORDER BY sort_order, created_at")
        .bind(viewerId).all<ListRow>()
      : Promise.resolve({ results: [] as ListRow[] }),
    viewerId && loadRelations
      ? database.prepare(`SELECT lp.list_id, p.id, p.display_name, p.handle
          FROM list_profiles lp JOIN user_lists l ON l.id = lp.list_id JOIN profiles p ON p.id = lp.profile_id
          WHERE l.owner_profile_id = ? ORDER BY lp.position, lp.added_at`).bind(viewerId).all<ListProfileRow>()
      : Promise.resolve({ results: [] as ListProfileRow[] }),
    viewerId && loadRelations
      ? database.prepare(`SELECT lt.list_id, t.id, t.title
          FROM list_threads lt JOIN user_lists l ON l.id = lt.list_id JOIN threads t ON t.id = lt.thread_id
          WHERE l.owner_profile_id = ? ORDER BY lt.position, lt.added_at`).bind(viewerId).all<ListThreadRow>()
      : Promise.resolve({ results: [] as ListThreadRow[] }),
    viewerId
      ? countD1VisibleUnreadNotifications(database, viewerId, { excludeMessages: true })
      : Promise.resolve(null),
    viewerId
      ? countD1VisibleUnreadMessages(database, viewerId)
      : Promise.resolve(null),
  ]);

  const profileRowsByList = new Map<string, ListProfileRow[]>();
  for (const row of listProfilesResult.results) {
    profileRowsByList.set(row.list_id, [...(profileRowsByList.get(row.list_id) ?? []), row]);
  }
  const threadRowsByList = new Map<string, ListThreadRow[]>();
  for (const row of listThreadsResult.results) {
    threadRowsByList.set(row.list_id, [...(threadRowsByList.get(row.list_id) ?? []), row]);
  }

  const lists = listResult.results.map((row): UserList & {
    profileItems: Array<{ id: string; displayName: string; handle: string }>;
    threadItems: Array<{ id: string; title: string }>;
  } => {
    const profileItems = (profileRowsByList.get(row.id) ?? []).map((profile) => ({
      id: profile.id,
      displayName: profile.display_name,
      handle: profile.handle
    }));
    const threadItems = (threadRowsByList.get(row.id) ?? []).map((thread) => ({ id: thread.id, title: thread.title }));
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      visibility: row.visibility,
      order: Number(row.sort_order),
      profileIds: profileItems.map((profile) => profile.id),
      threadIds: threadItems.map((thread) => thread.id),
      profileItems,
      threadItems
    };
  });

  const follows: FollowRelation[] = followsResult.results.map((row) => ({
    followerProfileId: row.follower_profile_id,
    followedProfileId: row.followed_profile_id
  }));

  return {
    currentProfile: viewer ?? PUBLIC_VIEWER,
    authenticated: Boolean(viewer),
    socialPosts,
    follows,
    lists,
    notificationCount: Number(notificationCount ?? 0),
    messageCount: Number(messageCount ?? 0)
  };
}
