import "server-only";

import type { D1Database, D1PreparedStatement, R2Bucket } from "@cloudflare/workers-types";

import { MAX_AVATAR_BYTES } from "@/lib/avatar-image";
import { profileAvatarDeliveryUrl, profileAvatarObjectKeyFromDeliveryUrl } from "@/lib/server/profile-avatar-storage";
import { importedStorageStatements } from "@/lib/server/hub-storage-usage";
import { findVisibleD1SocialTarget } from "@/lib/server/social-target-visibility";
import {
  containsWebpMetadata,
  hashImage,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_POST_IMAGES,
  readImageDimensions,
  sniffImageMime,
} from "@/lib/server/social-post-images";

/*
 * hub.account.bundle v2 の画像（アバターと投稿の添付）。DESIGN.md 3 / AGENTS.md の移転の規則。
 *
 * 書き出し: 束に入れるのは「この Hub の公開 URL + SHA-256 + MIME + サイズ」だけ。R2 の鍵は入れない。
 *   URL の末尾は推測できない使い捨て token（hub_portable_media_refs）。Hub ローカルの ID は URL にも入らない。
 * 取り込み: 参照先を取りに行き、既存の画像アップロードと同じ検査（MIME の先頭バイト、WebP のメタデータ除去、寸法、サイズ）に
 *   通す。1件でも通らなければその1件だけを捨てて残りは続ける（fail closed per item）。捨てた数は報告する。
 *   取りに行く先は https の公開ドメインだけ。リダイレクトは辿らない。
 */

export const MEDIA_REF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_EXPORT_IMAGES = 500;
export const MAX_IMPORT_IMAGES = 500;
const THUMBNAIL_MAX_BYTES = 512 * 1024;
const THUMBNAIL_MAX_DIMENSION = 480;
const FETCH_TIMEOUT_MS = 10_000;
const MEDIA_PATH = "/api/core/portability/media/";
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);

type ImageMime = "image/jpeg" | "image/png" | "image/webp";

export type BundleMediaFile = { sha256: string; url: string; mime: ImageMime; size: number };
/** 束の avatar / attachments の要素。sha256 と path は束の既存の形（portable-identity.ts の型）に合わせてある。 */
export type BundleMediaRef = BundleMediaFile & { path: string; alt?: string; thumbnail?: BundleMediaFile };

/* ---------------------------------------------------------------- 書き出し */

type ExportRow = { token: string; kind: string; profileId: string; sourceId: string; objectKey: string; mime: string; size: number; sha256: string };

function newToken(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function mediaUrl(origin: string, token: string): string {
  return `${origin}${MEDIA_PATH}${token}`;
}

/** 失効した参照を片づける。 */
async function purgeExpired(database: D1Database, now: string): Promise<void> {
  await database.prepare("DELETE FROM hub_portable_media_refs WHERE expires_at < ?").bind(now).run();
}

export type ExportedMedia = {
  avatar: BundleMediaRef | null;
  /** 投稿 ID（Hub ローカル）→ 添付。呼び出し側が originalId に置き換える。束には出ない。 */
  attachmentsByPost: Map<string, BundleMediaRef[]>;
};

export async function createExportMedia(
  database: D1Database,
  bucket: R2Bucket,
  input: { profileId: string; avatarUrl: string | null | undefined; postIds: string[]; origin: string },
): Promise<ExportedMedia> {
  const now = new Date();
  const createdAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + MEDIA_REF_TTL_MS).toISOString();
  await purgeExpired(database, createdAt);
  const rows: ExportRow[] = [];
  const result: ExportedMedia = { avatar: null, attachmentsByPost: new Map() };

  const avatarKey = profileAvatarObjectKeyFromDeliveryUrl(input.avatarUrl);
  if (avatarKey) {
    try {
      const object = await bucket.get(avatarKey);
      if (object && object.size > 0 && object.size <= MAX_AVATAR_BYTES) {
        const bytes = new Uint8Array(await object.arrayBuffer());
        const mime = sniffImageMime(bytes);
        if (mime) {
          const sha256 = await hashImage(bytes);
          const token = newToken();
          rows.push({ token, kind: "avatar", profileId: input.profileId, sourceId: input.profileId, objectKey: avatarKey, mime, size: bytes.length, sha256 });
          result.avatar = { sha256, path: "media/avatar", url: mediaUrl(input.origin, token), mime, size: bytes.length };
        }
      }
    } catch { /* 読めなければアバターは入れない */ }
  }

  if (input.postIds.length) {
    const images = new Map<string, Array<{ id: string; postId: string; objectKey: string; thumbKey: string | null; mime: ImageMime; size: number; hash: string; thumbSize: number | null; alt: string }>>();
    for (let start = 0; start < input.postIds.length && countImages(images) < MAX_EXPORT_IMAGES; start += 50) {
      const chunk = input.postIds.slice(start, start + 50);
      const found = await database.prepare(
        `SELECT id, post_id AS postId, object_key AS objectKey, thumbnail_object_key AS thumbKey, mime_type AS mime, byte_size AS size,
                content_hash AS hash, thumbnail_byte_size AS thumbSize, alt_text AS alt
         FROM social_post_images
         WHERE owner_profile_id = ? AND status = 'published' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL
           AND post_id IN (${chunk.map(() => "?").join(",")})
         ORDER BY created_at LIMIT ${MAX_POST_IMAGES * 50}`,
      ).bind(input.profileId, ...chunk).all<{ id: string; postId: string; objectKey: string; thumbKey: string | null; mime: ImageMime; size: number; hash: string; thumbSize: number | null; alt: string }>();
      for (const image of found.results) {
        if (countImages(images) >= MAX_EXPORT_IMAGES) break;
        const list = images.get(image.postId) ?? [];
        if (list.length >= MAX_POST_IMAGES) continue;
        list.push(image);
        images.set(image.postId, list);
      }
    }
    for (const [postId, list] of images) {
      // 公開されている投稿の画像だけを配る（限定公開の投稿の画像は束に載せない）。
      if (!(await findVisibleD1SocialTarget(database, null, "social_post", postId))) continue;
      for (const image of list) {
        if (!SHA256.test(image.hash) || !image.thumbKey || !image.thumbSize) continue;
        let thumbnail: BundleMediaFile;
        try {
          const object = await bucket.get(image.thumbKey);
          if (!object) continue;
          const bytes = new Uint8Array(await object.arrayBuffer());
          const mime = sniffImageMime(bytes);
          if (!mime || bytes.length > THUMBNAIL_MAX_BYTES) continue;
          const thumbToken = newToken();
          const thumbSha = await hashImage(bytes);
          rows.push({ token: thumbToken, kind: "post_thumbnail", profileId: input.profileId, sourceId: image.id, objectKey: image.thumbKey, mime, size: bytes.length, sha256: thumbSha });
          thumbnail = { sha256: thumbSha, url: mediaUrl(input.origin, thumbToken), mime, size: bytes.length };
        } catch { continue; }
        const token = newToken();
        rows.push({ token, kind: "post_image", profileId: input.profileId, sourceId: image.id, objectKey: image.objectKey, mime: image.mime, size: image.size, sha256: image.hash });
        const attachments = result.attachmentsByPost.get(postId) ?? [];
        attachments.push({
          sha256: image.hash, path: `media/${image.hash}`, url: mediaUrl(input.origin, token), mime: image.mime, size: image.size,
          ...(image.alt ? { alt: image.alt.slice(0, 300) } : {}), thumbnail,
        });
        result.attachmentsByPost.set(postId, attachments);
      }
    }
  }

  for (let start = 0; start < rows.length; start += 40) {
    await database.batch(rows.slice(start, start + 40).map((row) => database.prepare(
      `INSERT INTO hub_portable_media_refs (token, kind, profile_id, source_id, object_key, mime, size, sha256, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(row.token, row.kind, row.profileId, row.sourceId, row.objectKey, row.mime, row.size, row.sha256, createdAt, expiresAt)));
  }
  return result;
}

function countImages(images: Map<string, unknown[]>): number {
  let total = 0;
  for (const list of images.values()) total += list.length;
  return total;
}

/** token の画像を返す。期限切れ・元が非公開・消えている・食い違いはすべて null（呼び出し側が 404）。 */
export async function readExportMedia(
  database: D1Database,
  bucket: R2Bucket,
  token: string,
): Promise<{ body: ArrayBuffer; mime: string } | null> {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const row = await database.prepare(
    `SELECT kind, profile_id AS profileId, source_id AS sourceId, object_key AS objectKey, mime, size, sha256
     FROM hub_portable_media_refs WHERE token = ? AND expires_at > ?`,
  ).bind(token, new Date().toISOString()).first<{ kind: string; profileId: string; sourceId: string; objectKey: string; mime: string; size: number; sha256: string }>();
  if (!row) return null;
  if (row.kind === "avatar") {
    const current = await database.prepare("SELECT avatar_url AS avatarUrl FROM profiles WHERE id = ?").bind(row.profileId).first<{ avatarUrl: string | null }>();
    if (profileAvatarObjectKeyFromDeliveryUrl(current?.avatarUrl) !== row.objectKey) return null;
  } else {
    const image = await database.prepare(
      `SELECT post_id AS postId FROM social_post_images
       WHERE id = ? AND owner_profile_id = ? AND status = 'published' AND safety_status = 'clean' AND metadata_stripped_at IS NOT NULL
         AND (object_key = ? OR thumbnail_object_key = ?)`,
    ).bind(row.sourceId, row.profileId, row.objectKey, row.objectKey).first<{ postId: string | null }>();
    if (!image?.postId) return null;
    if (!(await findVisibleD1SocialTarget(database, null, "social_post", image.postId))) return null;
  }
  const object = await bucket.get(row.objectKey);
  if (!object || object.size !== row.size) return null;
  return { body: await object.arrayBuffer(), mime: row.mime };
}

/* ---------------------------------------------------------------- 取り込み：取得先の検査 */

/**
 * 手元の2 Hub 試験用の例外（federation の FEDERATION_DEV_LOOPBACK_PEERS と同じ考え方）。
 * HUB_PUBLIC_ORIGIN が http のループバック（localhost / 127.0.0.1、ポート付き）で、
 * HUB_DEV_LOOPBACK_MEDIA_ORIGINS に正確な origin が列挙されているときだけ、その origin を許す。
 * 1件でも形が崩れていれば全体を無効にする。本番の設定に置いてはならない。
 */
export function devLoopbackMediaOrigins(env: Record<string, string | undefined> = process.env): ReadonlySet<string> {
  const loopback = (value: string): string | null => {
    try {
      const url = new URL(value);
      if (url.protocol !== "http:" || url.username || url.password || !url.port) return null;
      if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") return null;
      if (url.pathname !== "/" || url.search || url.hash) return null;
      return url.origin;
    } catch { return null; }
  };
  const self = env.HUB_PUBLIC_ORIGIN ? loopback(env.HUB_PUBLIC_ORIGIN.trim()) : null;
  const listed = env.HUB_DEV_LOOPBACK_MEDIA_ORIGINS?.trim();
  if (!self || !listed) return new Set();
  const peers = listed.split(",").map((entry) => loopback(entry.trim()));
  if (peers.some((peer) => peer === null)) return new Set();
  return new Set([self, ...(peers as string[])]);
}

export function isSafeMediaUrl(value: unknown, devOrigins: ReadonlySet<string> = new Set()): value is string {
  if (typeof value !== "string" || value.length > 2048) return false;
  let url: URL;
  try { url = new URL(value); } catch { return false; }
  if (url.username || url.password || url.hash) return false;
  if (devOrigins.has(url.origin)) return true;
  if (url.protocol !== "https:" || url.port) return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  // IP リテラル（v4 の各種表記・v6）は一切通さない。名前だけ。
  if (host.includes(":") || host.startsWith("[") || /^[0-9.]+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return false;
  if (!host.includes(".")) return false;
  if (/(^|\.)(localhost|local|internal|localdomain|lan|home|corp|intranet)$/.test(host) || host.endsWith(".home.arpa")) return false;
  return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host);
}

export type MediaFetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string>; redirect: "manual" }) => Promise<Response>;

async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) { await reader.cancel().catch(() => undefined); return null; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

function validFile(value: unknown, devOrigins: ReadonlySet<string>, limit: number): value is BundleMediaFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const file = value as Record<string, unknown>;
  return typeof file.sha256 === "string" && SHA256.test(file.sha256)
    && isSafeMediaUrl(file.url, devOrigins)
    && typeof file.mime === "string" && IMAGE_MIMES.has(file.mime)
    && Number.isInteger(file.size) && (file.size as number) > 0 && (file.size as number) <= limit;
}

/** 参照先を取り、宣言どおり（サイズ・SHA-256・先頭バイト）であることを確かめる。通らなければ null。 */
async function fetchVerified(file: BundleMediaFile, limit: number, fetcher: MediaFetcher): Promise<{ bytes: Uint8Array; mime: ImageMime } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(file.url, { signal: controller.signal, headers: { accept: "image/jpeg,image/png,image/webp" }, redirect: "manual" });
    if (response.status !== 200) return null;
    const bytes = await readCapped(response, limit);
    if (!bytes || bytes.length === 0 || bytes.length !== file.size) return null;
    const mime = sniffImageMime(bytes);
    if (!mime || mime !== file.mime) return null;
    if ((await hashImage(bytes)) !== file.sha256) return null;
    return { bytes, mime };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------------------------------------------------------- 取り込み：アバター */

export type ImportMediaDeps = { bucket: R2Bucket; fetcher?: MediaFetcher; devOrigins?: ReadonlySet<string> };

export async function importAvatar(
  database: D1Database,
  profileId: string,
  ref: unknown,
  deps: ImportMediaDeps,
): Promise<"imported" | "kept_existing" | "skipped"> {
  const devOrigins = deps.devOrigins ?? devLoopbackMediaOrigins();
  if (!validFile(ref, devOrigins, MAX_AVATAR_BYTES)) return "skipped";
  const current = await database.prepare("SELECT avatar_url AS avatarUrl FROM profiles WHERE id = ?").bind(profileId).first<{ avatarUrl: string | null }>();
  if (current?.avatarUrl) return "kept_existing";
  const fetched = await fetchVerified(ref, MAX_AVATAR_BYTES, deps.fetcher ?? fetch);
  if (!fetched) return "skipped";
  const version = crypto.randomUUID();
  const objectKey = profileAvatarObjectKeyFromDeliveryUrl(profileAvatarDeliveryUrl(profileId, version));
  if (!objectKey) return "skipped";
  await deps.bucket.put(objectKey, fetched.bytes, {
    httpMetadata: { contentType: fetched.mime, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { purpose: "profile-avatar", source: "account-bundle" },
  });
  const saved = await database.prepare("UPDATE profiles SET avatar_url = ? WHERE id = ? AND (avatar_url IS NULL OR avatar_url = '')")
    .bind(profileAvatarDeliveryUrl(profileId, version), profileId).run();
  if (Number(saved.meta?.changes ?? 0) !== 1) {
    await deps.bucket.delete(objectKey).catch(() => undefined);
    return "kept_existing";
  }
  return "imported";
}

/* ---------------------------------------------------------------- 取り込み：投稿の添付 */

/**
 * 1枚を検査して R2 に置く準備をする。通らなければ null（その1枚だけ捨てる）。
 * 検査は createPendingImage と同じ：WebP・メタデータ（EXIF/XMP/ICC）なし・縦横 1600px 以下・2MB 以下・サムネイルは 480px / 512KB 以下。
 * 検査を全部通ってから R2 に書く（通らなかったバイト列は保存しない）。
 */
export async function prepareImportImage(
  profileId: string,
  postId: string,
  ref: unknown,
  deps: ImportMediaDeps & { seenHashes: Set<string>; publishedAt: string },
): Promise<{ insert: [string, unknown[]]; keys: string[]; storage: (database: D1Database) => D1PreparedStatement[] } | null> {
  const devOrigins = deps.devOrigins ?? devLoopbackMediaOrigins();
  if (!validFile(ref, devOrigins, MAX_IMAGE_BYTES)) return null;
  const item = ref as BundleMediaRef;
  if (item.mime !== "image/webp" || !validFile(item.thumbnail, devOrigins, THUMBNAIL_MAX_BYTES) || item.thumbnail.mime !== "image/webp") return null;
  if (deps.seenHashes.has(item.sha256)) return null;
  const fetcher = deps.fetcher ?? fetch;
  const full = await fetchVerified(item, MAX_IMAGE_BYTES, fetcher);
  if (!full || containsWebpMetadata(full.bytes)) return null;
  const dimensions = readImageDimensions(full.bytes, "image/webp");
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) return null;
  const thumb = await fetchVerified(item.thumbnail, THUMBNAIL_MAX_BYTES, fetcher);
  if (!thumb || containsWebpMetadata(thumb.bytes)) return null;
  const thumbDimensions = readImageDimensions(thumb.bytes, "image/webp");
  if (!thumbDimensions || thumbDimensions.width < 1 || thumbDimensions.height < 1 || thumbDimensions.width > THUMBNAIL_MAX_DIMENSION || thumbDimensions.height > THUMBNAIL_MAX_DIMENSION) return null;

  const id = crypto.randomUUID();
  const objectKey = `social-post-images/${profileId}/${id}/full.webp`;
  const thumbnailKey = `social-post-images/${profileId}/${id}/thumbnail.webp`;
  await deps.bucket.put(objectKey, full.bytes, { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" }, customMetadata: { derivative: "full", metadataStripped: "true", source: "account-bundle" } });
  try {
    await deps.bucket.put(thumbnailKey, thumb.bytes, { httpMetadata: { contentType: "image/webp", cacheControl: "private, no-store" }, customMetadata: { derivative: "thumbnail", metadataStripped: "true", source: "account-bundle" } });
  } catch {
    await deps.bucket.delete(objectKey).catch(() => undefined);
    return null;
  }
  deps.seenHashes.add(item.sha256);
  const alt = typeof item.alt === "string" ? item.alt.trim().slice(0, 300) : "";
  return {
    keys: [objectKey, thumbnailKey],
    // Imports are counted but never refused by the storage limit (PLAN 4.4): add these to the same batch as `insert`.
    storage: (database) => importedStorageStatements(database, { profileId, kind: "social_post_image", objectId: id, bytes: full.bytes.length }),
    insert: [
      `INSERT INTO social_post_images (id, owner_profile_id, post_id, object_key, mime_type, byte_size, width, height, alt_text, status, content_hash,
         created_at, published_at, safety_status, thumbnail_object_key, thumbnail_byte_size, thumbnail_width, thumbnail_height, metadata_stripped_at)
       VALUES (?, ?, ?, ?, 'image/webp', ?, ?, ?, ?, 'published', ?, ?, ?, 'clean', ?, ?, ?, ?, ?)`,
      [id, profileId, postId, objectKey, full.bytes.length, dimensions.width, dimensions.height, alt, item.sha256,
        deps.publishedAt, deps.publishedAt, thumbnailKey, thumb.bytes.length, thumbDimensions.width, thumbDimensions.height, deps.publishedAt],
    ],
  };
}

/** このプロフィールが既に持つ画像のハッシュ（重複は一意索引に弾かれて束全体が落ちるので、先に除く）。 */
export async function existingImageHashes(database: D1Database, profileId: string, hashes: string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (let start = 0; start < hashes.length; start += 50) {
    const chunk = hashes.slice(start, start + 50);
    if (!chunk.length) continue;
    const rows = await database.prepare(
      `SELECT content_hash AS hash FROM social_post_images WHERE owner_profile_id = ? AND status <> 'deleted' AND content_hash IN (${chunk.map(() => "?").join(",")})`,
    ).bind(profileId, ...chunk).all<{ hash: string }>();
    for (const row of rows.results) found.add(row.hash);
  }
  return found;
}
