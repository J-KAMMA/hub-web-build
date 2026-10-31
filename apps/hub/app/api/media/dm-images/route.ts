import { NextResponse } from "next/server";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, getHubMedia } from "@/lib/server/hub-d1";
import { requireHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { HubAuthenticationError, HubSuspendedError } from "@/lib/server/hub-session";
import { createPendingDmImage } from "@/lib/server/direct-message-images";

/**
 * DM 添付画像の pending 登録（Web）。本文の検査は投稿画像と同じ
 * createPendingDmImage 1箇所——WebP・メタデータ除去済み・1日20枚まで。
 * Bearer（端末）の要求には Cookie 前提の同一オリジン確認を掛けない。
 */
export async function POST(request: Request) {
  if (!request.headers.get("authorization") && !hasSameOrigin(request)) {
    return NextResponse.json({ error: "許可されていない操作です。" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubViewerProfile(request, database);
    const form = await request.formData();
    const image = form.get("image"), thumbnail = form.get("thumbnail");
    if (!(image instanceof File) || !(thumbnail instanceof File)) return NextResponse.json({ error: "画像とサムネイルが必要です。" }, { status: 400 });
    const result = await createPendingDmImage({
      database, bucket: getHubMedia(), profileId: profile.id, bytes: new Uint8Array(await image.arrayBuffer()),
      thumbnailBytes: new Uint8Array(await thumbnail.arrayBuffer()), mimeType: image.type,
      width: Number(form.get("width")), height: Number(form.get("height")),
      thumbnailWidth: Number(form.get("thumbnailWidth")), thumbnailHeight: Number(form.get("thumbnailHeight")),
      altText: String(form.get("altText") ?? ""),
    });
    return NextResponse.json({ image: result }, { status: 201 });
  } catch (error) {
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403 });
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    if (error instanceof Error) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
}
