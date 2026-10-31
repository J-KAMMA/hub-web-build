import { NextResponse } from "next/server";

import { deleteCommunityChannelMessageRouteData, setCommunityChannelMessagePinnedRouteData, setCommunityChannelMessageWorkflowRouteData, updateCommunityChannelMessageRouteData } from "@/lib/server/community-route-data";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

type Context = { params: Promise<{ communityId: string; channelId: string; messageId: string }> };
const workflowStatuses = new Set(["open", "resolved", "closed"] as const);

export async function PATCH(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, channelId, messageId } = await params;
  const payload = (await request.json().catch(() => ({}))) as { body?: string; pinned?: boolean; workflow_status?: "open" | "resolved" | "closed" };
  const body = payload.body?.trim();
  if (payload.workflow_status !== undefined && !workflowStatuses.has(payload.workflow_status)) return NextResponse.json({ error: "投稿状態が正しくありません。" }, { status: 400 });
  if (body !== undefined && (!body || body.length > 2000)) return NextResponse.json({ error: "メッセージは1〜2000文字で入力してください。" }, { status: 400 });
  if (body === undefined && typeof payload.pinned !== "boolean" && payload.workflow_status === undefined) return NextResponse.json({ error: "変更内容がありません。" }, { status: 400 });
  try {
    if (typeof payload.pinned === "boolean") return NextResponse.json(await setCommunityChannelMessagePinnedRouteData(request, { communityId, channelId, messageId, pinned: payload.pinned }));
    if (payload.workflow_status !== undefined) return NextResponse.json(await setCommunityChannelMessageWorkflowRouteData(request, { communityId, channelId, messageId, workflowStatus: payload.workflow_status }));
    return NextResponse.json(await updateCommunityChannelMessageRouteData(request, { communityId, channelId, messageId, body: body! }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "メッセージを編集できませんでした。" }, { status: 400 });
  }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, channelId, messageId } = await params;
  try {
    return NextResponse.json(await deleteCommunityChannelMessageRouteData(request, { communityId, channelId, messageId }));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "メッセージを削除できませんでした。" }, { status: 400 });
  }
}
