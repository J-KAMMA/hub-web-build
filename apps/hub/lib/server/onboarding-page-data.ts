import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { headers } from "next/headers";

import { HUB_ONBOARDING_INTERESTS, type HubOnboardingInterestId } from "@/lib/onboarding";
import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";

export interface OnboardingProfileOption {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  avatarUrl?: string;
  followerCount: number;
  selected: boolean;
}

export interface OnboardingCommunityOption {
  id: string;
  name: string;
  description: string;
  category: string;
  imageUrl?: string;
  memberCount: number;
  selected: boolean;
}

export interface OnboardingPageData {
  interests: typeof HUB_ONBOARDING_INTERESTS;
  selectedInterests: HubOnboardingInterestId[];
  profiles: OnboardingProfileOption[];
  communities: OnboardingCommunityOption[];
}

type ProfileRow = {
  id: string;
  handle: string;
  display_name: string;
  bio: string;
  avatar_url: string | null;
  follower_count: number;
  selected: number;
};
type CommunityRow = {
  id: string;
  name: string;
  description: string;
  category: string;
  image_url: string | null;
  member_count: number;
  selected: number;
};
type PreferenceRow = { interests_json: string };

async function d1PageData(database: D1Database): Promise<OnboardingPageData | null> {
  const request = new Request("http://hub.local/onboarding", { headers: await headers() });
  const viewer = await getOptionalHubSessionProfile(request, database);
  if (!viewer) return null;

  const [profileResult, communityResult, preference] = await Promise.all([
    database.prepare(`SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url,
        (SELECT count(*) FROM follows f WHERE f.followed_profile_id = p.id) AS follower_count,
        EXISTS(SELECT 1 FROM follows f WHERE f.follower_profile_id = ? AND f.followed_profile_id = p.id) AS selected
      FROM profiles p
      WHERE p.id <> ?
        AND NOT EXISTS (
          SELECT 1 FROM thread_user_controls control
          WHERE control.blocked = 1 AND (
            (control.owner_profile_id = ? AND control.target_profile_id = p.id)
            OR (control.owner_profile_id = p.id AND control.target_profile_id = ?)
          )
        )
      ORDER BY follower_count DESC, p.joined_at
      LIMIT 8`).bind(viewer.id, viewer.id, viewer.id, viewer.id).all<ProfileRow>(),
    database.prepare(`SELECT c.id, c.name, c.description, c.category, c.image_url,
        (SELECT count(*) FROM community_memberships cm WHERE cm.community_id = c.id AND cm.status <> 'banned') AS member_count,
        EXISTS(SELECT 1 FROM community_memberships cm WHERE cm.community_id = c.id AND cm.profile_id = ? AND cm.status <> 'banned') AS selected
      FROM communities c
      ORDER BY member_count DESC, c.created_at
      LIMIT 8`).bind(viewer.id).all<CommunityRow>(),
    database.prepare("SELECT interests_json FROM profile_onboarding WHERE profile_id = ? LIMIT 1")
      .bind(viewer.id).first<PreferenceRow>()
  ]);

  const parsedInterests = preference
    ? JSON.parse(preference.interests_json) as unknown
    : [];
  const allowedIds = new Set<string>(HUB_ONBOARDING_INTERESTS.map((interest) => interest.id));
  const selectedInterests = Array.isArray(parsedInterests)
    ? parsedInterests.filter((interest): interest is HubOnboardingInterestId => typeof interest === "string" && allowedIds.has(interest))
    : [];

  return {
    interests: HUB_ONBOARDING_INTERESTS,
    selectedInterests,
    profiles: profileResult.results.map((profile) => ({
      id: profile.id,
      handle: profile.handle,
      displayName: profile.display_name,
      bio: profile.bio,
      avatarUrl: profile.avatar_url ?? undefined,
      followerCount: Number(profile.follower_count),
      selected: profile.selected === 1
    })),
    communities: communityResult.results.map((community) => ({
      id: community.id,
      name: community.name,
      description: community.description,
      category: community.category,
      imageUrl: community.image_url ?? undefined,
      memberCount: Number(community.member_count),
      selected: community.selected === 1
    }))
  };
}

export async function getOnboardingPageData(): Promise<OnboardingPageData | null> {
  return d1PageData(getHubD1());
}
