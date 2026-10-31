import { POST as create, PATCH as vote } from "@/app/api/communities/[communityId]/polls/route";
import { clientCommunityMutation } from "@/lib/server/client-community-operation";
export { GET } from "@/app/api/communities/[communityId]/polls/route";
export const POST = clientCommunityMutation("poll", create);
export const PATCH = clientCommunityMutation("vote", vote);
