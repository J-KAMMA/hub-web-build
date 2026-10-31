import { NextResponse } from "next/server";

import { MAX_AVATAR_BYTES } from "@/lib/avatar-image";
import { getHubMedia } from "@/lib/server/hub-d1";
import { readProfileAvatar } from "@/lib/server/profile-avatar-storage";
import { r2ResponseStream } from "@/lib/server/r2-response-stream";

export async function GET(_request: Request, { params }: { params: Promise<{ profileId: string; version: string }> }) {
  try {
    const { profileId, version } = await params;
    const object = await readProfileAvatar(getHubMedia(), profileId, version);
    if (!object) return NextResponse.json({ error: "プロフィール画像が見つかりません。" }, { status: 404 });
    if (object.size > MAX_AVATAR_BYTES) return NextResponse.json({ error: "プロフィール画像を取得できません。" }, { status: 500 });
    const headers = new Headers();
    headers.set("content-type", object.httpMetadata?.contentType ?? "application/octet-stream");
    headers.set("cache-control", "public, max-age=31536000, immutable");
    headers.set("content-security-policy", "default-src 'none'; sandbox");
    headers.set("x-content-type-options", "nosniff");
    if (object.httpEtag) headers.set("etag", object.httpEtag);
    return new Response(r2ResponseStream(object.body), { headers });
  } catch {
    return NextResponse.json({ error: "プロフィール画像を取得できません。" }, { status: 400 });
  }
}
