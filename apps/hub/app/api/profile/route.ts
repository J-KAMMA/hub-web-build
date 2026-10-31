import { NextResponse } from "next/server";

import { parsePseudonymousProfileUpdate } from "@/lib/profile-privacy";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { updateD1CurrentProfileRouteData } from "@/lib/server/profile-route-data";

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const profile = parsePseudonymousProfileUpdate(await request.json());
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json(await updateD1CurrentProfileRouteData(database, viewer.id, profile));
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "プロフィールを更新できません。しばらくしてから再度お試しください。" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unexpected error." },
      { status: 400 }
    );
  }
}
