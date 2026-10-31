import "server-only";
import {NextResponse} from "next/server";
import {CommunityMemberManagementError} from "./d1-community-management";
import {HubD1UnavailableError} from "./hub-d1";
import {HubAuthenticationError,HubSuspendedError} from "./hub-session";
import {DesktopHubAuthenticationError} from "./desktop-hub-auth";

export const memberManagementHeaders={"cache-control":"private, no-store"};
export function memberManagementInput(payload:unknown) {
  if(!payload || typeof payload!=="object" || Array.isArray(payload))throw new CommunityMemberManagementError("管理操作が正しくありません。",400);
  const input=payload as Record<string,unknown>;
  if(typeof input.action!=="string" || !["promote","demote","mute","unmute","ban"].includes(input.action)
    || typeof input.operationId!=="string" || (input.note!==undefined && typeof input.note!=="string"))throw new CommunityMemberManagementError("管理操作が正しくありません。",400);
  return {action:input.action as "promote"|"demote"|"mute"|"unmute"|"ban",operationId:input.operationId,note:input.note as string|undefined};
}
export function memberManagementErrorResponse(error:unknown) {
  const status=error instanceof CommunityMemberManagementError?error.status:error instanceof HubSuspendedError?403
    :error instanceof HubAuthenticationError || error instanceof DesktopHubAuthenticationError?401:error instanceof HubD1UnavailableError?503:500;
  return NextResponse.json({error:error instanceof Error?error.message:"メンバーを更新できませんでした。",...(error instanceof CommunityMemberManagementError && error.code?{code:error.code}:{})},{status,headers:memberManagementHeaders});
}
