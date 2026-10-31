import "server-only";

import { getProfileById } from "@/lib/mock-data";
import { SocialPost } from "@/lib/domain";

export function withSocialPostAuthorView<T extends SocialPost>(post: T): T & {
  avatarUrl?: string;
} {
  const profile = post.authorProfileId ? getProfileById(post.authorProfileId) : undefined;

  if (!profile) {
    return {
      ...post
    };
  }

  return {
    ...post,
    displayName: profile.displayName,
    handle: profile.handle,
    avatarUrl: profile.avatarUrl
  };
}
