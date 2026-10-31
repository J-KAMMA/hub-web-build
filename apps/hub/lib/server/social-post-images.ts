import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import { abandonHubStorage, commitHubStorageStatements, finishHubStorageCommit, reserveHubStorage } from "@/lib/server/hub-storage-usage";

export const MAX_POST_IMAGES = 4;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1600;
export const DAILY_IMAGE_LIMIT = 20;

export interface SocialPostImage { id: string; url: string; fullUrl: string; width: number; height: number; altText: string }
type ImageRow = { id: string; width: number; height: number; alt_text: string };

export function publicImageUrl(id: string, variant: "thumbnail" | "full" = "thumbnail"): string {
  return `/api/media/images/${encodeURIComponent(id)}?variant=${variant}`;
}
export function sniffImageMime(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
export function containsWebpMetadata(bytes: Uint8Array): boolean {
  if (sniffImageMime(bytes) !== "image/webp") return true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); let offset = 12;
  while (offset + 8 <= bytes.length) {
    const name = String.fromCharCode(...bytes.slice(offset, offset + 4)); const size = view.getUint32(offset + 4, true);
    if (["EXIF", "XMP ", "ICCP"].includes(name)) return true;
    offset += 8 + size + (size % 2);
  }
  return offset > bytes.length;
}
export async function hashImage(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}
export function readImageDimensions(bytes: Uint8Array, mimeType: "image/jpeg" | "image/png" | "image/webp"): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (mimeType === "image/png") return bytes.length < 24 ? null : { width: view.getUint32(16), height: view.getUint32(20) };
  if (mimeType === "image/jpeg") {
    let offset = 2; while (offset + 9 < bytes.length) { if (bytes[offset] !== 0xff) { offset++; continue; }
      const marker = bytes[offset + 1]; if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
      const length = view.getUint16(offset + 2); if (length < 2 || offset + 2 + length > bytes.length) return null;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
      offset += 2 + length;
    } return null;
  }
  if (bytes.length < 30) return null; const chunk = String.fromCharCode(...bytes.slice(12, 16));
  if (chunk === "VP8X") return { width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16), height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16) };
  if (chunk === "VP8L" && bytes[20] === 0x2f) return { width: 1 + bytes[21] + ((bytes[22] & 0x3f) << 8), height: 1 + (bytes[22] >> 6) + (bytes[23] << 2) + ((bytes[24] & 0x0f) << 10) };
  if (chunk === "VP8 ") return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff }; return null;
}

export async function createPendingImage(input: { database: D1Database; bucket: R2Bucket; profileId: string; bytes: Uint8Array; thumbnailBytes: Uint8Array; mimeType: string; width: number; height: number; thumbnailWidth: number; thumbnailHeight: number; altText: string }): Promise<SocialPostImage> {
  const { database, bucket, profileId, bytes, thumbnailBytes } = input;
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error("画像は2MB以下にしてください。");
  const dimensions = readImageDimensions(bytes, "image/webp");
  if (input.mimeType !== "image/webp" || sniffImageMime(bytes) !== "image/webp" || containsWebpMetadata(bytes) || !dimensions || dimensions.width !== input.width || dimensions.height !== input.height) throw new Error("位置情報を除去したWebP画像を確認できませんでした。");
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width > MAX_IMAGE_DIMENSION || input.height > MAX_IMAGE_DIMENSION) throw new Error("画像の縦横は1600px以下にしてください。");
  const thumbnailDimensions = readImageDimensions(thumbnailBytes, "image/webp");
  if (sniffImageMime(thumbnailBytes) !== "image/webp" || containsWebpMetadata(thumbnailBytes) || !thumbnailDimensions || thumbnailDimensions.width !== input.thumbnailWidth || thumbnailDimensions.height !== input.thumbnailHeight || input.thumbnailWidth > 480 || input.thumbnailHeight > 480 || thumbnailBytes.length > 512 * 1024) throw new Error("安全なサムネイルを確認できませんでした。");
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const count = await database.prepare("SELECT count(*) AS total FROM social_post_images WHERE owner_profile_id = ? AND created_at >= ?").bind(profileId, since).first<{ total: number }>();
  if (Number(count?.total ?? 0) >= DAILY_IMAGE_LIMIT) throw new Error("画像投稿は1日20枚までです。");
  const contentHash = await hashImage(bytes);
  const unsafe = await database.prepare("SELECT id FROM social_post_images WHERE owner_profile_id = ? AND content_hash = ? AND status <> 'deleted' AND (status = 'rejected' OR safety_status <> 'clean' OR metadata_stripped_at IS NULL) LIMIT 1").bind(profileId, contentHash).first<{ id: string }>();
  if (unsafe) throw new Error("この画像は安全性を確認できないため投稿できません。");
  const duplicate = await database.prepare("SELECT id, width, height, alt_text FROM social_post_images WHERE owner_profile_id = ? AND content_hash = ? AND status = 'pending' AND post_id IS NULL AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL LIMIT 1").bind(profileId, contentHash).first<ImageRow>();
  if (duplicate) return { id: duplicate.id, url: publicImageUrl(duplicate.id), fullUrl: publicImageUrl(duplicate.id, "full"), width: duplicate.width, height: duplicate.height, altText: duplicate.alt_text };
  const id = crypto.randomUUID(), objectKey = `social-post-images/${profileId}/${id}/full.webp`, thumbnailKey = `social-post-images/${profileId}/${id}/thumbnail.webp`, createdAt = new Date().toISOString(), altText = input.altText.trim().slice(0, 300);
  // Storage limit: reserve before any byte is written (fails closed if Account is unavailable). Only the full image counts; the thumbnail is a derivative.
  const reservation = await reserveHubStorage(database, { profileId, kind: "social_post_image", objectId: id, bytes: bytes.length });
  try {
    await bucket.put(objectKey, bytes, { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" }, customMetadata: { derivative: "full", metadataStripped: "true" } });
    await bucket.put(thumbnailKey, thumbnailBytes, { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" }, customMetadata: { derivative: "thumbnail", metadataStripped: "true" } });
    await database.batch([
      database.prepare(`INSERT INTO social_post_images (id,owner_profile_id,post_id,object_key,mime_type,byte_size,width,height,alt_text,status,content_hash,created_at,safety_status,thumbnail_object_key,thumbnail_byte_size,thumbnail_width,thumbnail_height,metadata_stripped_at) VALUES (?,?,NULL,?,?,?,?,?,?,'pending',?,?,'clean',?,?,?,?,?)`).bind(id, profileId, objectKey, "image/webp", bytes.length, input.width, input.height, altText, contentHash, createdAt, thumbnailKey, thumbnailBytes.length, input.thumbnailWidth, input.thumbnailHeight, createdAt),
      ...commitHubStorageStatements(database, reservation, bytes.length),
    ]);
  } catch (error) { await Promise.all([bucket.delete(objectKey).catch(() => undefined), bucket.delete(thumbnailKey).catch(() => undefined), abandonHubStorage(database, reservation)]); throw error; }
  await finishHubStorageCommit(database, reservation);
  return { id, url: publicImageUrl(id), fullUrl: publicImageUrl(id, "full"), width: input.width, height: input.height, altText };
}

export async function validatePendingImages(database: D1Database, profileId: string, ids: string[]): Promise<void> {
  if (ids.length > MAX_POST_IMAGES || new Set(ids).size !== ids.length) throw new Error("画像は1投稿4枚までです。"); if (!ids.length) return;
  const cutoff = new Date(Date.now() - 86_400_000).toISOString(), placeholders = ids.map(() => "?").join(",");
  const result = await database.prepare(`SELECT id FROM social_post_images WHERE id IN (${placeholders}) AND owner_profile_id = ? AND post_id IS NULL AND status = 'pending' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL AND created_at >= ?`).bind(...ids, profileId, cutoff).all<{ id: string }>();
  if (result.results.length !== ids.length) throw new Error("投稿できない画像が含まれています。");
}
export async function publishImages(database: D1Database, profileId: string, postId: string, ids: string[]): Promise<void> { if (!ids.length) return; const now = new Date().toISOString(); await database.batch(ids.map((id) => database.prepare("UPDATE social_post_images SET post_id = ?, status = 'published', published_at = ? WHERE id = ? AND owner_profile_id = ? AND post_id IS NULL AND status = 'pending' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL").bind(postId, now, id, profileId))); }

export async function updatePendingImageAltText(
  database: D1Database,
  profileId: string,
  imageId: string,
  altText: string,
): Promise<boolean> {
  const normalized = altText.trim().slice(0, 300);
  const result = await database.prepare(`UPDATE social_post_images
    SET alt_text = ?
    WHERE id = ? AND owner_profile_id = ?
      AND post_id IS NULL AND status = 'pending'`)
    .bind(normalized, imageId, profileId)
    .run();
  return Number(result.meta.changes ?? 0) > 0;
}

type PrunableImageRow = {
  id: string;
  object_key: string;
  thumbnail_object_key: string | null;
};

export async function pruneExpiredSocialPostImages(
  database: D1Database,
  bucket: R2Bucket,
  now = new Date(),
  limit = 100,
): Promise<{ candidates: number; deleted: number }> {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const pendingCutoff = new Date(now.getTime() - 86_400_000).toISOString();
  const rows = await database.prepare(`SELECT id, object_key, thumbnail_object_key
    FROM social_post_images
    WHERE status = 'deleted'
      OR (status = 'pending' AND post_id IS NULL AND created_at < ?)
    ORDER BY created_at
    LIMIT ${boundedLimit}`)
    .bind(pendingCutoff)
    .all<PrunableImageRow>();
  const candidates = rows.results ?? [];
  if (!candidates.length) return { candidates: 0, deleted: 0 };

  const objectKeys = [...new Set(candidates.flatMap((row) => [
    row.object_key,
    ...(row.thumbnail_object_key ? [row.thumbnail_object_key] : []),
  ]))];
  await bucket.delete(objectKeys);

  const results = await database.batch(candidates.map((row) =>
    database.prepare(`DELETE FROM social_post_images
      WHERE id = ? AND (
        status = 'deleted'
        OR (status = 'pending' AND post_id IS NULL AND created_at < ?)
      )`).bind(row.id, pendingCutoff)));
  return {
    candidates: candidates.length,
    deleted: results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0),
  };
}
export async function attachImagesToPosts(database: D1Database, posts: Array<{ id: string }>): Promise<void> {
  if (!posts.length) return;
  const byPost = new Map<string, SocialPostImage[]>();
  // 同じ投稿が二つの一覧に入って来ても、画像を二重に付けないよう ID を一度ずつ引く。
  const ids = [...new Set(posts.map((post) => post.id))];
  for (let offset = 0; offset < ids.length; offset += 80) {
    const chunk = ids.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await database.prepare(`SELECT id,post_id,width,height,alt_text FROM social_post_images WHERE post_id IN (${placeholders}) AND status='published' AND safety_status='clean' AND metadata_stripped_at IS NOT NULL ORDER BY created_at`).bind(...chunk).all<ImageRow & { post_id: string }>();
    for (const row of result.results) byPost.set(row.post_id, [...(byPost.get(row.post_id) ?? []), { id: row.id, url: publicImageUrl(row.id), fullUrl: publicImageUrl(row.id, "full"), width: row.width, height: row.height, altText: row.alt_text }]);
  }
  for (const post of posts) Object.assign(post, { images: byPost.get(post.id) ?? [] });
}
