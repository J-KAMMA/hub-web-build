import { NextResponse } from "next/server";

import {
  createCommunityChannelMessageRouteData,
  getCommunityChannelMessagesRouteData,
} from "@/lib/server/community-route-data";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

const messageKinds = new Set(["chat", "guide", "question", "party"] as const);

function privateNoStore(response: NextResponse) {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string; channelId: string }> },
) {
  const { communityId, channelId } = await params;
  try {
    return privateNoStore(
      NextResponse.json(
        await getCommunityChannelMessagesRouteData(request, communityId, channelId),
      ),
    );
  } catch (error) {
    return privateNoStore(
      communityApiErrorResponse(
        error,
        "チャンネルを取得できませんでした。",
        404,
      ),
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string; channelId: string }> },
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId, channelId } = await params;
  const payload = (await request.json().catch(() => ({}))) as {
    body?: string;
    reply_to_message_id?: string | null;
    kind?: "chat" | "guide" | "question" | "party";
    image_ids?: string[];
    client_request_id?: string;
  };
  if (payload.client_request_id !== undefined && (typeof payload.client_request_id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(payload.client_request_id))) {
    return NextResponse.json({ error: "投稿操作IDが正しくありません。" }, { status: 400 });
  }
  const body = payload.body?.trim() ?? "";
  if (!body || body.length > 2000)
    return NextResponse.json(
      { error: "メッセージは1〜2000文字で入力してください。" },
      { status: 400 },
    );
  if (payload.kind && !messageKinds.has(payload.kind))
    return NextResponse.json(
      { error: "投稿カテゴリが正しくありません。" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await createCommunityChannelMessageRouteData(request, {
        communityId,
        channelId,
        body,
        clientRequestId: payload.client_request_id,
        replyToMessageId: payload.reply_to_message_id ?? null,
        kind: payload.kind ?? "chat",
        imageIds: Array.isArray(payload.image_ids) ? payload.image_ids.filter((id): id is string => typeof id === "string").slice(0, 4) : [],
      }),
      { status: 201 },
    );
  } catch (error) {
    return communityApiErrorResponse(error, "投稿を送信できませんでした。");
  }
}
