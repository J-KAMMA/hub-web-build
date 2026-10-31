import { NextResponse } from "next/server";

import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { getD1CreatorRevenueSummary, setD1CreatorMonetizationParticipation } from "@/lib/server/d1-creator-revenue";

function authenticationError(error: unknown) {
  return error instanceof HubAuthenticationError
    ? NextResponse.json({ error: "ログインが必要です。" }, { status: 401 })
    : NextResponse.json({ error: "収益情報を処理できませんでした。" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json(await getD1CreatorRevenueSummary(database, viewer.id));
  } catch (error) {
    return authenticationError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const input = await request.json() as { participationEnabled?: unknown };
    if (typeof input.participationEnabled !== "boolean") {
      return NextResponse.json({ error: "参加設定が不正です。" }, { status: 400 });
    }
    await setD1CreatorMonetizationParticipation(database, viewer.id, input.participationEnabled);
    return NextResponse.json(await getD1CreatorRevenueSummary(database, viewer.id));
  } catch (error) {
    return authenticationError(error);
  }
}

