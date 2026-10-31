/**
 * Post image downloads (2026-10-17; docs/hub-downloads/DESIGN.md).
 *
 * Hub owns post images, so the single-use ticket is the `hub_download_grants` row itself: the
 * issue step authorizes and records it, the fetch step consumes it once, checks everything again
 * and returns the full image with the grant ID embedded as XMP. Thread and community images are
 * not works with a setting and are never offered.
 */

import type { D1Database } from "@cloudflare/workers-types";

import type { R2Bucket } from "@cloudflare/workers-types";
import { authorizeGatedMedia } from "@/lib/server/gated-content";
import { findVisibleD1SocialTarget } from "@/lib/server/social-target-visibility";
import {
  ContentDownloadError,
  DOWNLOAD_TICKET_LIFETIME_SECONDS,
  decideDownload,
  discardDownloadGrant,
  readDownloadPolicy,
  recordDownloadGrant,
  throwForDecision,
  type DownloadGateOutcome,
  type IssuedDownload,
} from "@/lib/server/content-downloads";
import { embedImageDownloadId } from "@/lib/server/download-watermark-image";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ImageRow = { id: string; object_key: string; mime_type: string; post_id: string; author_profile_id: string | null };

/** A published, clean image on a live social post (not moderated, not hidden, not held). */
async function readImage(database: D1Database, imageId: string): Promise<ImageRow | null> {
  return database
    .prepare(`SELECT i.id, i.object_key, i.mime_type, i.post_id, p.author_profile_id
      FROM social_post_images i
      JOIN social_posts p ON p.id = i.post_id
      WHERE i.id = ? AND i.status = 'published' AND i.safety_status = 'clean'
        AND i.metadata_stripped_at IS NOT NULL AND p.moderated_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM social_post_moderation_cases c
          WHERE c.post_id = p.id AND c.status IN ('auto_held', 'hidden'))
      LIMIT 1`)
    .bind(imageId)
    .first<ImageRow>();
}

async function authorize(database: D1Database, viewerProfileId: string | null, image: ImageRow): Promise<void> {
  const visible = await findVisibleD1SocialTarget(database, viewerProfileId, "social_post", image.post_id);
  if (!visible) throw new ContentDownloadError("not_found", 404, "見つかりません。");
  const isAuthor = viewerProfileId !== null && viewerProfileId === image.author_profile_id;
  let gate: DownloadGateOutcome;
  try {
    const access = await authorizeGatedMedia(database, viewerProfileId, "social_post", image.post_id);
    gate = access === "open" ? "no_gate" : access === "allowed" ? "granted" : viewerProfileId ? "locked" : "locked";
  } catch {
    gate = "unavailable";
  }
  if (gate === "locked" && !viewerProfileId && !isAuthor) {
    throw new ContentDownloadError("authentication_required", 401, "ログインが必要です。");
  }
  const { policy } = await readDownloadPolicy(database, { targetType: "post", targetId: image.post_id }).catch(() => {
    throw new ContentDownloadError("downloads_unavailable", 503, "ダウンロードを準備できませんでした。");
  });
  throwForDecision(decideDownload({ policy, isAuthor, viewerProfileId, gate }));
}

export async function issueImageDownload(
  database: D1Database,
  viewerProfileId: string | null,
  imageId: unknown,
  now = new Date(),
): Promise<IssuedDownload> {
  if (typeof imageId !== "string" || !UUID.test(imageId)) throw new ContentDownloadError("not_found", 404, "見つかりません。");
  const image = await readImage(database, imageId);
  if (!image) throw new ContentDownloadError("not_found", 404, "見つかりません。");
  await authorize(database, viewerProfileId, image);
  const grant = await recordDownloadGrant(database, {
    profileId: viewerProfileId,
    kind: "image",
    objectId: image.id,
    targetType: "post",
    targetId: image.post_id,
    lifetimeSeconds: DOWNLOAD_TICKET_LIFETIME_SECONDS,
    now,
  });
  return { url: `/api/downloads/images/${grant.id}`, expiresAt: grant.expiresAt };
}

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Consume the grant once, re-run every check for the same viewer, and return the watermarked
 * image. A consumed, expired or unknown grant answers 404 and nothing about why.
 */
export async function consumeImageDownload(
  database: D1Database,
  media: Pick<R2Bucket, "get">,
  viewerProfileId: string | null,
  grantId: unknown,
  now = new Date(),
): Promise<Response> {
  const gone = () => new ContentDownloadError("not_found", 404, "このダウンロードの札は使えません。");
  if (typeof grantId !== "string" || !UUID.test(grantId)) throw gone();
  const claimed = await database
    .prepare(`UPDATE hub_download_grants SET consumed_at = ?
      WHERE id = ? AND object_kind = 'image' AND consumed_at IS NULL AND expires_at > ?
        AND ((profile_id IS NULL AND ? IS NULL) OR profile_id = ?)`)
    .bind(now.toISOString(), grantId, now.toISOString(), viewerProfileId, viewerProfileId)
    .run();
  if (Number(claimed.meta?.changes ?? 0) !== 1) throw gone();
  const grant = await database
    .prepare("SELECT object_id FROM hub_download_grants WHERE id = ? LIMIT 1")
    .bind(grantId)
    .first<{ object_id: string }>();
  const image = grant ? await readImage(database, grant.object_id) : null;
  if (!image) throw gone();
  await authorize(database, viewerProfileId, image);

  const object = await media.get(image.object_key);
  if (!object) throw gone();
  const marked = embedImageDownloadId(new Uint8Array(await object.arrayBuffer()), image.mime_type, grantId);
  if (!marked) {
    await discardDownloadGrant(database, grantId);
    throw new ContentDownloadError("downloads_unavailable", 503, "ダウンロードを準備できませんでした。");
  }
  const name = `hub-image-${image.id.slice(0, 8)}.${EXTENSIONS[image.mime_type] ?? "bin"}`;
  return new Response(marked, {
    headers: {
      "Content-Type": image.mime_type,
      "Content-Length": String(marked.byteLength),
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Referrer-Policy": "no-referrer",
    },
  });
}
