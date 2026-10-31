import "server-only";

import {
  type EngagementSummary,
  type EngagementTargetType,
} from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, getOptionalHubSessionProfile, requireHubSessionProfile } from "@/lib/server/hub-session";
import { getD1EngagementSummary, toggleD1Bookmark, toggleD1Reaction } from "@/lib/server/d1-engagements";

type BookmarkInput = {
  targetType: "thread" | EngagementTargetType;
  targetId: string;
  note?: string;
  active?: boolean;
};
type ReactionInput = {
  targetType: EngagementTargetType;
  targetId: string;
  kind: "like";
  active?: boolean;
};

export async function toggleBookmarkRouteData(request: Request, input: BookmarkInput) {
  const database = getHubD1();
  const viewer = await requireHubSessionProfile(request, database);
  return toggleD1Bookmark(database, { ...input, profileId: viewer.id });
}

export async function toggleReactionRouteData(request: Request, input: ReactionInput) {
  const database = getHubD1();
  const viewer = await requireHubSessionProfile(request, database);
  return toggleD1Reaction(database, {
    ...input,
    profileId: viewer.id,
    profileJoinedAt: viewer.joinedAt,
  });
}

export async function getEngagementSummaryRouteData(
  request: Request,
  targetType: EngagementTargetType,
  targetId: string,
): Promise<EngagementSummary> {
  const database = getHubD1();
  const viewer = await getOptionalHubSessionProfile(request, database);
  return getD1EngagementSummary(database, targetType, targetId, viewer?.id ?? null);
}
