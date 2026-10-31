import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type {
  PublicListing,
  PublicListingInput,
  PublicListingKind,
} from "@/lib/public-listings";

type Row = {
  id: string;
  owner_profile_id: string;
  kind: PublicListingKind;
  category: string;
  title: string;
  summary: string;
  provider_label: string;
  provider_url: string;
  region: string;
  locality: string;
  price_label: string | null;
  trust_status: PublicListing["trustStatus"];
  status: PublicListing["status"];
  published_at: string | null;
  event_starts_at: string | null;
  event_organizer_name: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancelled_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

export type D1SearchDateBounds = {
  fromInclusive: string | null;
  toExclusive: string | null;
};

const map = (row: Row): PublicListing => ({
  id: row.id,
  ownerProfileId: row.owner_profile_id,
  kind: row.kind,
  category: row.category,
  title: row.title,
  summary: row.summary,
  providerLabel: row.provider_label,
  providerUrl: row.provider_url,
  region: row.region,
  locality: row.locality,
  priceLabel: row.price_label,
  trustStatus: row.trust_status,
  status: row.status,
  publishedAt: row.published_at,
  startsAt: row.event_starts_at,
  organizerName: row.event_organizer_name,
  cancelledAt: row.cancelled_at,
  cancellationReason: row.cancellation_reason,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listD1PublicListings(
  database: D1Database,
  filters: {
    kind?: PublicListingKind;
    query?: string;
    region?: string;
    ownerProfileId?: string;
    includePrivate?: boolean;
    limit?: number;
    offset?: number;
    /** Filtered search opts into a complete public candidate traversal. */
    searchDateBounds?: D1SearchDateBounds;
    unbounded?: boolean;
  } = {},
) {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (!filters.includePrivate) clauses.push("status = 'published'", "cancelled_at IS NULL");
  if (filters.ownerProfileId) {
    clauses.push("owner_profile_id = ?");
    bindings.push(filters.ownerProfileId);
  }
  if (filters.kind) {
    clauses.push("kind = ?");
    bindings.push(filters.kind);
  }
  if (filters.region) {
    clauses.push("region = ?");
    bindings.push(filters.region.slice(0, 80));
  }
  const query = filters.query?.replace(/\s+/g, " ").trim().slice(0, 120);
  for (const term of query?.split(/\s+/u).filter(Boolean).slice(0, 8) ?? []) {
    clauses.push(
      "lower(title || ' ' || summary || ' ' || category || ' ' || provider_label || ' ' || region || ' ' || locality) LIKE lower(?) ESCAPE '\\'",
    );
    bindings.push(`%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`);
  }
  const date = filters.searchDateBounds;
  if (date) {
    const effectiveDate = "COALESCE(NULLIF(published_at, ''), NULLIF(created_at, ''))";
    if (date.fromInclusive || date.toExclusive) {
      clauses.push(`julianday(${effectiveDate}) IS NOT NULL`);
      if (date.fromInclusive) {
        clauses.push(`julianday(${effectiveDate}) >= julianday(?)`);
        bindings.push(date.fromInclusive);
      }
      if (date.toExclusive) {
        clauses.push(`julianday(${effectiveDate}) < julianday(?)`);
        bindings.push(date.toExclusive);
      }
    }
  }
  const limit = Math.min(100, Math.max(1, filters.limit ?? 30));
  const limitSql = filters.unbounded ? "" : " LIMIT ? OFFSET ?";
  const effectiveDate = "COALESCE(NULLIF(published_at, ''), NULLIF(created_at, ''))";
  const orderSql = filters.unbounded
    ? `ORDER BY CASE trust_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, julianday(${effectiveDate}) DESC, id ASC`
    : "ORDER BY CASE trust_status WHEN 'verified' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, COALESCE(published_at, updated_at) DESC, id ASC";
  const result = await database
    .prepare(`SELECT * FROM public_listings
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ${orderSql}${limitSql}`)
    .bind(...bindings, ...(filters.unbounded ? [] : [limit, Math.max(0, Math.trunc(filters.offset ?? 0))]))
    .all<Row>();
  return result.results.map(map);
}

export async function listD1OwnedPublicListings(
  database: D1Database,
  ownerProfileId: string,
  kind: PublicListingKind,
  page?: { limit: number; after?: { updatedAt: string; id: string }; id?: string },
) {
  if (page && (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > 21)) throw new Error("invalid_owner_listing_page");
  const filters = ["owner_profile_id = ?", "kind = ?"];
  const bindings: unknown[] = [ownerProfileId, kind];
  if (page?.id !== undefined) { filters.push("id = ?"); bindings.push(page.id); }
  if (page?.after) {
    filters.push("(updated_at < ? OR (updated_at = ? AND id > ?))");
    bindings.push(page.after.updatedAt, page.after.updatedAt, page.after.id);
  }
  const result = await database
    .prepare(`SELECT * FROM public_listings
      WHERE ${filters.join(" AND ")}
      ORDER BY updated_at DESC, id ASC${page ? " LIMIT ?" : ""}`)
    .bind(...bindings, ...(page ? [page.limit] : []))
    .all<Row>();
  return result.results.map(map);
}

export type PublicEventListingDetail = Pick<
  PublicListing,
  "id" | "title" | "providerLabel" | "providerUrl" | "region" | "locality" | "startsAt" | "organizerName" | "cancelledAt" | "cancellationReason" | "updatedAt"
>;

export async function getD1PublicEventListingDetail(
  database: D1Database,
  id: string,
): Promise<PublicEventListingDetail | null> {
  const row = await database
    .prepare(`SELECT * FROM public_listings
      WHERE id = ? AND kind = 'events' AND status = 'published'`)
    .bind(id)
    .first<Row>();
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    providerLabel: row.provider_label,
    providerUrl: row.provider_url,
    region: row.region,
    locality: row.locality,
    startsAt: row.event_starts_at,
    organizerName: row.event_organizer_name,
    cancelledAt: row.cancelled_at,
    cancellationReason: row.cancellation_reason,
    updatedAt: row.updated_at,
  };
}

/**
 * A cancellation keeps the review state intact. `cancelled_at` removes a
 * formerly public event from discovery, while preserving only that event's
 * cancellation notice for a direct revisit.
 */
export async function cancelD1PublicEventListing(
  database: D1Database,
  id: string,
  ownerProfileId: string,
  reason: string,
) {
  const now = new Date().toISOString();
  const auditId = crypto.randomUUID();
  await database.batch([
    database.prepare(`UPDATE public_listings
      SET cancelled_at = ?, cancellation_reason = ?, cancelled_by_profile_id = ?, updated_at = ?
      WHERE id = ? AND owner_profile_id = ? AND kind = 'events' AND cancelled_at IS NULL`)
      .bind(now, reason, ownerProfileId, now, id, ownerProfileId),
    database.prepare(`INSERT OR IGNORE INTO public_listing_audit_events
      (id, listing_id, actor_profile_id, event_type, details_json, created_at)
      SELECT ?, id, ?, 'listing.cancelled', ?, ?
      FROM public_listings
      WHERE id = ? AND owner_profile_id = ? AND kind = 'events'
        AND cancelled_at = ? AND cancelled_by_profile_id = ? AND cancellation_reason = ?`)
      .bind(auditId, ownerProfileId, JSON.stringify({ reason }), now, id, ownerProfileId, now, ownerProfileId, reason),
  ]);
  const row = await database
    .prepare(`SELECT * FROM public_listings
      WHERE id = ? AND owner_profile_id = ? AND kind = 'events'`)
    .bind(id, ownerProfileId)
    .first<Row>();
  return row ? map(row) : null;
}

export async function getD1PublicListing(
  database: D1Database,
  id: string,
  viewerProfileId?: string,
) {
  const row = await database
    .prepare(`SELECT * FROM public_listings
      WHERE id = ? AND ((status = 'published' AND cancelled_at IS NULL) OR owner_profile_id = ?)`)
    .bind(id, viewerProfileId ?? "")
    .first<Row>();
  return row ? map(row) : null;
}

export async function createD1PublicListing(
  database: D1Database,
  ownerProfileId: string,
  input: PublicListingInput,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO public_listings (
      id, owner_profile_id, kind, category, title, summary, provider_label,
      provider_url, region, locality, price_label, trust_status, status,
      published_at, event_starts_at, event_organizer_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 'pending', NULL, ?, ?, ?, ?)`)
      .bind(
        id,
        ownerProfileId,
        input.kind,
        input.category,
        input.title,
        input.summary,
        input.providerLabel,
        input.providerUrl,
        input.region,
        input.locality,
        input.priceLabel,
        input.startsAt,
        input.organizerName,
        now,
        now,
      ),
    database.prepare(`INSERT INTO public_listing_audit_events
      (id, listing_id, actor_profile_id, event_type, details_json, created_at)
      VALUES (?, ?, ?, 'listing.submitted', ?, ?)`)
      .bind(crypto.randomUUID(), id, ownerProfileId, JSON.stringify({ kind: input.kind }), now),
  ]);
  return getD1PublicListing(database, id, ownerProfileId);
}

export async function listD1PublicListingReviewQueue(database: D1Database) {
  const result = await database
    .prepare(`SELECT * FROM public_listings
      WHERE status IN ('pending', 'rejected')
      ORDER BY updated_at ASC LIMIT 200`)
    .all<Row>();
  return result.results.map(map);
}

export async function reviewD1PublicListing(
  database: D1Database,
  id: string,
  input: {
    action: "approve" | "reject" | "pause";
    note: string;
    trustStatus?: PublicListing["trustStatus"];
  },
) {
  const existing = await database
    .prepare("SELECT * FROM public_listings WHERE id = ?")
    .bind(id)
    .first<Row>();
  if (!existing) return null;
  if (input.action === "approve" && existing.cancelled_at) return map(existing);
  const now = new Date().toISOString();
  const status =
    input.action === "approve"
      ? "published"
      : input.action === "reject"
        ? "rejected"
        : "paused";
  const trustStatus =
    input.trustStatus ??
    (input.action === "approve" ? "not_available" : existing.trust_status);
  await database.batch([
    database.prepare(`UPDATE public_listings
      SET status = ?, trust_status = ?, published_at = CASE WHEN ? = 'published'
        THEN COALESCE(published_at, ?) ELSE published_at END, updated_at = ?
      WHERE id = ? AND (? <> 'approve' OR cancelled_at IS NULL)`)
      .bind(status, trustStatus, status, now, now, id, input.action),
    database.prepare(`INSERT INTO public_listing_audit_events
      (id, listing_id, actor_profile_id, event_type, details_json, created_at)
      SELECT ?, id, NULL, ?, ?, ? FROM public_listings
      WHERE id = ? AND (? <> 'approve' OR cancelled_at IS NULL)`)
      .bind(
        crypto.randomUUID(),
        `listing.${input.action}`,
        JSON.stringify({ note: input.note.slice(0, 1000), trustStatus }),
        now,
        id,
        input.action,
      ),
  ]);
  const row = await database
    .prepare("SELECT * FROM public_listings WHERE id = ?")
    .bind(id)
    .first<Row>();
  return row ? map(row) : null;
}
