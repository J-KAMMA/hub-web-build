import type { D1Database, R2Bucket } from "@cloudflare/workers-types";

import {
  containsWebpMetadata,
  hashImage,
  readImageDimensions,
  sniffImageMime,
} from "@/lib/server/social-post-images";
import { abandonHubStorage, commitHubStorageStatements, finishHubStorageCommit, reserveHubStorage } from "@/lib/server/hub-storage-usage";

/*
 * DM の画像添付。social-post-images.ts と同じ手順（pending→validate→publish→attach）を
 * direct_message_images 表で行う。画像本体は投稿画像と同じ HUB_MEDIA バケットに
 * `dm-images/` 接頭辞で置く。配信は /api/media/dm-images/{id} で、
 * 会話の参加者にしか返さない（投稿画像の公開判定と違い、DM に公開面は無い）。
 */

export const MAX_DM_IMAGES = 4;
export const MAX_DM_IMAGE_BYTES = 2 * 1024 * 1024;
export const MAX_DM_IMAGE_DIMENSION = 1600;
export const DAILY_DM_IMAGE_LIMIT = 20;

export interface DirectMessageImage { id: string; url: string; fullUrl: string; width: number; height: number; altText: string }
type ImageRow = { id: string; width: number; height: number; alt_text: string };

export function dmImageUrl(id: string, variant: "thumbnail" | "full" = "thumbnail"): string {
  return `/api/media/dm-images/${encodeURIComponent(id)}?variant=${variant}`;
}

export async function createPendingDmImage(input: { database: D1Database; bucket: R2Bucket; profileId: string; bytes: Uint8Array; thumbnailBytes: Uint8Array; mimeType: string; width: number; height: number; thumbnailWidth: number; thumbnailHeight: number; altText: string }): Promise<DirectMessageImage> {
  const { database, bucket, profileId, bytes, thumbnailBytes } = input;
  if (!bytes.length || bytes.length > MAX_DM_IMAGE_BYTES) throw new Error("画像は2MB以下にしてください。");
  const dimensions = readImageDimensions(bytes, "image/webp");
  if (input.mimeType !== "image/webp" || sniffImageMime(bytes) !== "image/webp" || containsWebpMetadata(bytes) || !dimensions || dimensions.width !== input.width || dimensions.height !== input.height) throw new Error("位置情報を除去したWebP画像を確認できませんでした。");
  if (!Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1 || input.width > MAX_DM_IMAGE_DIMENSION || input.height > MAX_DM_IMAGE_DIMENSION) throw new Error("画像の縦横は1600px以下にしてください。");
  const thumbnailDimensions = readImageDimensions(thumbnailBytes, "image/webp");
  if (sniffImageMime(thumbnailBytes) !== "image/webp" || containsWebpMetadata(thumbnailBytes) || !thumbnailDimensions || thumbnailDimensions.width !== input.thumbnailWidth || thumbnailDimensions.height !== input.thumbnailHeight || input.thumbnailWidth > 480 || input.thumbnailHeight > 480 || thumbnailBytes.length > 512 * 1024) throw new Error("安全なサムネイルを確認できませんでした。");
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const count = await database.prepare("SELECT count(*) AS total FROM direct_message_images WHERE owner_profile_id = ? AND created_at >= ?").bind(profileId, since).first<{ total: number }>();
  if (Number(count?.total ?? 0) >= DAILY_DM_IMAGE_LIMIT) throw new Error("画像投稿は1日20枚までです。");
  const contentHash = await hashImage(bytes);
  const unsafe = await database.prepare("SELECT id FROM direct_message_images WHERE owner_profile_id = ? AND content_hash = ? AND status <> 'deleted' AND (status = 'rejected' OR safety_status <> 'clean' OR metadata_stripped_at IS NULL) LIMIT 1").bind(profileId, contentHash).first<{ id: string }>();
  if (unsafe) throw new Error("この画像は安全性を確認できないため投稿できません。");
  const duplicate = await database.prepare("SELECT id, width, height, alt_text FROM direct_message_images WHERE owner_profile_id = ? AND content_hash = ? AND status = 'pending' AND message_id IS NULL AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL LIMIT 1").bind(profileId, contentHash).first<ImageRow>();
  if (duplicate) return { id: duplicate.id, url: dmImageUrl(duplicate.id), fullUrl: dmImageUrl(duplicate.id, "full"), width: duplicate.width, height: duplicate.height, altText: duplicate.alt_text };
  const id = crypto.randomUUID(), objectKey = `dm-images/${profileId}/${id}/full.webp`, thumbnailKey = `dm-images/${profileId}/${id}/thumbnail.webp`, createdAt = new Date().toISOString(), altText = input.altText.trim().slice(0, 300);
  // Storage limit: reserve before any byte is written (fails closed if Account is unavailable). When the image row is pruned or deleted, a trigger gives the bytes back.
  const reservation = await reserveHubStorage(database, { profileId, kind: "dm_image", objectId: id, bytes: bytes.length });
  try {
    await bucket.put(objectKey, bytes, { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" }, customMetadata: { derivative: "full", metadataStripped: "true" } });
    await bucket.put(thumbnailKey, thumbnailBytes, { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" }, customMetadata: { derivative: "thumbnail", metadataStripped: "true" } });
    await database.batch([
      database.prepare(`INSERT INTO direct_message_images (id,owner_profile_id,message_id,object_key,mime_type,byte_size,width,height,alt_text,status,content_hash,created_at,safety_status,thumbnail_object_key,thumbnail_byte_size,thumbnail_width,thumbnail_height,metadata_stripped_at) VALUES (?,?,NULL,?,?,?,?,?,?,'pending',?,?,'clean',?,?,?,?,?)`).bind(id, profileId, objectKey, "image/webp", bytes.length, input.width, input.height, altText, contentHash, createdAt, thumbnailKey, thumbnailBytes.length, input.thumbnailWidth, input.thumbnailHeight, createdAt),
      ...commitHubStorageStatements(database, reservation, bytes.length),
    ]);
  } catch (error) { await Promise.all([bucket.delete(objectKey).catch(() => undefined), bucket.delete(thumbnailKey).catch(() => undefined), abandonHubStorage(database, reservation)]); throw error; }
  await finishHubStorageCommit(database, reservation);
  return { id, url: dmImageUrl(id), fullUrl: dmImageUrl(id, "full"), width: input.width, height: input.height, altText };
}

export async function validatePendingDmImages(database: D1Database, profileId: string, ids: string[]): Promise<void> {
  if (ids.length > MAX_DM_IMAGES || new Set(ids).size !== ids.length) throw new Error("画像は1メッセージ4枚までです。"); if (!ids.length) return;
  const cutoff = new Date(Date.now() - 86_400_000).toISOString(), placeholders = ids.map(() => "?").join(",");
  const result = await database.prepare(`SELECT id FROM direct_message_images WHERE id IN (${placeholders}) AND owner_profile_id = ? AND message_id IS NULL AND status = 'pending' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL AND created_at >= ?`).bind(...ids, profileId, cutoff).all<{ id: string }>();
  if (result.results.length !== ids.length) throw new Error("送信できない画像が含まれています。");
}
export async function publishDmImages(database: D1Database, profileId: string, messageId: string, ids: string[]): Promise<void> { if (!ids.length) return; const now = new Date().toISOString(); await database.batch(ids.map((id) => database.prepare("UPDATE direct_message_images SET message_id = ?, status = 'published', published_at = ? WHERE id = ? AND owner_profile_id = ? AND message_id IS NULL AND status = 'pending' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL").bind(messageId, now, id, profileId))); }

type PrunableImageRow = {
  id: string;
  object_key: string;
  thumbnail_object_key: string | null;
  status: "pending" | "deleted";
};

export async function pruneExpiredDirectMessageImages(
  database: D1Database,
  bucket: R2Bucket,
  now = new Date(),
  limit = 100,
): Promise<{ candidates: number; deleted: number }> {
  const boundedLimit = Math.min(100, Math.max(1, Math.trunc(limit)));
  const pendingCutoff = new Date(now.getTime() - 86_400_000).toISOString();
  const rows = await database.prepare(`SELECT id, object_key, thumbnail_object_key, status
    FROM direct_message_images
    WHERE status = 'deleted'
      OR (status = 'pending' AND message_id IS NULL AND created_at < ?)
    ORDER BY created_at
    LIMIT ${boundedLimit}`)
    .bind(pendingCutoff)
    .all<PrunableImageRow>();
  const candidates = rows.results ?? [];
  if (!candidates.length) return { candidates: 0, deleted: 0 };

  // Claim pending rows before touching R2: a concurrent send may have published
  // one since the SELECT. Deleted rows remain retryable if R2 deletion fails.
  const pending = candidates.filter((row) => row.status === "pending");
  const claims = pending.length ? await database.batch(pending.map((row) =>
    database.prepare(`UPDATE direct_message_images SET status = 'deleted'
      WHERE id = ? AND status = 'pending' AND message_id IS NULL AND created_at < ?`)
      .bind(row.id, pendingCutoff))) : [];
  const claimed = new Set(pending.filter((_, index) => Number(claims[index]?.meta.changes ?? 0) > 0).map((row) => row.id));
  const toDelete = candidates.filter((row) => row.status === "deleted" || claimed.has(row.id));
  if (!toDelete.length) return { candidates: candidates.length, deleted: 0 };

  const objectKeys = [...new Set(toDelete.flatMap((row) => [
    row.object_key,
    ...(row.thumbnail_object_key ? [row.thumbnail_object_key] : []),
  ]))];
  await bucket.delete(objectKeys);

  const results = await database.batch(toDelete.map((row) =>
    database.prepare("DELETE FROM direct_message_images WHERE id = ? AND status = 'deleted'").bind(row.id)));
  return {
    candidates: candidates.length,
    deleted: results.reduce((total, result) => total + Number(result.meta.changes ?? 0), 0),
  };
}
export async function attachImagesToDmMessages(database: D1Database, messages: Array<{ id: string }>): Promise<void> {
  if (!messages.length) return;
  const byMessage = new Map<string, DirectMessageImage[]>();
  for (let offset = 0; offset < messages.length; offset += 80) {
    const chunk = messages.slice(offset, offset + 80);
    const placeholders = chunk.map(() => "?").join(",");
    const result = await database.prepare(`SELECT id,message_id,width,height,alt_text FROM direct_message_images WHERE message_id IN (${placeholders}) AND status='published' AND safety_status='clean' AND metadata_stripped_at IS NOT NULL ORDER BY created_at`).bind(...chunk.map((message) => message.id)).all<ImageRow & { message_id: string }>();
    for (const row of result.results) byMessage.set(row.message_id, [...(byMessage.get(row.message_id) ?? []), { id: row.id, url: dmImageUrl(row.id), fullUrl: dmImageUrl(row.id, "full"), width: row.width, height: row.height, altText: row.alt_text }]);
  }
  for (const message of messages) Object.assign(message, { images: byMessage.get(message.id) ?? [] });
}
