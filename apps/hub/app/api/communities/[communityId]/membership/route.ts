import {joinJson,joinFailure} from '@/lib/server/community-join-route';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import { NextResponse } from "next/server";

import { toggleCommunityMembershipRouteData } from "@/lib/server/community-route-data";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { cancelD1CommunityMembershipRequest, getD1CommunityMembershipState } from "@/lib/server/d1-community-management";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { requireHubSessionProfile } from "@/lib/server/hub-session";

export async function POST(request:Request,{params}:{params:Promise<{communityId:string}>}){
  if(!hasSameOrigin(request))return joinJson({error:'不正なリクエストです。'},403);
  try{const {communityId}=await params;return joinJson(await toggleCommunityMembershipRouteData(request,communityId));}catch(error){return joinFailure(error);}
}

export async function DELETE(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const originDenied = requireSameOrigin(request);
  if (originDenied) return originDenied;
  const { communityId } = await params;
  const payload = await request.json().catch(() => ({})) as { operationId?: unknown };
  try {
    const database = getHubD1();
    const actor = await requireHubSessionProfile(request, database);
    const result = await cancelD1CommunityMembershipRequest(
      database,
      actor,
      communityId,
      typeof payload.operationId === "string" ? payload.operationId : "",
    );
    const currentMembership = await getD1CommunityMembershipState(database, actor.id, communityId);
    return NextResponse.json({ ...result, currentMembership });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json({ error: "Community service is unavailable." }, { status: 503 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "参加申請を取り消せませんでした。" },
      { status: 400 },
    );
  }
}
