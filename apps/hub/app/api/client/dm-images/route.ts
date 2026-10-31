import { NextResponse } from "next/server";

import { getHubD1, getHubMedia, HubD1UnavailableError } from "@/lib/server/hub-d1";
import {
  DesktopHubAuthenticationError,
  requireDesktopHubProfile,
} from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { createPendingDmImage } from "@/lib/server/direct-message-images";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";

const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "cache-control": "private, no-store", vary: "Authorization" },
});
// Only these helper validation messages are safe to expose; storage errors are not.
const IMAGE_VALIDATION_ERRORS = new Set([
  "画像は2MB以下にしてください。", "位置情報を除去したWebP画像を確認できませんでした。",
  "画像の縦横は1600px以下にしてください。", "安全なサムネイルを確認できませんでした。",
  "画像投稿は1日20枚までです。", "この画像は安全性を確認できないため投稿できません。",
]);

/**
 * クライアント（デスクトップ・モバイル）専用の DM 画像アップロード口。
 * /api/client/images と同じ経路だが、pending 画像は DM 専用の表へ——
 * 投稿用 pending を DM へ流用できないように分ける。
 */
export async function POST(request: Request) {
  try {
    const database = getHubD1();
    const profile = await requireDesktopHubProfile(request, database);
    const expected = request.headers.get("x-hub-expected-viewer");
    if (expected !== null) {
      if (!expected.length || expected.length > 128 || /[^\x21-\x7e]/.test(expected)) return json({ error: "invalid_request" }, 400);
      if (!hasSameOrigin(request)) return json({ error: "invalid_request_origin" }, 403);
      if (expected !== profile.id) return json({ error: "dm_scope_changed" }, 409);
    }
    const form = await request.formData();
    const image = form.get("image");
    const thumbnail = form.get("thumbnail");
    if (!(image instanceof File) || !(thumbnail instanceof File)) {
      return json({ error: "画像とサムネイルが必要です。" }, 400);
    }
    const result = await createPendingDmImage({
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
    if (error instanceof HubSuspendedError) {
      return json({ error: "suspended" }, 403);
    }
    if (error instanceof HubD1UnavailableError) return json({ error: "unavailable" }, 503);
    if (error instanceof Error && IMAGE_VALIDATION_ERRORS.has(error.message)) return json({ error: error.message }, 400);
    return json({ error: "dm_image_unavailable" }, 503);
  }
}
