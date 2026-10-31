import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { readHubStorageStatus } from "@/lib/server/hub-storage-status";

export const dynamic = "force-dynamic";

const headers = { "cache-control": "no-store" };
const unavailable = () => NextResponse.json({ error: "unavailable" }, { status: 503, headers });

export async function GET(request: Request) {
  const db = getOptionalHubD1();
  if (!db) return unavailable();
  try {
    const profile = await requireHubSessionProfile(request, db);
    const body = await readHubStorageStatus(db, profile.id, { userStopped: new URL(request.url).searchParams.get("userStopped") === "1" });
    return body ? NextResponse.json(body, { headers }) : unavailable();
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers });
    return unavailable();
  }
}
