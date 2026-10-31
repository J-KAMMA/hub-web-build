import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { requireHubSessionProfile, HubAuthenticationError } from "@/lib/server/hub-session";
import { createPendingImage } from "@/lib/server/social-post-images";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "許可されていない操作です。" }, { status: 403 });
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    const expected = request.headers.get("X-Hub-Expected-Viewer");
    if (expected !== null && (!expected || expected !== profile.id)) {
      return NextResponse.json({ error: "image_scope_changed" }, { status: 409 });
    }
    const form = await request.formData();
    const image = form.get("image"), thumbnail = form.get("thumbnail");
    if (!(image instanceof File) || !(thumbnail instanceof File)) return NextResponse.json({ error: "画像とサムネイルが必要です。" }, { status: 400 });
    const result = await createPendingImage({
      database, bucket: getHubMedia(), profileId: profile.id, bytes: new Uint8Array(await image.arrayBuffer()),
      thumbnailBytes: new Uint8Array(await thumbnail.arrayBuffer()), mimeType: image.type,
      width: Number(form.get("width")), height: Number(form.get("height")),
      thumbnailWidth: Number(form.get("thumbnailWidth")), thumbnailHeight: Number(form.get("thumbnailHeight")),
      altText: String(form.get("altText") ?? ""),
    });
    return NextResponse.json({ image: result }, { status: 201 });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
