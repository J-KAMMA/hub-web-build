import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

export type MarketTicketEvent = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  organizerName: string;
  organizerHandle: string;
  venueName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  saleStartsAt: string;
  saleEndsAt: string;
  maxPerOrder: number;
  ticketTypes: Array<{
    id: string;
    name: string;
    priceMinor: number;
    currency: string;
    remaining: number;
    status: string;
  }>;
};

export type MarketTicketReservation = {
  id: string;
  eventTitle: string;
  ticketTypeName: string;
  quantity: number;
  totalMinor: number;
  currency: string;
  status: string;
  holdExpiresAt: string;
  createdAt: string;
  token: null | {
    chainId: number;
    contractAddress: string;
    tokenId: string;
    transactionHash: string;
    status: "issued" | "revoked";
  };
  refundStatus: string | null;
};

type MarketTicketReservationRow = Omit<MarketTicketReservation, "token"> & {
  chainId: number | null;
  contractAddress: string | null;
  tokenId: string | null;
  transactionHash: string | null;
  tokenStatus: "issued" | "revoked" | null;
};

type EventRow = Omit<MarketTicketEvent, "ticketTypes"> & {
  ticketTypeId: string | null;
  ticketTypeName: string | null;
  priceMinor: number | null;
  currency: string | null;
  remaining: number | null;
  ticketTypeStatus: string | null;
};

export async function releaseExpiredMarketTicketHolds(database: D1Database) {
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`UPDATE market_ticket_types
      SET reserved_quantity = MAX(0, reserved_quantity - COALESCE((
        SELECT SUM(r.quantity)
        FROM market_ticket_reservations r
        WHERE r.ticket_type_id=market_ticket_types.id
          AND r.status='held' AND r.hold_expires_at<=?
      ), 0)), updated_at=?
      WHERE EXISTS (
        SELECT 1 FROM market_ticket_reservations r
        WHERE r.ticket_type_id=market_ticket_types.id
          AND r.status='held' AND r.hold_expires_at<=?
      )`).bind(now, now, now),
    database.prepare(`UPDATE market_ticket_reservations
      SET status='expired', updated_at=?
      WHERE status='held' AND hold_expires_at<=?`).bind(now, now),
  ]);
}

export async function listMarketTicketEvents(database: D1Database): Promise<MarketTicketEvent[]> {
  await releaseExpiredMarketTicketHolds(database);
  const now = new Date().toISOString();
  const result = await database.prepare(`SELECT
      e.id, e.slug, e.title, e.summary, p.display_name organizerName, p.handle organizerHandle,
      e.venue_name venueName, e.starts_at startsAt, e.ends_at endsAt, e.timezone,
      e.sale_starts_at saleStartsAt, e.sale_ends_at saleEndsAt, e.max_per_order maxPerOrder,
      t.id ticketTypeId, t.name ticketTypeName, t.price_minor priceMinor, t.currency,
      (t.total_quantity - t.reserved_quantity - t.sold_quantity) remaining,
      t.status ticketTypeStatus
    FROM market_ticket_events e
    JOIN profiles p ON p.id=e.organizer_profile_id
    LEFT JOIN market_ticket_types t ON t.event_id=e.id
    WHERE e.status='published' AND e.ends_at > ?
    ORDER BY e.starts_at ASC, t.price_minor ASC`).bind(now).all<EventRow>();
  const events = new Map<string, MarketTicketEvent>();
  for (const row of result.results) {
    const event = events.get(row.id) ?? {
      id: row.id, slug: row.slug, title: row.title, summary: row.summary,
      organizerName: row.organizerName, organizerHandle: row.organizerHandle,
      venueName: row.venueName, startsAt: row.startsAt, endsAt: row.endsAt,
      timezone: row.timezone, saleStartsAt: row.saleStartsAt, saleEndsAt: row.saleEndsAt,
      maxPerOrder: row.maxPerOrder, ticketTypes: [],
    };
    if (row.ticketTypeId) event.ticketTypes.push({
      id: row.ticketTypeId,
      name: row.ticketTypeName ?? "一般",
      priceMinor: row.priceMinor ?? 0,
      currency: row.currency ?? "JPY",
      remaining: Math.max(0, row.remaining ?? 0),
      status: row.ticketTypeStatus ?? "paused",
    });
    events.set(row.id, event);
  }
  return [...events.values()];
}

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

export async function createMarketTicketEvent(database: D1Database, organizerProfileId: string, input: Record<string, unknown>) {
  const title = text(input.title, 120);
  const summary = text(input.summary, 1000);
  const venueName = text(input.venueName, 160);
  const ticketName = text(input.ticketName, 80);
  const startsAt = text(input.startsAt, 40);
  const endsAt = text(input.endsAt, 40);
  const saleStartsAt = text(input.saleStartsAt, 40);
  const saleEndsAt = text(input.saleEndsAt, 40);
  const priceMinor = Number(input.priceMinor);
  const totalQuantity = Number(input.totalQuantity);
  const maxPerOrder = Number(input.maxPerOrder ?? 4);
  const dates = [startsAt, endsAt, saleStartsAt, saleEndsAt].map(Date.parse);
  if (!title || !summary || !venueName || !ticketName || dates.some(Number.isNaN) ||
      dates[0] >= dates[1] || dates[2] >= dates[3] || dates[3] > dates[0] ||
      !Number.isSafeInteger(priceMinor) || priceMinor < 0 ||
      !Number.isSafeInteger(totalQuantity) || totalQuantity < 1 || totalQuantity > 100_000 ||
      !Number.isSafeInteger(maxPerOrder) || maxPerOrder < 1 || maxPerOrder > 20) {
    throw new Error("invalid_ticket_event");
  }
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const typeId = crypto.randomUUID();
  const slug = `${title.toLocaleLowerCase("ja").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 48) || "event"}-${id.slice(0, 8)}`;
  await database.batch([
    database.prepare(`INSERT INTO market_ticket_events
      (id,organizer_profile_id,slug,title,summary,venue_name,starts_at,ends_at,timezone,sale_starts_at,sale_ends_at,status,max_per_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,? ,?,?,'published',?,?,?)`)
      .bind(id, organizerProfileId, slug, title, summary, venueName, new Date(startsAt).toISOString(), new Date(endsAt).toISOString(),
        "Asia/Tokyo", new Date(saleStartsAt).toISOString(), new Date(saleEndsAt).toISOString(), maxPerOrder, now, now),
    database.prepare(`INSERT INTO market_ticket_types
      (id,event_id,name,price_minor,currency,total_quantity,reserved_quantity,sold_quantity,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,0,0,'available',?,?)`)
      .bind(typeId, id, ticketName, priceMinor, "JPY", totalQuantity, now, now),
  ]);
  return { id, slug };
}

export async function holdMarketTickets(database: D1Database, buyerProfileId: string, input: Record<string, unknown>) {
  await releaseExpiredMarketTicketHolds(database);
  const ticketTypeId = text(input.ticketTypeId, 80);
  const quantity = Number(input.quantity);
  const row = await database.prepare(`SELECT t.event_id eventId, t.price_minor priceMinor, t.currency,
      t.total_quantity totalQuantity, t.reserved_quantity reservedQuantity, t.sold_quantity soldQuantity,
      t.status, e.max_per_order maxPerOrder, e.status eventStatus, e.sale_starts_at saleStartsAt, e.sale_ends_at saleEndsAt
    FROM market_ticket_types t JOIN market_ticket_events e ON e.id=t.event_id WHERE t.id=?`)
    .bind(ticketTypeId).first<Record<string, string | number>>();
  const now = new Date();
  if (!row || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > Number(row.maxPerOrder) ||
      row.status !== "available" || row.eventStatus !== "published" ||
      now < new Date(String(row.saleStartsAt)) || now > new Date(String(row.saleEndsAt))) {
    throw new Error("ticket_unavailable");
  }
  const remaining = Number(row.totalQuantity) - Number(row.reservedQuantity) - Number(row.soldQuantity);
  if (remaining < quantity) throw new Error("ticket_sold_out");
  const id = crypto.randomUUID();
  const createdAt = now.toISOString();
  const holdExpiresAt = new Date(now.getTime() + 10 * 60_000).toISOString();
  const totalMinor = Number(row.priceMinor) * quantity;
  const results = await database.batch([
    database.prepare(`INSERT INTO market_ticket_reservations
      (id,event_id,ticket_type_id,buyer_profile_id,quantity,total_minor,currency,status,hold_expires_at,created_at,updated_at)
      SELECT ?,?,?,?,?,?,?,'held',?,?,? WHERE EXISTS (
        SELECT 1 FROM market_ticket_types
        WHERE id=? AND status='available' AND total_quantity-reserved_quantity-sold_quantity>=?
      )`).bind(id, row.eventId, ticketTypeId, buyerProfileId, quantity, totalMinor, row.currency, holdExpiresAt, createdAt, createdAt, ticketTypeId, quantity),
    database.prepare(`UPDATE market_ticket_types SET reserved_quantity=reserved_quantity+?, updated_at=?
      WHERE id=? AND EXISTS (SELECT 1 FROM market_ticket_reservations WHERE id=?)`)
      .bind(quantity, createdAt, ticketTypeId, id),
  ]);
  if (!results[0].meta.changes) throw new Error("ticket_sold_out");
  return { id, quantity, totalMinor, currency: String(row.currency), status: "held", holdExpiresAt };
}

export async function listMarketTicketReservations(
  database: D1Database,
  buyerProfileId: string,
): Promise<MarketTicketReservation[]> {
  await releaseExpiredMarketTicketHolds(database);
  const result = await database.prepare(`SELECT
      r.id, e.title eventTitle, t.name ticketTypeName, r.quantity,
      r.total_minor totalMinor, r.currency, r.status,
      r.hold_expires_at holdExpiresAt, r.created_at createdAt,
      i.chain_id chainId, i.contract_address contractAddress,
      i.token_id tokenId, i.transaction_hash transactionHash, i.status tokenStatus,
      f.status refundStatus
    FROM market_ticket_reservations r
    JOIN market_ticket_events e ON e.id=r.event_id
    JOIN market_ticket_types t ON t.id=r.ticket_type_id
    LEFT JOIN market_ticket_token_issuances i ON i.reservation_id=r.id
    LEFT JOIN market_ticket_refund_requests f ON f.reservation_id=r.id
    WHERE r.buyer_profile_id=?
    ORDER BY r.created_at DESC
    LIMIT 50`).bind(buyerProfileId).all<MarketTicketReservationRow>();
  return result.results.map((row) => ({
    id: row.id,
    eventTitle: row.eventTitle,
    ticketTypeName: row.ticketTypeName,
    quantity: row.quantity,
    totalMinor: row.totalMinor,
    currency: row.currency,
    status: row.status,
    holdExpiresAt: row.holdExpiresAt,
    createdAt: row.createdAt,
    token: row.chainId && row.contractAddress && row.tokenId && row.transactionHash && row.tokenStatus
      ? {
          chainId: row.chainId,
          contractAddress: row.contractAddress,
          tokenId: row.tokenId,
          transactionHash: row.transactionHash,
          status: row.tokenStatus,
        }
      : null,
    refundStatus: row.refundStatus,
  }));
}

export async function requestMarketTicketRefund(
  database: D1Database,
  buyerProfileId: string,
  reservationId: string,
) {
  const now = new Date().toISOString();
  const reservation = await database.prepare(`SELECT
      r.id, r.ticket_type_id ticketTypeId, r.quantity, r.status,
      e.starts_at startsAt, i.status tokenStatus
    FROM market_ticket_reservations r
    JOIN market_ticket_events e ON e.id=r.event_id
    LEFT JOIN market_ticket_token_issuances i ON i.reservation_id=r.id
    WHERE r.id=? AND r.buyer_profile_id=?`)
    .bind(reservationId, buyerProfileId)
    .first<Record<string, string | number | null>>();
  if (!reservation) throw new Error("ticket_reservation_not_found");
  if (new Date(String(reservation.startsAt)) <= new Date(now)) {
    throw new Error("ticket_refund_closed");
  }

  if (reservation.status === "held") {
    await database.batch([
      database.prepare(`UPDATE market_ticket_types
        SET reserved_quantity=MAX(0,reserved_quantity-?), updated_at=?
        WHERE id=? AND EXISTS (
          SELECT 1 FROM market_ticket_reservations
          WHERE id=? AND buyer_profile_id=? AND status='held'
        )`).bind(reservation.quantity, now, reservation.ticketTypeId, reservationId, buyerProfileId),
      database.prepare(`UPDATE market_ticket_reservations
        SET status='cancelled', updated_at=?
        WHERE id=? AND buyer_profile_id=? AND status='held'`)
        .bind(now, reservationId, buyerProfileId),
    ]);
    return { status: "cancelled", requiresBurn: false };
  }

  if (reservation.status !== "issued" || reservation.tokenStatus !== "issued") {
    throw new Error("ticket_refund_unavailable");
  }
  const id = crypto.randomUUID();
  await database.prepare(`INSERT INTO market_ticket_refund_requests
      (id,reservation_id,buyer_profile_id,status,requested_at,updated_at)
    VALUES(?,?,?,'burn_pending',?,?)
    ON CONFLICT(reservation_id) DO NOTHING`)
    .bind(id, reservationId, buyerProfileId, now, now)
    .run();
  return { status: "burn_pending", requiresBurn: true };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createMarketTicketCheckinChallenge(
  database: D1Database,
  organizerProfileId: string,
  eventId: string,
) {
  const event = await database.prepare(`SELECT id FROM market_ticket_events
    WHERE id=? AND organizer_profile_id=? AND status='published'`)
    .bind(eventId, organizerProfileId).first<{ id: string }>();
  if (!event) throw new Error("ticket_gate_forbidden");
  const id = crypto.randomUUID();
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 60_000).toISOString();
  await database.prepare(`INSERT INTO market_ticket_checkin_challenges
      (id,event_id,organizer_profile_id,nonce_hash,expires_at,created_at)
    VALUES(?,?,?,?,?,?)`)
    .bind(id, eventId, organizerProfileId, await sha256(nonce), expiresAt, now.toISOString())
    .run();
  return { id, nonce, expiresAt };
}

export async function redeemMarketTicketCheckinChallenge(
  database: D1Database,
  buyerProfileId: string,
  challengeId: string,
  nonce: string,
) {
  const now = new Date().toISOString();
  const nonceHash = await sha256(nonce);
  const reservation = await database.prepare(`SELECT
      r.id reservationId, r.event_id eventId, i.token_id tokenId
    FROM market_ticket_checkin_challenges c
    JOIN market_ticket_reservations r
      ON r.event_id=c.event_id AND r.buyer_profile_id=? AND r.status='issued'
    JOIN market_ticket_token_issuances i
      ON i.reservation_id=r.id AND i.status='issued'
    LEFT JOIN market_ticket_refund_requests f ON f.reservation_id=r.id
    WHERE c.id=? AND c.nonce_hash=? AND c.used_at IS NULL AND c.expires_at>?
      AND (f.id IS NULL OR f.status IN ('rejected','failed'))
    LIMIT 1`).bind(buyerProfileId, challengeId, nonceHash, now)
    .first<{ reservationId: string; eventId: string; tokenId: string }>();
  if (!reservation) throw new Error("ticket_checkin_denied");
  const checkinId = crypto.randomUUID();
  const results = await database.batch([
    database.prepare(`UPDATE market_ticket_checkin_challenges SET used_at=?
      WHERE id=? AND nonce_hash=? AND used_at IS NULL AND expires_at>?`)
      .bind(now, challengeId, nonceHash, now),
    database.prepare(`INSERT INTO market_ticket_checkins
        (id,event_id,reservation_id,token_id,challenge_id,checked_in_at)
      SELECT ?,?,?,?,?,? WHERE EXISTS (
        SELECT 1 FROM market_ticket_checkin_challenges WHERE id=? AND used_at=?
      ) AND NOT EXISTS (
        SELECT 1 FROM market_ticket_checkins WHERE reservation_id=?
      )`).bind(checkinId, reservation.eventId, reservation.reservationId, reservation.tokenId,
        challengeId, now, challengeId, now, reservation.reservationId),
  ]);
  if (!results[0].meta.changes || !results[1].meta.changes) throw new Error("ticket_checkin_denied");
  return { status: "admitted", checkedInAt: now };
}
