import { NextResponse } from "next/server";

import { MAX_AVATAR_DATA_URL_LENGTH, validateAvatarDataUrl } from "@/lib/avatar-image";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import {
  getHubMedia,
  getHubD1,
  HubD1UnavailableError,
  HubMediaUnavailableError,
} from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { profileAvatarObjectKeyFromDeliveryUrl, storeProfileAvatar } from "@/lib/server/profile-avatar-storage";

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_AVATAR_DATA_URL_LENGTH + 1_000) {
    return NextResponse.json({ error: "プロフィール画像が大きすぎます。" }, { status: 413 });
  }

  try {
    const body = (await request.json()) as { avatarUrl?: unknown };
    const avatarUrl = validateAvatarDataUrl(body.avatarUrl);
    const database = getHubD1();
    const bucket = getHubMedia();
    const viewer = await requireHubSessionProfile(request, database);
    const stored = await storeProfileAvatar(bucket, viewer.id, avatarUrl);
    try {
      await database.prepare("UPDATE profiles SET avatar_url = ?, updated_at = ? WHERE id = ?")
        .bind(stored.avatarUrl, new Date().toISOString(), viewer.id).run();
    } catch (error) {
      await bucket.delete(stored.objectKey);
      throw error;
    }
    const previousObjectKey = profileAvatarObjectKeyFromDeliveryUrl(viewer.avatarUrl);
    if (previousObjectKey && previousObjectKey !== stored.objectKey) await bucket.delete(previousObjectKey);
    return NextResponse.json({ profile: { ...viewer, avatarUrl: stored.avatarUrl } });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError || error instanceof HubMediaUnavailableError) {
      return NextResponse.json(
        { error: "プロフィール画像を更新できません。しばらくしてから再度お試しください。" },
        { status: 503 },
      );
    }
    const message = error instanceof Error ? error.message : "画像を読み込めませんでした。";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
