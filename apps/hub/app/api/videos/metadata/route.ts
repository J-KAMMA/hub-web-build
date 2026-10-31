import { NextResponse } from "next/server";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { lookupExternalVideoMetadata } from "@/lib/server/video-metadata";
import { InvalidVideoSourceError, normalizeVideoSource } from "@/lib/video-source";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }
  try {
    const database = getHubD1();
    await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null);
    const sourceUrl = body && typeof body === "object" ? Reflect.get(body, "sourceUrl") : undefined;
    const source = normalizeVideoSource(typeof sourceUrl === "string" ? sourceUrl : "");
    const metadata = await lookupExternalVideoMetadata(source.sourceUrl);
    return NextResponse.json({ metadata });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof InvalidVideoSourceError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }
}
