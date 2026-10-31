import { NextResponse } from "next/server";

import {
  deleteCommunityChannelMessageRouteData,
  setCommunityChannelMessagePinnedRouteData,
  setCommunityChannelMessageWorkflowRouteData,
  updateCommunityChannelMessageRouteData,
} from "@/lib/server/community-route-data";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";
import { isCommunityMessageId } from "@/lib/server/community-message-request";

type Context = {
  params: Promise<{ communityId: string; channelId: string; messageId: string }>;
};

const idPattern = /^[A-Za-z0-9_-]{1,80}$/;
const workflowStatuses = new Set(["open", "resolved", "closed"] as const);

function privateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

/**
 * クライアント向けのチャンネルメッセージ操作口。
 * ブラウザ側は /api/communities/... が同一オリジン前提なので、assertion を
 * Bearer で持って来る端末はここへ。編集は自分の投稿のみ、ピン留めと
 * 状態変更はモデレーター——権限の判定は呼ぶ関数に集約されている。
 */
export async function PATCH(request: Request, { params }: Context) {
  const { communityId, channelId, messageId } = await params;
  if (!idPattern.test(communityId) || !idPattern.test(channelId) || !isCommunityMessageId(messageId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  const payload = (await request.json().catch(() => ({}))) as {
    body?: string;
    pinned?: boolean;
    workflow_status?: "open" | "resolved" | "closed";
  };
  const body = payload.body?.trim();
  if (
    payload.workflow_status !== undefined &&
    !workflowStatuses.has(payload.workflow_status)
  ) {
    return NextResponse.json({ error: "投稿状態が正しくありません。" }, { status: 400 });
  }
  if (body !== undefined && (!body || body.length > 2000)) {
    return NextResponse.json(
      { error: "メッセージは1〜2000文字で入力してください。" },
      { status: 400 },
    );
  }
  if (
    body === undefined &&
    typeof payload.pinned !== "boolean" &&
    payload.workflow_status === undefined
  ) {
    return NextResponse.json({ error: "変更内容がありません。" }, { status: 400 });
  }
  try {
    if (typeof payload.pinned === "boolean") {
      return privateNoStore(NextResponse.json(
        await setCommunityChannelMessagePinnedRouteData(request, {
          communityId, channelId, messageId, pinned: payload.pinned,
        }),
      ));
    }
    if (payload.workflow_status !== undefined) {
      return privateNoStore(NextResponse.json(
        await setCommunityChannelMessageWorkflowRouteData(request, {
          communityId, channelId, messageId, workflowStatus: payload.workflow_status,
        }),
      ));
    }
    return privateNoStore(NextResponse.json(
      await updateCommunityChannelMessageRouteData(request, {
        communityId, channelId, messageId, body: body!,
      }),
    ));
  } catch (error) {
    return privateNoStore(
      communityApiErrorResponse(error, "メッセージを編集できませんでした。", 400),
    );
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const { communityId, channelId, messageId } = await params;
  if (!idPattern.test(communityId) || !idPattern.test(channelId) || !isCommunityMessageId(messageId)) {
    return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400 });
  }
  try {
    return privateNoStore(NextResponse.json(
      await deleteCommunityChannelMessageRouteData(request, {
        communityId, channelId, messageId,
      }),
    ));
  } catch (error) {
    return privateNoStore(
      communityApiErrorResponse(error, "メッセージを削除できませんでした。", 400),
    );
  }
}
