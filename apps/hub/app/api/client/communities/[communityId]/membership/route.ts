import {joinJson,joinFailure} from '@/lib/server/community-join-route';
import { NextResponse } from "next/server";

import { toggleCommunityMembershipRouteData } from "@/lib/server/community-route-data";
import { HubAuthenticationError, HubSuspendedError } from "@/lib/server/hub-session";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getHubD1 } from "@/lib/server/hub-d1";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { cancelD1CommunityMembershipRequest, getD1CommunityMembershipState } from "@/lib/server/d1-community-management";

/**
 * クライアント向けの参加・退出口。ブラウザ経路の同一オリジン確認の
 * 代わりに Bearer assertion で本人確認する（ローダー側で解決）。
 * { joined?: boolean } — 省略すると現在の状態を反転する。
 */
export async function POST(request:Request,{params}:{params:Promise<{communityId:string}>}){
  try{const {communityId}=await params;return joinJson(await toggleCommunityMembershipRouteData(request,communityId));}catch(error){return joinFailure(error);}
}

export async function DELETE(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(communityId)) return NextResponse.json({ error: "コミュニティの指定が正しくありません。" }, { status: 400 });
  try {
    const database = getHubD1();
    const actor = await requireDesktopHubProfile(request, database);
    const payload = await request.json() as { operationId?: unknown };
    const result = await cancelD1CommunityMembershipRequest(database, actor, communityId, typeof payload.operationId === "string" ? payload.operationId : "");
    const currentMembership = await getD1CommunityMembershipState(database, actor.id, communityId);
    return NextResponse.json({ ...result, currentMembership }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof DesktopHubAuthenticationError ? 401 : error instanceof HubSuspendedError ? 403 : error instanceof HubD1UnavailableError ? 503 : 400;
    return NextResponse.json({ error: error instanceof Error ? error.message : "参加申請を取り消せませんでした。" }, { status });
  }
}
