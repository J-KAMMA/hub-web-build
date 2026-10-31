import "server-only";

import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";

import { decodeAvatarDataUrl } from "@/lib/avatar-image";

const AVATAR_PREFIX = "profile-avatars/";
const PROFILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function avatarObjectKey(profileId: string, version: string): string {
  if (!PROFILE_ID_PATTERN.test(profileId) || !VERSION_PATTERN.test(version)) throw new Error("プロフィール画像の参照が正しくありません。");
  return `${AVATAR_PREFIX}${profileId}/${version}`;
}

export function profileAvatarDeliveryUrl(profileId: string, version: string): string {
  avatarObjectKey(profileId, version);
  return `/api/profile/avatar/image/${encodeURIComponent(profileId)}/${encodeURIComponent(version)}`;
}

export async function storeProfileAvatar(bucket: R2Bucket, profileId: string, dataUrl: unknown) {
  const version = crypto.randomUUID();
  const objectKey = avatarObjectKey(profileId, version);
  const { bytes, contentType } = decodeAvatarDataUrl(dataUrl);
  await bucket.put(objectKey, bytes, {
    httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { purpose: "profile-avatar" },
  });
  return { objectKey, avatarUrl: profileAvatarDeliveryUrl(profileId, version) };
}

export async function readProfileAvatar(bucket: R2Bucket, profileId: string, version: string): Promise<R2ObjectBody | null> {
  return bucket.get(avatarObjectKey(profileId, version));
}

export function profileAvatarObjectKeyFromDeliveryUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\/api\/profile\/avatar\/image\/([^/]+)\/([^/?#]+)$/u.exec(value);
  if (!match) return null;
  try { return avatarObjectKey(decodeURIComponent(match[1]), decodeURIComponent(match[2])); }
  catch { return null; }
}
