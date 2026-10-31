import type { D1Database } from "@cloudflare/workers-types";

import {
  HubStorageError,
  abandonHubStorage,
  commitHubStorageStatements,
  finishHubStorageCommit,
  reserveHubStorage,
  type HubStorageReservation,
} from "@/lib/server/hub-storage-usage";

/**
 * Storage-quota hooks for gated file attachments (2026-10-15, Vault folded into Hub).
 *
 * Attachments count through the same reserve / commit / release as Hub images (storage lane C,
 * hub-storage-usage.ts, kind `content_file`): Account holds the total for linked profiles, the
 * local 100MB counter covers unlinked ones, and an unreachable Account fails the upload closed.
 *
 *   reserve  when Hub issues the upload ticket (declared size),
 *   commit   when the file is first published (size stored by the file component; never more
 *            than reserved),
 *   release  when an attachment is removed before it was ever committed.
 *
 * A committed file stays counted after it is unpublished or removed, because the file component
 * still holds the bytes (it has no delete yet).
 */

export type ContentFileStorageReservation =
  | { ok: true; reservation: string | null }
  | { ok: false; reason: "quota_exceeded" | "unavailable" };

export type ContentFileStorageHooks = {
  reserve(database: D1Database, input: { profileId: string; fileId: string; bytes: number }): Promise<ContentFileStorageReservation>;
  commit(database: D1Database, input: { profileId: string; fileId: string; reservation: string | null; bytes: number }): Promise<boolean>;
  release(database: D1Database, input: { profileId: string; fileId: string; reservation: string | null }): Promise<void>;
};

function parseReservation(value: string | null, profileId: string, fileId: string): HubStorageReservation | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<HubStorageReservation>;
    if (
      (parsed.mode !== "local" && parsed.mode !== "account")
      || typeof parsed.bytes !== "number"
      || !Number.isSafeInteger(parsed.bytes)
    ) return null;
    return {
      mode: parsed.mode,
      profileId,
      kind: "content_file",
      objectId: fileId,
      bytes: parsed.bytes,
      reservationId: typeof parsed.reservationId === "string" ? parsed.reservationId : null,
    };
  } catch {
    return null;
  }
}

/** Only the mode, size and Account reservation id are kept on the attachment row. */
function serializeReservation(reservation: HubStorageReservation): string {
  return JSON.stringify({ mode: reservation.mode, bytes: reservation.bytes, reservationId: reservation.reservationId });
}

export const contentFileStorageHooks: ContentFileStorageHooks = {
  async reserve(database, { profileId, fileId, bytes }) {
    try {
      const reservation = await reserveHubStorage(database, { profileId, kind: "content_file", objectId: fileId, bytes });
      return { ok: true, reservation: serializeReservation(reservation) };
    } catch (error) {
      return { ok: false, reason: error instanceof HubStorageError && error.code === "over_limit" ? "quota_exceeded" : "unavailable" };
    }
  },
  async commit(database, { profileId, fileId, reservation, bytes }) {
    const parsed = parseReservation(reservation, profileId, fileId);
    if (!parsed || bytes > parsed.bytes) return false;
    try {
      await database.batch(commitHubStorageStatements(database, parsed, bytes));
      await finishHubStorageCommit(database, parsed);
      return true;
    } catch {
      return false;
    }
  },
  async release(database, { profileId, fileId, reservation }) {
    const parsed = parseReservation(reservation, profileId, fileId);
    if (parsed) await abandonHubStorage(database, parsed);
  },
};
