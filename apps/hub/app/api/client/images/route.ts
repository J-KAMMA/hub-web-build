import { NextResponse } from "next/server";

import { getHubD1, getHubMedia, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { createPendingImage } from "@/lib/server/social-post-images";
const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const json = (value: unknown, status: number) => NextResponse.json(value, { status, headers });

/**
 * クライアント（デスクトップ・モバイル）専用の投稿画像アップロード口。
 *
 * /api/media/images はブラウザのセッションCookie＋同一オリジン前提。
 * 端末は assertion をBearerで持って来るので別口にする。中身の検査は
 * createPendingImage 1箇所に集まっている——WebPであること、メタデータが
 * 除去されていること、1日20枚まで、はすべてそこで弾かれる。
 */
export async function POST(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    // A scope precondition, not authentication; older headerless clients remain compatible.
    const expected = request.headers.get("X-Hub-Expected-Viewer");
    if (expected !== null && (expected.length < 1 || expected.length > 128 || /[^A-Za-z0-9_-]/u.test(expected))) return json({ error: "bad_request" }, 400);
    if (expected !== null && expected !== profile.id) return json({ error: "image_scope_changed" }, 409);
    const form = await request.formData();
    const image = form.get("image");
    const thumbnail = form.get("thumbnail");
    if (!(image instanceof File) || !(thumbnail instanceof File)) {
      return json({ error: "画像とサムネイルが必要です。" }, 400);
    }
    const result = await createPendingImage({
      database,
      bucket: getHubMedia(),
      profileId: profile.id,
      bytes: new Uint8Array(await image.arrayBuffer()),
      thumbnailBytes: new Uint8Array(await thumbnail.arrayBuffer()),
      mimeType: image.type,
      width: Number(form.get("width")),
      height: Number(form.get("height")),
      thumbnailWidth: Number(form.get("thumbnailWidth")),
      thumbnailHeight: Number(form.get("thumbnailHeight")),
      altText: String(form.get("altText") ?? ""),
    });
    return json({ image: result }, 201);
  } catch (error) {
    if (error instanceof DesktopHubAuthenticationError) {
      return json({ error: "desktop_authentication_failed" }, 401);
    }
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof Error) {
      return json({ error: error.message }, 400);
    }
    return json({ error: "unavailable" }, 503);
  }
}
