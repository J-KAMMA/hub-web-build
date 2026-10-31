import "server-only";
import {NextResponse} from "next/server";
import {HubD1UnavailableError} from "./hub-d1";
import {HubAuthenticationError,HubSuspendedError} from "./hub-session";
import {DesktopHubAuthenticationError} from "./desktop-hub-auth";
import {CommunityReportReviewError} from "./community-report-review";
export const reportReviewHeaders={"cache-control":"private, no-store"};
export function reportReviewErrorResponse(error:unknown) {
  const status=error instanceof CommunityReportReviewError?error.status:error instanceof HubSuspendedError?403
    :error instanceof HubAuthenticationError || error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:500;
  return NextResponse.json({error:error instanceof Error?error.message:"通報を確認できませんでした。"},{status,headers:reportReviewHeaders});
}
