import { POST as schedule } from "@/app/api/communities/[communityId]/scheduled/route";
import { clientCommunityMutation } from "@/lib/server/client-community-operation";
export const POST = clientCommunityMutation("schedule", schedule);
