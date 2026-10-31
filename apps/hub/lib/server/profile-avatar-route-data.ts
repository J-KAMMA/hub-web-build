import "server-only";

import type { Profile } from "@/lib/domain";

export interface UpdateCurrentProfileAvatarRouteData {
  profile: Profile;
}

export async function updateCurrentProfileAvatarRouteData(
  avatarUrl: string,
): Promise<UpdateCurrentProfileAvatarRouteData> {
  const { getCurrentProfile, updateProfileAvatar } = await import("@/lib/mock-data");
  const currentProfile = getCurrentProfile();

  return {
    profile: updateProfileAvatar(currentProfile.id, avatarUrl)
  };
}
