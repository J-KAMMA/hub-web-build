import { NextResponse } from "next/server";

import { deleteImageBoard, getReadableImageBoard, listImageBoardItems, updateImageBoard } from "@/lib/server/d1-image-boards";
import { getOptionalHubViewerProfile, requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { IMAGE_BOARD_HEADERS, imageBoardError, readJsonObject } from "@/lib/server/image-board-route";

type Context = { params: Promise<{ boardId: string }> };

/* A public board is readable by anyone; a private one only by its owner (and looks absent to everyone else). */
export async function GET(request: Request, { params }: Context) {
  try {
    const database = getHubD1();
    const viewer = await getOptionalHubViewerProfile(request, database);
    const { boardId } = await params;
    const board = await getReadableImageBoard(database, boardId, viewer?.id ?? null);
    if (!board) return NextResponse.json({ error: "ボードが見つかりません。" }, { status: 404, headers: IMAGE_BOARD_HEADERS });
    const cursor = new URL(request.url).searchParams.get("cursor");
    const page = await listImageBoardItems(database, boardId, viewer?.id ?? null, cursor);
    if (!page) return NextResponse.json({ error: "続きを取得できませんでした。" }, { status: 400, headers: IMAGE_BOARD_HEADERS });
    return NextResponse.json({ board, ...page }, { headers: IMAGE_BOARD_HEADERS });
  } catch (error) {
    return imageBoardError(error);
  }
}

export async function PATCH(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    const { boardId } = await params;
    const body = await readJsonObject(request);
    if (!(await updateImageBoard(database, viewer.id, boardId, body))) {
      return NextResponse.json({ error: "ボードが見つかりません。" }, { status: 404, headers: IMAGE_BOARD_HEADERS });
    }
    return NextResponse.json({ updated: true }, { headers: IMAGE_BOARD_HEADERS });
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
    if (!(await deleteImageBoard(database, viewer.id, boardId))) {
      return NextResponse.json({ error: "ボードが見つかりません。" }, { status: 404, headers: IMAGE_BOARD_HEADERS });
    }
    return NextResponse.json({ deleted: true }, { headers: IMAGE_BOARD_HEADERS });
  } catch (error) {
    return imageBoardError(error);
  }
}
