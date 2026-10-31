import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";

export interface UpdateCurrentProfileRouteData {
  profile: Profile;
}

export async function updateCurrentProfileRouteData(input: {
  displayName: string;
  bio: string;
}): Promise<UpdateCurrentProfileRouteData> {
  const { getCurrentProfile, updateProfile } = await import("@/lib/mock-data");
  const currentProfile = getCurrentProfile();

  return {
    profile: updateProfile(currentProfile.id, input)
  };
}

export async function updateD1CurrentProfileRouteData(
  database: D1Database,
  profileId: string,
  input: { displayName: string; bio: string },
) {
  const now = new Date().toISOString();
  await database.prepare("UPDATE profiles SET display_name = ?, bio = ?, updated_at = ? WHERE id = ?")
    .bind(input.displayName, input.bio, now, profileId).run();
  const profile = await database.prepare(`SELECT id, handle, display_name, bio, avatar_url, joined_at
    FROM profiles WHERE id = ? LIMIT 1`).bind(profileId).first<{
      id: string; handle: string; display_name: string; bio: string; avatar_url: string | null; joined_at: string;
    }>();
  if (!profile) throw new Error("プロフィールが見つかりません。");
  return { profile: {
    id: profile.id,
    handle: profile.handle,
    displayName: profile.display_name,
    bio: profile.bio,
    avatarUrl: profile.avatar_url ?? undefined,
    joinedAt: profile.joined_at,
    isCurrentUser: true,
  } };
}
