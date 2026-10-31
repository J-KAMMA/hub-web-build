import { clampListOffset } from "@/lib/server/list-pagination";
import { NextResponse } from "next/server";
import { InvalidDistributedVideoManifestError, normalizePublicVideoUrl, parseDistributedVideoManifest } from "@/lib/distributed-video-manifest";
import { listDistributedVideos, saveDistributedVideo } from "@/lib/server/distributed-videos";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { publicApiCacheHeaders } from "@/lib/server/public-api-cache";
import { isRedirectResponse } from "@/lib/redirect-guard";

const MAX_MANIFEST_BYTES = 128 * 1024;

async function fetchManifest(manifestUrl: string) {
  const response = await fetch(manifestUrl, {
    headers: { accept: "application/ld+json, application/json" },
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok || isRedirectResponse(response)) throw new InvalidDistributedVideoManifestError("配信元のマニフェストを取得できませんでした。");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_MANIFEST_BYTES) throw new InvalidDistributedVideoManifestError("マニフェストが大きすぎます。");
  const body = await response.text();
  if (new TextEncoder().encode(body).byteLength > MAX_MANIFEST_BYTES) throw new InvalidDistributedVideoManifestError("マニフェストが大きすぎます。");
  try { return parseDistributedVideoManifest(JSON.parse(body)); }
  catch (error) { if (error instanceof InvalidDistributedVideoManifestError) throw error; throw new InvalidDistributedVideoManifestError("マニフェストを解析できませんでした。"); }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30));
  const offset = clampListOffset(Number(url.searchParams.get("offset") ?? 0) || 0);
  const videos = await listDistributedVideos(getHubD1(), limit, offset);
  return NextResponse.json({ videos, limit, offset }, { headers: publicApiCacheHeaders(request, "videos.distributed") });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  try {
    const body = await request.json().catch(() => null) as { manifestUrl?: unknown } | null;
    const manifestUrl = normalizePublicVideoUrl(body?.manifestUrl, "manifestUrl");
    const db = getHubD1();
    const viewer = await requireHubSessionProfile(request, db);
    const manifest = await fetchManifest(manifestUrl);
    const video = await saveDistributedVideo(db, viewer, manifestUrl, manifest);
    return NextResponse.json({ video, message: "分散動画ノードを登録しました。" }, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof InvalidDistributedVideoManifestError) return NextResponse.json({ error: error.message }, { status: 400 });
    if (error instanceof Error && /unique/i.test(error.message)) return NextResponse.json({ error: "この動画またはマニフェストは登録済みです。" }, { status: 409 });
    console.error(JSON.stringify({ event: "distributed_video_register_failed", status: "internal_error" }));
    return NextResponse.json({ error: "分散動画を登録できませんでした。" }, { status: 500 });
  }
}
