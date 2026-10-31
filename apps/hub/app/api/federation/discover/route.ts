import { NextResponse } from "next/server";
import { ActivityPubDiscoveryError, discoverActivityPub } from "@/lib/server/activitypub-discovery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!query || query.length > 500) return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  try {
    const result = await discoverActivityPub(query);
    return NextResponse.json(result, { headers: { "Cache-Control": "public, max-age=60, stale-while-revalidate=300" } });
  } catch (error) {
    const code = error instanceof ActivityPubDiscoveryError ? error.code : "unavailable";
    const status = code === "invalid_query" || code === "unsafe_url" ? 400 : code === "not_found" ? 404 : 502;
    return NextResponse.json({ error: code }, { status, headers: { "Cache-Control": "no-store" } });
  }
}
