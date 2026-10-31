import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import { DirectMessage, MessageConversation, Profile } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getHubViewer } from "@/lib/server/hub-viewer";
import {
  countD1UnreadDirectMessages,
  listD1DirectMessagePageData,
} from "@/lib/server/d1-direct-messages";
import { countD1UnreadNotifications } from "@/lib/server/d1-notifications";

export interface MessagesPageData {
  currentProfileId: string;
  notificationCount: number;
  messageCount: number;
  conversations: MessageConversation[];
  messages: DirectMessage[];
  profiles: Profile[];
  activeConversationId?: string;
}

export async function getMessagesPageData(conversationId?: string): Promise<MessagesPageData | null> {
  const database = getHubD1();
  const viewer = await getHubViewer();
  if (viewer) {
    const [data, notificationCount, messageCount, contacts] = await Promise.all([
      listD1DirectMessagePageData(database, viewer.id, conversationId),
      countD1UnreadNotifications(database, viewer.id, { excludeMessageReceived: true }),
      countD1UnreadDirectMessages(database, viewer.id),
      listD1ContactProfiles(database, viewer.id),
    ]);
    const profileMap = new Map(data.profiles.map((profile) => [profile.id, profile]));
    for (const profile of contacts) profileMap.set(profile.id, profile);
    return {
      currentProfileId: viewer.id,
      notificationCount,
      messageCount,
      conversations: data.conversations,
      messages: data.messages,
      profiles: [...profileMap.values()],
      activeConversationId: conversationId ?? data.conversations[0]?.id,
    };
  }
  return null;
}

export async function listD1ContactProfiles(database: D1Database, profileId: string): Promise<Profile[]> {
  const result = await database.prepare(`SELECT DISTINCT p.id, p.handle, p.display_name, p.bio, p.avatar_url, p.joined_at
    FROM profiles p
    JOIN follows f ON (f.follower_profile_id = p.id AND f.followed_profile_id = ?)
      OR (f.followed_profile_id = p.id AND f.follower_profile_id = ?)
    WHERE p.id <> ? AND p.kind <> 'remote' AND NOT EXISTS (
      SELECT 1 FROM thread_user_controls control WHERE control.blocked = 1 AND (
        (control.owner_profile_id = ? AND control.target_profile_id = p.id)
        OR (control.owner_profile_id = p.id AND control.target_profile_id = ?)
      )
    ) ORDER BY p.display_name LIMIT 100`)
    .bind(profileId, profileId, profileId, profileId, profileId).all<{
      id: string; handle: string; display_name: string; bio: string; avatar_url: string | null; joined_at: string;
    }>();
  return result.results.map((row) => ({
    id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined, joinedAt: row.joined_at,
  }));
}
