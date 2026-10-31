import { NextResponse } from "next/server";

import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { endRemoteFollowOnBlock, mirrorRemoteBlock } from "@/lib/server/federation-outbound";
import {
  listD1ProfileControls,
  setD1ProfileControl,
} from "@/lib/server/profile-public-details";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
};

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof DesktopHubAuthenticationError) {
    return NextResponse.json(
      { error: "desktop_authentication_failed" },
      { status: 401, headers: PRIVATE_HEADERS },
    );
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json(
      { error: "安全設定を操作できません。しばらくしてから再度お試しください。" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 400, headers: PRIVATE_HEADERS },
  );
}

/**
 * クライアント（デスクトップ・モバイル）専用のミュート/ブロック口。
 *
 * /api/profile/safety はセッションCookie＋同一オリジン前提なので、
 * assertion をBearerで持って来る端末のために同じ関数を別口で出す。
 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json(
      { controls: await listD1ProfileControls(database, viewer.id) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error, "安全設定を取得できませんでした。");
  }
}

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => null)) as {
    targetProfileId?: unknown;
    action?: unknown;
    enabled?: unknown;
  } | null;
  if (
    typeof body?.targetProfileId !== "string"
    || !body.targetProfileId.trim()
    || body.targetProfileId.length > 100
    || (body.action !== "mute" && body.action !== "block")
    || typeof body.enabled !== "boolean"
  ) {
    return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const control = await setD1ProfileControl(
      database,
      viewer.id,
      body.targetProfileId,
      body.action,
      body.enabled,
    );
    // 他のハブの人をブロックしたら、こちらからの Follow を取り消し、相手のハブへ Block を送る（解除なら Undo{Block}）。
    // ブロックはこのハブ内で成立済み。相手への配送が失敗しても、ブロックは取り消さない。
    if (body.action === "block") {
      if (body.enabled) await endRemoteFollowOnBlock(database, viewer.id, body.targetProfileId);
      await mirrorRemoteBlock(database, viewer.id, body.targetProfileId, body.enabled);
    }
    return NextResponse.json({ control }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error, "安全設定を更新できませんでした。");
  }
}
