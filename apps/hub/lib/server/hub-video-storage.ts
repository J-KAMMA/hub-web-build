/*
 * Video storage accounting, Hub side (docs/hub-video/PLAN.md 6.1; AGENTS.md 2026-10-15).
 *
 * Account (services/account/src/storage-api.ts) is the only holder of a person's storage total.
 * Video has no storage audience of its own and never calls Account: Hub reserves, commits and
 * releases under its own Hub-audience pairwise subject, using what the Video Worker reports in
 * its ticketed status read. The Video Worker never sees the subject.
 *
 *   1. Before the upload ticket: reserve `max_bytes` (key `video:<asset>:upload`). Refused or
 *      unavailable -> no ticket (fail closed).
 *   2. When the Video Worker reports `quarantined` (upload complete): commit the reservation with
 *      `receivedBytes`. Account reservations expire after 30 minutes and processing can take
 *      longer, so the space is held as committed from here on.
 *   3. When it reports `ready`: adopt `storedBytes` (key `video:<asset>:stored`), then release the
 *      upload commitment. The limit was checked at step 1 against the original size; the adopted
 *      total differs only by the 360p rendition.
 *   4. When it reports `rejected` or `failed`, or the video is deleted: release what is held.
 *
 * Every call signs a fresh claim (hub-storage-account-client.ts), so retries are safe; adopt is
 * idempotent by key. Where the IDs are persisted (hub_videos) is phase 2 (lane V4).
 */

import type {
  HubStorageAccountAck,
  HubStorageAccountClient,
} from "./hub-storage-account-client";

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const videoUploadStorageKey = (assetId: string) => `video:${assetId}:upload`;
export const videoStoredStorageKey = (assetId: string) => `video:${assetId}:stored`;

function assertAssetId(assetId: string) {
  if (!ASSET_ID.test(assetId)) throw new Error("invalid_asset_id");
}

export type VideoUploadReservation =
  | { ok: true; reservationId: string }
  | { ok: false; reason: "over_limit" | "unavailable" };

/** Step 1. Issue the upload ticket only when this returns ok. */
export async function reserveVideoUpload(
  client: HubStorageAccountClient,
  input: { subject: string; assetId: string; maxBytes: number },
): Promise<VideoUploadReservation> {
  assertAssetId(input.assetId);
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) return { ok: false, reason: "unavailable" };
  const result = await client.reserve({
    subject: input.subject,
    bytes: input.maxBytes,
    idempotencyKey: videoUploadStorageKey(input.assetId),
  });
  if (result.ok) return { ok: true, reservationId: result.reservationId };
  return { ok: false, reason: result.reason };
}

/** Step 2. `receivedBytes` comes from the Video Worker's status once it says `quarantined`. */
export async function commitVideoUpload(
  client: HubStorageAccountClient,
  input: { subject: string; reservationId: string; receivedBytes: number },
): Promise<HubStorageAccountAck> {
  if (!Number.isSafeInteger(input.receivedBytes) || input.receivedBytes < 1) return { ok: false, reason: "unavailable" };
  return client.commit({ subject: input.subject, reservationId: input.reservationId, bytes: input.receivedBytes });
}

export type VideoStoredSettlement =
  | { ok: true; storedReservationId: string; uploadReleased: boolean }
  | { ok: false; reason: "unavailable" };

/** Step 3. Count the stored renditions, then drop the original's commitment. */
export async function settleVideoProcessed(
  client: HubStorageAccountClient,
  input: { subject: string; assetId: string; uploadReservationId: string; storedBytes: number },
): Promise<VideoStoredSettlement> {
  assertAssetId(input.assetId);
  if (!Number.isSafeInteger(input.storedBytes) || input.storedBytes < 1) return { ok: false, reason: "unavailable" };
  const adopted = await client.adopt({
    subject: input.subject,
    bytes: input.storedBytes,
    idempotencyKey: videoStoredStorageKey(input.assetId),
  });
  if (!adopted.ok || !adopted.reservationId) return { ok: false, reason: "unavailable" };
  // A failed release only over-counts until the next retry; it never under-counts.
  const released = await client.release({ subject: input.subject, reservationId: input.uploadReservationId });
  return { ok: true, storedReservationId: adopted.reservationId, uploadReleased: released.ok };
}

/** Step 4. Release a reservation or commitment; already gone counts as released. */
export function releaseVideoStorage(
  client: HubStorageAccountClient,
  input: { subject: string; reservationId: string },
): Promise<HubStorageAccountAck> {
  return client.release(input);
}

export type VideoStorageStep = "commit_upload" | "settle_processed" | "release" | "wait";

/** Which step a Video status calls for, given what Hub already did. */
export function nextVideoStorageStep(
  status: { state: string; deleted: boolean },
  held: { uploadCommitted: boolean; storedReservationId: string | null },
): VideoStorageStep {
  if (status.deleted || status.state === "rejected" || status.state === "failed") return "release";
  if (status.state === "ready") return held.storedReservationId ? "wait" : "settle_processed";
  if ((status.state === "quarantined" || status.state === "processing") && !held.uploadCommitted) return "commit_upload";
  return "wait";
}
