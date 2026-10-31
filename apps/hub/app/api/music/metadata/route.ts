import { NextResponse } from "next/server";

import { InvalidMusicSourceError, normalizeMusicSource } from "@/lib/music-source";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { lookupExternalMusicMetadata } from "@/lib/server/music-metadata";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    await requireHubSessionProfile(request, getHubD1());
    const body = await request.json().catch(() => null);
    const rawSourceUrl = body && typeof body === "object" ? Reflect.get(body, "sourceUrl") : undefined;
    normalizeMusicSource(typeof rawSourceUrl === "string" ? rawSourceUrl : "");
    const metadata = await lookupExternalMusicMetadata(rawSourceUrl);
    return NextResponse.json({ metadata });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof InvalidMusicSourceError) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
