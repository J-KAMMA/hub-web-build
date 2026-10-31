import { NextResponse } from "next/server";

import { removeImageFromBoard, saveImageToBoard } from "@/lib/server/d1-image-boards";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { IMAGE_BOARD_HEADERS, imageBoardError, readJsonObject } from "@/lib/server/image-board-route";

type Context = { params: Promise<{ boardId: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    const { boardId } = await params;
    const body = await readJsonObject(request);
    const saved = await saveImageToBoard(database, viewer.id, boardId, body);
    return NextResponse.json(saved, { status: saved.alreadySaved ? 200 : 201, headers: IMAGE_BOARD_HEADERS });
  } catch (error) {
    return imageBoardError(error);
  }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    const { boardId } = await params;
    const itemId = new URL(request.url).searchParams.get("itemId") ?? "";
    if (!itemId || !(await removeImageFromBoard(database, viewer.id, boardId, itemId))) {
      return NextResponse.json({ error: "画像が見つかりません。" }, { status: 404, headers: IMAGE_BOARD_HEADERS });
    }
    return NextResponse.json({ removed: true }, { headers: IMAGE_BOARD_HEADERS });
  } catch (error) {
    return imageBoardError(error);
  }
}
