import { NextResponse } from "next/server";

import {
  createCommunityChannelRouteData,
  getCommunityChannelsRouteData,
} from "@/lib/server/community-route-data";
import { communityApiErrorResponse } from "@/lib/server/community-api-error";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  return NextResponse.json(
    await getCommunityChannelsRouteData(request, communityId),
  );
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  const { communityId } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
  };
  const name = body.name?.trim() ?? "";
  const description = body.description?.trim() ?? "";
  if (!name || name.length > 50)
    return NextResponse.json(
      { error: "チャンネル名は1〜50文字で入力してください。" },
      { status: 400 },
    );
  if (description.length > 200)
    return NextResponse.json(
      { error: "説明は200文字以内で入力してください。" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await createCommunityChannelRouteData(request, {
        communityId,
        name,
        description,
      }),
      { status: 201 },
    );
  } catch (error) {
    return communityApiErrorResponse(
      error,
      "チャンネルを作成できませんでした。",
    );
  }
}
