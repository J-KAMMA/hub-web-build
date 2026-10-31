import "server-only";
import {NextResponse} from "next/server";
import {HubD1UnavailableError} from "./hub-d1";
import {HubAuthenticationError,HubSuspendedError} from "./hub-session";
import {DesktopHubAuthenticationError} from "./desktop-hub-auth";
import {CommunityAppealReviewError} from "./community-appeal-review";
export const appealReviewHeaders={"cache-control":"private, no-store"};
export function appealReviewErrorResponse(error:unknown) {
  const status=error instanceof CommunityAppealReviewError?error.status:error instanceof HubSuspendedError?403
    :error instanceof HubAuthenticationError || error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:500;
  return NextResponse.json({error:error instanceof Error?error.message:"異議申立てを確認できませんでした。"},{status,headers:appealReviewHeaders});
}
