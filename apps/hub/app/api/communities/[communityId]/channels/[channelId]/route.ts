import { NextResponse } from "next/server";

import {
  deleteCommunityChannelRouteData,
  updateCommunityChannelRouteData,
} from "@/lib/server/community-route-data";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";

type Context = { params: Promise<{ communityId: string; channelId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const originDenied = requireSameOrigin(request);
  if (originDenied) return originDenied;
  const { communityId, channelId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    direction?: "up" | "down";
  };
  if (body.direction && body.direction !== "up" && body.direction !== "down")
    return NextResponse.json(
      { error: "移動方向が正しくありません。" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await updateCommunityChannelRouteData(request, {
        communityId,
        channelId,
        name: body.name,
        description: body.description,
        direction: body.direction,
      }),
    );
  } catch (error) {
    return communityApiErrorResponse(
      error,
      "チャンネルを更新できませんでした。",
    );
  }
}

export async function DELETE(request: Request, { params }: Context) {
  const originDenied = requireSameOrigin(request);
  if (originDenied) return originDenied;
  const { communityId, channelId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    operationId?: string;
    note?: string;
  };
  if (
    typeof body.operationId !== "string" ||
    !/^[A-Za-z0-9-]{16,80}$/.test(body.operationId)
  )
    return NextResponse.json(
      { error: "操作IDが正しくありません。" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await deleteCommunityChannelRouteData(request, {
        communityId,
        channelId,
        operationId: body.operationId,
        note:
          typeof body.note === "string"
            ? body.note.normalize("NFKC").trim().slice(0, 500)
            : "",
      }),
    );
  } catch (error) {
    return communityApiErrorResponse(
      error,
      "チャンネルを削除できませんでした。",
    );
  }
}
