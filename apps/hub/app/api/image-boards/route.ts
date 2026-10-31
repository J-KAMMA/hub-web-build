import { NextResponse } from "next/server";

import { createImageBoard, listImageBoards } from "@/lib/server/d1-image-boards";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { IMAGE_BOARD_HEADERS, imageBoardError, readJsonObject } from "@/lib/server/image-board-route";

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    return NextResponse.json({ boards: await listImageBoards(database, viewer.id) }, { headers: IMAGE_BOARD_HEADERS });
  } catch (error) {
    return imageBoardError(error);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const database = getHubD1();
    const viewer = await requireHubViewerProfile(request, database);
    const body = await readJsonObject(request);
    return NextResponse.json({ board: await createImageBoard(database, viewer.id, body) }, { status: 201, headers: IMAGE_BOARD_HEADERS });
  } catch (error) {
    return imageBoardError(error);
  }
}
