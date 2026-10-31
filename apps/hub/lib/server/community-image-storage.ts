import "server-only";

import type { D1Database, R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";

import { decodeAvatarDataUrl } from "@/lib/avatar-image";
import { abandonHubStorage, commitHubStorageStatements, reserveHubStorage } from "@/lib/server/hub-storage-usage";

const COMMUNITY_IMAGE_PREFIX = "community-images/";
const COMMUNITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/u;
const VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function communityImageObjectKey(communityId: string, version: string): string {
  if (!COMMUNITY_ID_PATTERN.test(communityId) || !VERSION_PATTERN.test(version)) {
    throw new Error("コミュニティ画像の参照が正しくありません。");
  }
  return `${COMMUNITY_IMAGE_PREFIX}${communityId}/${version}`;
}

export function communityImageDeliveryUrl(communityId: string, version: string): string {
  communityImageObjectKey(communityId, version);
  return `/api/communities/${encodeURIComponent(communityId)}/image/${encodeURIComponent(version)}`;
}

/**
 * `accounting` counts the image against the uploader's storage limit (PLAN 1.2). Without it the
 * image is stored uncounted, which only callers with no profile to charge may do.
 */
export async function storeCommunityImage(
  bucket: R2Bucket,
  communityId: string,
  dataUrl: unknown,
  accounting?: { database: D1Database; profileId: string },
) {
  const version = crypto.randomUUID();
  const objectKey = communityImageObjectKey(communityId, version);
  const { bytes, contentType } = decodeAvatarDataUrl(dataUrl);
  const reservation = accounting
    ? await reserveHubStorage(accounting.database, { profileId: accounting.profileId, kind: "community_image", objectId: version, bytes: bytes.length })
    : null;
  try {
    await bucket.put(objectKey, bytes, {
      httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: { purpose: "community-image" },
    });
    if (accounting && reservation) await accounting.database.batch(commitHubStorageStatements(accounting.database, reservation, bytes.length));
  } catch (error) {
    await bucket.delete(objectKey).catch(() => undefined);
    if (accounting && reservation) await abandonHubStorage(accounting.database, reservation);
    throw error;
  }
  return { objectKey, version, imageUrl: communityImageDeliveryUrl(communityId, version) };
}

export async function readCommunityImage(
  bucket: R2Bucket,
  communityId: string,
  version: string,
): Promise<R2ObjectBody | null> {
  return bucket.get(communityImageObjectKey(communityId, version));
}

export function communityImageObjectKeyFromDeliveryUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\/api\/communities\/([^/]+)\/image\/([^/?#]+)$/u.exec(value);
  if (!match) return null;
  try {
    return communityImageObjectKey(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
  } catch {
    return null;
  }
}

/** The version id inside a delivery URL (the storage ledger's object id), or null. */
export function communityImageVersionFromDeliveryUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^\/api\/communities\/([^/]+)\/image\/([^/?#]+)$/u.exec(value);
  if (!match) return null;
  try {
    const version = decodeURIComponent(match[2]);
    return VERSION_PATTERN.test(version) ? version : null;
  } catch {
    return null;
  }
}
