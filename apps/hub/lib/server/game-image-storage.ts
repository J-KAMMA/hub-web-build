import "server-only";

import type { R2Bucket, R2ObjectBody } from "@cloudflare/workers-types";
import { decodeAvatarDataUrl } from "@/lib/avatar-image";

const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const UUID = /^[0-9a-f-]{36}$/iu;
function key(gameId: string, version: string) {
  if (!ID.test(gameId) || !UUID.test(version)) throw new Error("Invalid game image reference.");
  return `game-guide-images/${gameId}/${version}`;
}
export async function storeGameImage(bucket: R2Bucket, gameId: string, dataUrl: unknown) {
  const version = crypto.randomUUID();
  const { bytes, contentType } = decodeAvatarDataUrl(dataUrl);
  await bucket.put(key(gameId, version), bytes, { httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" }, customMetadata: { purpose: "game-guide-image" } });
  return { imageUrl: gameImageUrl(gameId, version), version };
}
export function gameImageUrl(gameId: string, version: string) {
  return `/api/games/${encodeURIComponent(gameId)}/image/${version}`;
}
export async function deleteGameImage(bucket: R2Bucket, gameId: string, version: string) {
  await bucket.delete(key(gameId, version));
}
export function readGameImage(bucket: R2Bucket, gameId: string, version: string): Promise<R2ObjectBody | null> {
  return bucket.get(key(gameId, version));
}
