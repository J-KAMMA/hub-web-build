import "server-only";
import {NextResponse} from "next/server";
import {HubD1UnavailableError} from "./hub-d1";
import {HubAuthenticationError,HubSuspendedError} from "./hub-session";
import {DesktopHubAuthenticationError} from "./desktop-hub-auth";
import {CommunityMembershipReviewError} from "./community-membership-review";
export const membershipReviewHeaders={"cache-control":"private, no-store"};
export function membershipReviewErrorResponse(error:unknown) {
  const status=error instanceof CommunityMembershipReviewError?error.status:error instanceof HubSuspendedError?403
    :error instanceof HubAuthenticationError || error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:500;
  return NextResponse.json({error:error instanceof Error?error.message:"参加申請を確認できませんでした。"},{status,headers:membershipReviewHeaders});
}
