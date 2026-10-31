import { NextResponse } from "next/server";

import { endRemoteFollowOnBlock, mirrorRemoteBlock } from "@/lib/server/federation-outbound";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import {
  listD1ProfileControls,
  reportD1Profile,
  setD1ProfileControl,
} from "@/lib/server/profile-public-details";

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
};

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json(
      { error: "安全設定を操作できません。しばらくしてから再度お試しください。" },
      { status: 503, headers: PRIVATE_HEADERS },
    );
  }
  if (error instanceof Error && error.message.includes("report_rate_limit")) {
    return NextResponse.json(
      { error: "通報回数の上限に達しました。1時間後にもう一度お試しください。" },
      { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": "3600" } },
    );
  }
  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallback },
    { status: 400, headers: PRIVATE_HEADERS },
  );
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json(
      { controls: await listD1ProfileControls(database, viewer.id) },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return errorResponse(error, "安全設定を取得できませんでした。");
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      targetProfileId?: unknown;
      action?: unknown;
      enabled?: unknown;
    };
    if (
      typeof body.targetProfileId !== "string"
      || !body.targetProfileId.trim()
      || body.targetProfileId.length > 100
      || (body.action !== "mute" && body.action !== "block")
      || typeof body.enabled !== "boolean"
    ) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400 });
    }

    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
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

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  try {
    const body = await request.json() as {
      targetProfileId?: unknown;
      reason?: unknown;
      details?: unknown;
    };
    const details = typeof body.details === "string" ? body.details.trim() : "";
    if (
      typeof body.targetProfileId !== "string"
      || !body.targetProfileId.trim()
      || body.targetProfileId.length > 100
      || typeof body.reason !== "string"
      || details.length > 500
    ) {
      return NextResponse.json({ error: "通報内容を確認してください。" }, { status: 400 });
    }

    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    await reportD1Profile(database, viewer.id, body.targetProfileId, body.reason, details);
    return NextResponse.json({ reported: true }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return errorResponse(error, "通報できませんでした。");
  }
}
