import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import {
  WORK_ACCEPT_DAYS,
  WORK_MAX_DELIVERY_FILES,
  WORK_MAX_OPEN_PER_CLIENT,
  WORK_MAX_UNFUNDED_PER_DAY,
  WORK_THREAD_CLOSE_DAYS,
  WorkInputError,
  canAdvanceWorkState,
  clientRestricted,
  isTerminalWorkState,
  isWorkEscrowState,
  looksLikeEmployment,
  looksLikeOffPlatformPayment,
  parseWorkMessageBody,
  parseWorkOfferSettings,
  parseWorkRequestInput,
  workDeliveryHash,
  workTicketAllowed,
  type WorkAudience,
  type WorkDeliveryFile,
  type WorkEscrowState,
  type WorkSide,
  type WorkTicketPurpose,
} from "@/lib/work-commissions";
import { getD1AdultOptIn } from "@/lib/server/d1-adult-opt-in";
import {
  readFileBody,
  sendTicketed,
  unpublishContentFileIds,
  type ContentFileDeps,
} from "@/lib/server/content-files";
import { isHubFileId, signHubFileTicket } from "@/lib/server/hub-file-ticket";
import { hasD1BlockBetween } from "@/lib/server/profile-blocks";
import {
  WORK_CONTRACT_ID,
  burnWorkStateJti,
  lookupWorkEscrowState,
  type WorkStateLookupDeps,
} from "@/lib/server/work-escrow-state";
import { signWorkCommerceTicket } from "@/lib/server/work-commerce-ticket";
import { notifyWorkStateChange } from "@/lib/server/work-maintenance";

/*
 * 指名依頼 (DESIGN 2, 3, 6, 7, 8; owner approved 2026-10-29).
 *
 * Hub keeps the request, the offer settings, the thread, the delivery list and the public-display choice.
 * It never stores a wallet, a transaction hash or a Commerce identifier, and it never moves money: the
 * contract's state only changes from Commerce's signed state reply (syncWorkContractState). A request is
 * invisible to the worker until that reply says the escrow is funded.
 */

const DAY = 86_400_000;
const STATE_CACHE_MS = 10_000;

const randomContractId = () => [...crypto.getRandomValues(new Uint8Array(16))].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/* ------------------------------------------------------------------ offer */

export type WorkOffer = {
  accepting: boolean;
  minPriceUnits: number;
  priceNote: string;
  acceptsText: string;
  refusesText: string;
  turnaroundDays: number;
  categories: string[];
  adultAllowed: boolean;
  maxOpen: number;
};

type OfferRow = {
  accepting: number; min_price_units: number; price_note: string; accepts_text: string; refuses_text: string;
  turnaround_days: number; categories_json: string; adult_allowed: number; max_open: number;
};

export const DEFAULT_WORK_OFFER: WorkOffer = {
  accepting: false, minPriceUnits: 1000, priceNote: "", acceptsText: "", refusesText: "",
  turnaroundDays: 7, categories: [], adultAllowed: false, maxOpen: 3,
};

function offerFromRow(row: OfferRow): WorkOffer {
  let categories: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.categories_json);
    categories = Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    categories = [];
  }
  return {
    accepting: row.accepting === 1, minPriceUnits: row.min_price_units, priceNote: row.price_note,
    acceptsText: row.accepts_text, refusesText: row.refuses_text, turnaroundDays: row.turnaround_days,
    categories, adultAllowed: row.adult_allowed === 1, maxOpen: row.max_open,
  };
}

export async function getWorkOffer(database: D1Database, profileId: string): Promise<WorkOffer> {
  const row = await database.prepare("SELECT accepting, min_price_units, price_note, accepts_text, refuses_text, turnaround_days, categories_json, adult_allowed, max_open FROM work_offer_settings WHERE profile_id = ?")
    .bind(profileId).first<OfferRow>();
  return row ? offerFromRow(row) : { ...DEFAULT_WORK_OFFER };
}

/** Adult acceptance follows the existing NSFW policy: the worker must already be in profile_adult_opt_in. */
export async function saveWorkOffer(database: D1Database, profileId: string, raw: Record<string, unknown>, now = new Date()): Promise<WorkOffer> {
  const input = parseWorkOfferSettings(raw);
  if (input.adultAllowed && !(await getD1AdultOptIn(database, profileId)).enabled) {
    throw new WorkInputError("adult_opt_in_required", "成人向けを受けるには、先に成人向け表示を有効にしてください。", 409);
  }
  const text = `${input.priceNote}\n${input.acceptsText}`;
  if (looksLikeEmployment(text)) {
    throw new WorkInputError("employment_not_supported", "時給・勤務時間などの雇用に近い内容は、依頼として受け付けられません。");
  }
  await database.prepare(`INSERT INTO work_offer_settings (profile_id, accepting, min_price_units, price_note, accepts_text, refuses_text,
      turnaround_days, categories_json, adult_allowed, max_open, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(profile_id) DO UPDATE SET accepting = excluded.accepting, min_price_units = excluded.min_price_units,
      price_note = excluded.price_note, accepts_text = excluded.accepts_text, refuses_text = excluded.refuses_text,
      turnaround_days = excluded.turnaround_days, categories_json = excluded.categories_json,
      adult_allowed = excluded.adult_allowed, max_open = excluded.max_open, updated_at = excluded.updated_at`)
    .bind(profileId, input.accepting ? 1 : 0, input.minPriceUnits, input.priceNote, input.acceptsText, input.refusesText,
      input.turnaroundDays, JSON.stringify(input.categories), input.adultAllowed ? 1 : 0, input.maxOpen, now.toISOString())
    .run();
  return getWorkOffer(database, profileId);
}

export type PublicWorkOffer = {
  profile: { id: string; handle: string; displayName: string };
  offer: WorkOffer;
  completed: number;
  openCount: number;
  full: boolean;
};

async function openContractCount(database: D1Database, workerId: string): Promise<number> {
  const row = await database.prepare("SELECT count(*) AS n FROM work_contracts WHERE worker_profile_id = ? AND escrow_state IN ('funded', 'accepted', 'delivered', 'flagged')")
    .bind(workerId).first<{ n: number }>();
  return row?.n ?? 0;
}

async function workerProfile(database: D1Database, handle: string) {
  return database.prepare(`SELECT p.id, p.handle, p.display_name FROM profiles p
      WHERE p.handle = ? COLLATE NOCASE AND p.kind = 'local' AND p.deleted_at IS NULL
        AND NOT EXISTS (SELECT 1 FROM profile_moderation_status s WHERE s.profile_id = p.id AND s.status = 'suspended')
      LIMIT 1`).bind(handle).first<{ id: string; handle: string; display_name: string }>();
}

export async function getPublicWorkOffer(database: D1Database, handle: string): Promise<PublicWorkOffer | null> {
  const profile = await workerProfile(database, handle);
  if (!profile) return null;
  const [offer, completed, openCount] = await Promise.all([
    getWorkOffer(database, profile.id),
    database.prepare("SELECT count(*) AS n FROM work_contracts WHERE worker_profile_id = ? AND escrow_state = 'released'").bind(profile.id).first<{ n: number }>(),
    openContractCount(database, profile.id),
  ]);
  return {
    profile: { id: profile.id, handle: profile.handle, displayName: profile.display_name },
    offer,
    completed: completed?.n ?? 0,
    openCount,
    full: openCount >= offer.maxOpen,
  };
}

/* ---------------------------------------------------------------- request */

async function hasAdultCredential(database: D1Database, profileId: string, now: Date): Promise<boolean> {
  const row = await database.prepare("SELECT 1 AS ok FROM hub_selective_credentials WHERE profile_id = ? AND credential_type = 'adult_verified' AND expires_at > ? LIMIT 1")
    .bind(profileId, now.toISOString()).first<{ ok: number }>();
  return Boolean(row);
}

export async function getWorkClientStats(database: D1Database, profileId: string): Promise<{ completed: number; refundedAfterFlag: number }> {
  const row = await database.prepare("SELECT completed, refunded_after_flag FROM work_client_stats WHERE profile_id = ?")
    .bind(profileId).first<{ completed: number; refunded_after_flag: number }>();
  return { completed: row?.completed ?? 0, refundedAfterFlag: row?.refunded_after_flag ?? 0 };
}

/** Creates the request and its contract (unfunded). The worker cannot see either until the escrow is funded. */
export async function createWorkRequest(
  database: D1Database,
  clientId: string,
  raw: Record<string, unknown>,
  now = new Date(),
): Promise<{ contractId: string; requestId: string }> {
  const input = parseWorkRequestInput(raw);
  const worker = await workerProfile(database, input.workerHandle);
  // Blocks never reveal themselves: the same answer as "not accepting".
  if (!worker || worker.id === clientId || await hasD1BlockBetween(database, clientId, worker.id)) {
    throw new WorkInputError("unavailable", "この相手には依頼できません。", 403);
  }
  const offer = await getWorkOffer(database, worker.id);
  if (!offer.accepting) throw new WorkInputError("not_accepting", "この作り手は、いま依頼を受け付けていません。", 409);
  if (input.budgetUnits < offer.minPriceUnits) {
    throw new WorkInputError("below_minimum", `最低額（${offer.minPriceUnits}）以上で入力してください。`, 400);
  }
  if (offer.categories.length && !offer.categories.includes(input.category)) {
    throw new WorkInputError("category_not_accepted", "この作り手が受けている種類から選んでください。", 400);
  }
  if (looksLikeEmployment(`${input.title}\n${input.brief}`)) {
    throw new WorkInputError("employment_not_supported", "時給・勤務時間などの雇用に近い内容は、依頼として受け付けられません。");
  }
  if ((await openContractCount(database, worker.id)) >= offer.maxOpen) {
    throw new WorkInputError("worker_full", "この作り手は、同時に受けられる数に達しています。", 409);
  }
  if (input.audience === "adult") {
    const ok = offer.adultAllowed
      && (await getD1AdultOptIn(database, worker.id)).enabled
      && await hasAdultCredential(database, clientId, now);
    if (!ok) throw new WorkInputError("adult_not_allowed", "成人向けの依頼は、双方の条件が揃っているときだけ作れます。", 403);
  }
  if (clientRestricted(await getWorkClientStats(database, clientId))) {
    throw new WorkInputError("client_restricted", "いまは新しい依頼を作れません。", 403);
  }
  const since = new Date(now.getTime() - DAY).toISOString();
  const unfunded = await database.prepare("SELECT count(*) AS n FROM work_contracts WHERE client_profile_id = ? AND escrow_state = 'pending_funding' AND created_at > ?")
    .bind(clientId, since).first<{ n: number }>();
  if ((unfunded?.n ?? 0) >= WORK_MAX_UNFUNDED_PER_DAY) {
    throw new WorkInputError("too_many_unfunded", "未入金の依頼は1日5件までです。", 429);
  }
  const open = await database.prepare("SELECT count(*) AS n FROM work_contracts WHERE client_profile_id = ? AND escrow_state NOT IN ('released', 'refunded')")
    .bind(clientId).first<{ n: number }>();
  if ((open?.n ?? 0) >= WORK_MAX_OPEN_PER_CLIENT) {
    throw new WorkInputError("too_many_open", "未完了の契約は同時に10件までです。", 429);
  }

  const requestId = crypto.randomUUID();
  const contractId = randomContractId();
  const created = now.toISOString();
  await database.batch([
    database.prepare(`INSERT INTO work_requests (id, mode, client_profile_id, worker_profile_id, category, title, brief, audience, budget_units, status, created_at)
      VALUES (?, 'direct', ?, ?, ?, ?, ?, ?, ?, 'open', ?)`)
      .bind(requestId, clientId, worker.id, input.category, input.title, input.brief, input.audience, input.budgetUnits, created),
    database.prepare(`INSERT INTO work_contracts (id, request_id, client_profile_id, worker_profile_id, price_units, turnaround_days,
        milestone_no, escrow_state, audience, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, 'pending_funding', ?, ?)`)
      .bind(contractId, requestId, clientId, worker.id, input.budgetUnits, offer.turnaroundDays, input.audience, created),
  ]);
  return { contractId, requestId };
}

/* ------------------------------------------------------------------- read */

export type WorkListItem = {
  contractId: string;
  title: string;
  category: string;
  priceUnits: number;
  state: WorkEscrowState;
  audience: WorkAudience;
  otherHandle: string;
  otherName: string;
  createdAt: string;
};

type ListRow = {
  id: string; title: string; category: string; price_units: number; escrow_state: string; audience: string;
  handle: string; display_name: string; created_at: string;
};

/** side=worker lists funded-or-later contracts only; an unfunded request does not exist for the worker. */
export async function listWorkContracts(database: D1Database, viewerId: string, side: WorkSide, limit = 100): Promise<WorkListItem[]> {
  const mine = side === "client" ? "c.client_profile_id" : "c.worker_profile_id";
  const other = side === "client" ? "c.worker_profile_id" : "c.client_profile_id";
  const hidden = side === "worker" ? "c.escrow_state = 'pending_funding'" : "0";
  const rows = await database.prepare(`SELECT c.id, CASE WHEN ${hidden} THEN '' ELSE r.title END AS title, CASE WHEN ${hidden} THEN '' ELSE r.category END AS category, CASE WHEN ${hidden} THEN 0 ELSE c.price_units END AS price_units, c.escrow_state, c.audience, p.handle, p.display_name, c.created_at
      FROM work_contracts c JOIN work_requests r ON r.id = c.request_id JOIN profiles p ON p.id = ${other}
      WHERE ${mine} = ? ORDER BY c.created_at DESC, c.id LIMIT ?`)
    .bind(viewerId, Math.min(limit, 200)).all<ListRow>();
  return rows.results.filter((row) => isWorkEscrowState(row.escrow_state)).map((row) => ({
    contractId: row.id, title: row.title, category: row.category, priceUnits: row.price_units,
    state: row.escrow_state as WorkEscrowState, audience: row.audience === "adult" ? "adult" : "general",
    otherHandle: side === "worker" && row.escrow_state === "pending_funding" ? "" : row.handle,
    otherName: side === "worker" && row.escrow_state === "pending_funding" ? "（入金前のため非表示）" : row.display_name,
    createdAt: row.created_at,
  }));
}

type ContractRow = {
  id: string; request_id: string; client_profile_id: string; worker_profile_id: string; price_units: number;
  turnaround_days: number; escrow_state: string; accept_deadline: string | null; deliver_deadline: string | null;
  release_at: string | null; flag_until: string | null; chain_delivery_hash: string | null; state_checked_at: string | null; closed_at: string | null;
  publication: string; worker_listed: number; audience: string; created_at: string;
};

async function readContract(database: D1Database, contractId: string): Promise<ContractRow | null> {
  if (!WORK_CONTRACT_ID.test(contractId)) return null;
  return database.prepare("SELECT * FROM work_contracts WHERE id = ?").bind(contractId).first<ContractRow>();
}

/** The party check. The worker gets null for an unfunded contract, exactly like a missing one. */
async function readPartyContract(database: D1Database, viewerId: string, contractId: string): Promise<{ row: ContractRow; side: WorkSide } | null> {
  const row = await readContract(database, contractId);
  if (!row || !isWorkEscrowState(row.escrow_state)) return null;
  if (row.client_profile_id === viewerId) return { row, side: "client" };
  if (row.worker_profile_id === viewerId) return { row, side: "worker" };
  return null;
}

export type WorkMessage = { id: string; mine: boolean; body: string; flagged: boolean; createdAt: string };

export type WorkContractView = {
  contractId: string;
  side: WorkSide;
  state: WorkEscrowState;
  title: string;
  category: string;
  brief: string;
  audience: WorkAudience;
  priceUnits: number;
  turnaroundDays: number;
  acceptBy: string | null;
  deliverBy: string | null;
  releaseAt: string | null;
  flagUntil: string | null;
  closedAt: string | null;
  otherHandle: string;
  otherName: string;
  publication: "private" | "public";
  workerListed: boolean;
  delivery: { files: Array<{ id: string; name: string; size: number; sha256: string }>; hash: string; deliveredAt: string } | null;
  /** Shown to the worker before accepting (DESIGN 7.4). */
  clientStats: { completed: number; refundedAfterFlag: number } | null;
  messages: WorkMessage[];
  threadWritable: boolean;
  actions: WorkTicketPurpose[];
  /** Chain says delivered, but its fingerprint is not the one of a Hub delivery (納品の不一致). */
  deliveryMismatch: boolean;
  canDownload: boolean;
  createdAt: string;
};

function threadWritable(row: ContractRow, now: Date): boolean {
  const state = row.escrow_state as WorkEscrowState;
  if (state === "pending_funding") return false;
  if (!isTerminalWorkState(state)) return true;
  return row.closed_at !== null && now.getTime() < new Date(row.closed_at).getTime() + WORK_THREAD_CLOSE_DAYS * DAY;
}

export async function readWorkDelivery(database: D1Database, contractId: string) {
  const row = await database.prepare("SELECT files_json, delivery_hash, delivered_at FROM work_deliveries WHERE contract_id = ?")
    .bind(contractId).first<{ files_json: string; delivery_hash: string; delivered_at: string }>();
  if (!row) return null;
  let files: WorkDeliveryFile[] = [];
  try {
    const parsed: unknown = JSON.parse(row.files_json);
    if (Array.isArray(parsed)) files = parsed.filter((entry): entry is WorkDeliveryFile => Boolean(entry) && typeof entry === "object" && typeof (entry as WorkDeliveryFile).id === "string");
  } catch {
    files = [];
  }
  return { files, hash: row.delivery_hash, deliveredAt: row.delivered_at };
}

export async function getWorkContractView(database: D1Database, viewerId: string, contractId: string, now = new Date()): Promise<WorkContractView | null> {
  const party = await readPartyContract(database, viewerId, contractId);
  if (!party) return null;
  const { row, side } = party;
  const state = row.escrow_state as WorkEscrowState;
  const request = await database.prepare("SELECT title, category, brief FROM work_requests WHERE id = ?").bind(row.request_id)
    .first<{ title: string; category: string; brief: string }>();
  const otherId = side === "client" ? row.worker_profile_id : row.client_profile_id;
  const other = await database.prepare("SELECT handle, display_name FROM profiles WHERE id = ?").bind(otherId)
    .first<{ handle: string; display_name: string }>();
  if (!request || !other) return null;
  // Before the escrow is funded the worker sees only that a request exists, and can bind the receiving address (bind).
  const veiled = side === "worker" && state === "pending_funding";
  const messages = await database.prepare("SELECT id, sender_profile_id, body, flagged_payment_redirect, created_at FROM work_thread_messages WHERE contract_id = ? ORDER BY created_at, id LIMIT 500")
    .bind(contractId).all<{ id: string; sender_profile_id: string; body: string; flagged_payment_redirect: number; created_at: string }>();
  const delivery = await readWorkDelivery(database, contractId);
  const facts = {
    state, deliverySealed: Boolean(delivery), flagUntil: row.flag_until, releaseAt: row.release_at,
    acceptBy: row.accept_deadline, deliverBy: row.deliver_deadline,
  };
  const mismatch = state === "delivered" && (!delivery || row.chain_delivery_hash !== delivery.hash);
  const purposes: WorkTicketPurpose[] = ["bind", "fund", "accept", "decline", "deliver", "confirm", "flag"];
  return {
    contractId, side, state,
    title: veiled ? "" : request.title, category: veiled ? "" : request.category, brief: veiled ? "" : request.brief,
    audience: row.audience === "adult" ? "adult" : "general",
    priceUnits: veiled ? 0 : row.price_units, turnaroundDays: row.turnaround_days,
    acceptBy: row.accept_deadline, deliverBy: row.deliver_deadline, releaseAt: row.release_at, flagUntil: row.flag_until, closedAt: row.closed_at,
    otherHandle: veiled ? "" : other.handle, otherName: veiled ? "（入金前のため非表示）" : other.display_name,
    publication: row.publication === "public" ? "public" : "private",
    workerListed: row.worker_listed === 1,
    delivery: delivery ? { files: delivery.files.map((file) => ({ id: file.id, name: file.name, size: file.size, sha256: file.sha256 })), hash: delivery.hash, deliveredAt: delivery.deliveredAt } : null,
    clientStats: side === "worker" && !veiled ? await getWorkClientStats(database, row.client_profile_id) : null,
    messages: messages.results.map((message) => ({
      id: message.id, mine: message.sender_profile_id === viewerId, body: message.body,
      flagged: message.flagged_payment_redirect === 1, createdAt: message.created_at,
    })),
    threadWritable: threadWritable(row, now),
    actions: purposes.filter((purpose) => workTicketAllowed(side, purpose, facts, now) && !(mismatch && purpose === "confirm")),
    deliveryMismatch: mismatch,
    canDownload: Boolean(delivery) && (side === "worker" || state === "released"),
    createdAt: row.created_at,
  };
}

/* ----------------------------------------------------------------- thread */

export async function addWorkMessage(database: D1Database, viewerId: string, contractId: string, rawBody: unknown, now = new Date()): Promise<{ id: string; flagged: boolean }> {
  const body = parseWorkMessageBody(rawBody);
  const party = await readPartyContract(database, viewerId, contractId);
  if (!party) throw new WorkInputError("not_found", "契約が見つかりません。", 404);
  if (!threadWritable(party.row, now)) throw new WorkInputError("thread_closed", "このスレッドには、いま書き込めません。", 409);
  const otherId = party.side === "client" ? party.row.worker_profile_id : party.row.client_profile_id;
  if (await hasD1BlockBetween(database, viewerId, otherId)) throw new WorkInputError("unavailable", "このスレッドには、いま書き込めません。", 403);
  const count = await database.prepare("SELECT count(*) AS n FROM work_thread_messages WHERE contract_id = ? AND sender_profile_id = ? AND created_at > ?")
    .bind(contractId, viewerId, new Date(now.getTime() - 3_600_000).toISOString()).first<{ n: number }>();
  if ((count?.n ?? 0) >= 30) throw new WorkInputError("rate_limited", "短い時間に書き込みすぎです。少し待ってください。", 429);
  const id = crypto.randomUUID();
  const flagged = looksLikeOffPlatformPayment(body);
  await database.prepare("INSERT INTO work_thread_messages (id, contract_id, sender_profile_id, body, flagged_payment_redirect, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, contractId, viewerId, body, flagged ? 1 : 0, now.toISOString()).run();
  return { id, flagged };
}

/* ------------------------------------------------------------ publication */

/** The client chooses after release; adult work is never public. The worker then chooses whether to list it. */
export async function setWorkPublication(
  database: D1Database,
  viewerId: string,
  contractId: string,
  input: { publication?: unknown; listed?: unknown },
): Promise<void> {
  const party = await readPartyContract(database, viewerId, contractId);
  if (!party) throw new WorkInputError("not_found", "契約が見つかりません。", 404);
  const { row, side } = party;
  if (row.escrow_state !== "released") throw new WorkInputError("not_released", "公開の選択は、完了したあとにできます。", 409);
  if (side === "client") {
    if (input.publication !== "private" && input.publication !== "public") throw new WorkInputError("invalid_input", "公開の指定が正しくありません。");
    if (input.publication === "public" && row.audience === "adult") throw new WorkInputError("adult_never_public", "成人向けの依頼は公開できません。", 409);
    await database.prepare("UPDATE work_contracts SET publication = ?, worker_listed = CASE WHEN ? = 'private' THEN 0 ELSE worker_listed END WHERE id = ? AND client_profile_id = ?")
      .bind(input.publication, input.publication, contractId, viewerId).run();
    return;
  }
  if (typeof input.listed !== "boolean") throw new WorkInputError("invalid_input", "掲載の指定が正しくありません。");
  if (input.listed && row.publication !== "public") throw new WorkInputError("not_public", "依頼者が公開を選んだときだけ、作品一覧に載せられます。", 409);
  await database.prepare("UPDATE work_contracts SET worker_listed = ? WHERE id = ? AND worker_profile_id = ?")
    .bind(input.listed ? 1 : 0, contractId, viewerId).run();
}

/* ------------------------------------------------------- state from Commerce */

export type WorkSyncResult = { state: WorkEscrowState; checking: boolean };

/**
 * Reads Commerce's signed state and moves the contract forward when, and only when, the reply verifies, has not been
 * seen before, and is not older than what Hub already knows. Any failure keeps the last good state and reports
 * `checking: true`, so no action is offered on unverified information. Never throws.
 */
export async function syncWorkContractState(
  database: D1Database,
  contractId: string,
  lookup: WorkStateLookupDeps,
  fileDeps: ContentFileDeps | null,
  now = new Date(),
): Promise<WorkSyncResult | null> {
  try {
    const row = await readContract(database, contractId);
    if (!row || !isWorkEscrowState(row.escrow_state)) return null;
    const from = row.escrow_state;
    if (isTerminalWorkState(from)) return { state: from, checking: false };
    if (row.state_checked_at && now.getTime() - new Date(row.state_checked_at).getTime() < STATE_CACHE_MS) {
      return { state: from, checking: false };
    }
    const answer = await lookupWorkEscrowState(contractId, { ...lookup, now: () => now });
    if (answer.status === "unavailable") return { state: from, checking: true };
    const checkedAt = now.toISOString();
    if (answer.status === "unfunded" || answer.proof.state === "pending_funding") {
      await database.prepare("UPDATE work_contracts SET state_checked_at = ? WHERE id = ?").bind(checkedAt, contractId).run();
      return { state: from, checking: false };
    }
    const { proof } = answer;
    if (proof.state === "checking") return { state: from, checking: true };
    if (!(await burnWorkStateJti(database, proof.jti, proof.exp, now))) return { state: from, checking: true };
    const to = proof.state;
    if (!canAdvanceWorkState(from, to)) return { state: from, checking: true };
    const terminal = isTerminalWorkState(to);
    const changed = await database.prepare(`UPDATE work_contracts SET escrow_state = ?, accept_deadline = ?, deliver_deadline = ?, release_at = ?, flag_until = ?, chain_delivery_hash = COALESCE(?, chain_delivery_hash),
        state_checked_at = ?, closed_at = CASE WHEN ? = 1 THEN COALESCE(closed_at, ?) ELSE closed_at END
      WHERE id = ? AND escrow_state = ?`)
      .bind(to, proof.acceptBy, proof.deliverBy, proof.releaseAt, proof.flagUntil, proof.deliveryHash, checkedAt, terminal ? 1 : 0, checkedAt, contractId, from).run();
    if ((changed.meta?.changes ?? 0) === 1 && from !== to) {
      await notifyWorkStateChange(database, { contractId, clientId: row.client_profile_id, workerId: row.worker_profile_id }, from, to, checkedAt);
      if (to === "released") {
        await bumpClientStats(database, row.client_profile_id, "completed", checkedAt);
      } else if (to === "refunded" && (from === "flagged" || row.flag_until !== null || proof.flagUntil !== null)) {
        await bumpClientStats(database, row.client_profile_id, "refunded_after_flag", checkedAt);
      }
      if (to === "refunded" && fileDeps) {
        // A refunded delivery was never handed over (DESIGN 6.3): close its files at the component.
        const delivery = await readWorkDelivery(database, contractId);
        if (delivery) await unpublishContentFileIds(database, fileDeps, delivery.files.map((file) => file.id)).catch(() => undefined);
      }
    }
    return { state: to, checking: false };
  } catch {
    return null;
  }
}

async function bumpClientStats(database: D1Database, profileId: string, column: "completed" | "refunded_after_flag", at: string) {
  const sql = column === "completed"
    ? `INSERT INTO work_client_stats (profile_id, completed, refunded_after_flag, updated_at) VALUES (?, 1, 0, ?)
       ON CONFLICT(profile_id) DO UPDATE SET completed = completed + 1, updated_at = excluded.updated_at`
    : `INSERT INTO work_client_stats (profile_id, completed, refunded_after_flag, updated_at) VALUES (?, 0, 1, ?)
       ON CONFLICT(profile_id) DO UPDATE SET refunded_after_flag = refunded_after_flag + 1, updated_at = excluded.updated_at`;
  await database.prepare(sql).bind(profileId, at).run();
}

/* ------------------------------------------------------- Commerce hand-off */

/**
 * Signs a `jkamma-commerce-work` ticket only after Hub has checked that the caller is the right side, that the
 * state allows the action, and that the conditions (adult, accepting) still hold. The state used here is the
 * last verified Commerce state, so call syncWorkContractState first.
 */
export async function issueWorkCommerceTicket(
  database: D1Database,
  viewerId: string,
  contractId: string,
  purposeInput: unknown,
  privateKeyPkcs8: string | null | undefined,
  now = new Date(),
) {
  const party = await readPartyContract(database, viewerId, contractId);
  if (!party) throw new WorkInputError("not_found", "契約が見つかりません。", 404);
  const purpose = ["bind", "fund", "accept", "decline", "deliver", "confirm", "flag"].includes(String(purposeInput)) ? purposeInput as WorkTicketPurpose : null;
  if (!purpose) throw new WorkInputError("invalid_input", "操作の指定が正しくありません。");
  const { row, side } = party;
  const delivery = await readWorkDelivery(database, contractId);
  const allowed = workTicketAllowed(side, purpose, {
    state: row.escrow_state as WorkEscrowState, deliverySealed: Boolean(delivery), flagUntil: row.flag_until,
    releaseAt: row.release_at, acceptBy: row.accept_deadline, deliverBy: row.deliver_deadline,
  }, now);
  if (!allowed) throw new WorkInputError("action_not_available", "いまはこの操作ができません。", 409);
  if (purpose === "fund") {
    const offer = await getWorkOffer(database, row.worker_profile_id);
    if (!offer.accepting) throw new WorkInputError("not_accepting", "この作り手は、いま依頼を受け付けていません。", 409);
    if (await hasD1BlockBetween(database, row.client_profile_id, row.worker_profile_id)) throw new WorkInputError("unavailable", "この相手には依頼できません。", 403);
    if (row.audience === "adult") {
      const ok = offer.adultAllowed
        && (await getD1AdultOptIn(database, row.worker_profile_id)).enabled
        && await hasAdultCredential(database, row.client_profile_id, now);
      if (!ok) throw new WorkInputError("adult_not_allowed", "成人向けの依頼は、双方の条件が揃っているときだけ進められます。", 403);
    }
  }
  const terms = purpose === "fund"
    ? { amountUnits: row.price_units, turnaroundDays: row.turnaround_days }
    : purpose === "deliver" ? { deliveryHash: delivery?.hash } : {};
  try {
    return await signWorkCommerceTicket({ contractId, purpose, terms, privateKeyPkcs8, now });
  } catch {
    throw new WorkInputError("payments_unavailable", "支払の準備ができません。しばらくしてから再度お試しください。", 503);
  }
}

/* --------------------------------------------------------------- delivery */

type FileRow = {
  id: string; owner_profile_id: string; target_type: string | null; target_id: string | null; state: string;
  declared_bytes: number; storage_committed: number; storage_reservation: string | null; file_name: string;
};

async function readFile(database: D1Database, id: string): Promise<FileRow | null> {
  return database.prepare("SELECT id, owner_profile_id, target_type, target_id, state, declared_bytes, storage_committed, storage_reservation, file_name FROM hub_content_files WHERE id = ?")
    .bind(id).first<FileRow>();
}

/**
 * Seals a delivery: binds the uploaded files to the contract, has the file component publish them (its own
 * scan, size and hash checks decide), and records the hub.work.delivery.v1 fingerprint. The worker then records
 * that fingerprint on chain in Commerce's screen. The client sees only names, sizes and the fingerprint until
 * release. Any failure unbinds and closes every file of this attempt.
 */
export async function registerWorkDelivery(
  database: D1Database,
  deps: ContentFileDeps,
  workerId: string,
  contractId: string,
  rawFileIds: unknown,
  now = new Date(),
): Promise<{ hash: string; files: WorkDeliveryFile[] }> {
  const party = await readPartyContract(database, workerId, contractId);
  if (!party || party.side !== "worker") throw new WorkInputError("not_found", "契約が見つかりません。", 404);
  const { row } = party;
  if (row.escrow_state !== "accepted" || (row.deliver_deadline && new Date(row.deliver_deadline).getTime() <= now.getTime())) {
    throw new WorkInputError("delivery_closed", "いまは納品できません。", 409);
  }
  if (!Array.isArray(rawFileIds) || rawFileIds.length < 1 || rawFileIds.length > WORK_MAX_DELIVERY_FILES) {
    throw new WorkInputError("invalid_files", `納品するファイルを1〜${WORK_MAX_DELIVERY_FILES}個指定してください。`);
  }
  const fileIds = [...new Set(rawFileIds)];
  if (!fileIds.every(isHubFileId)) throw new WorkInputError("invalid_files", "ファイルの指定が正しくありません。");
  if (!deps.privateKeyPkcs8 || !deps.send) throw new WorkInputError("files_unavailable", "ファイルの納品は準備中です。", 503);

  const previous = await readWorkDelivery(database, contractId);
  const rows: FileRow[] = [];
  for (const id of fileIds) {
    const file = await readFile(database, id);
    if (!file || file.owner_profile_id !== workerId || file.state !== "upload_issued" || file.target_id !== null) {
      throw new WorkInputError("invalid_files", "納品できないファイルが含まれています。");
    }
    rows.push(file);
  }
  const stamp = now.toISOString();
  const bound: string[] = [];
  const published: string[] = [];
  const undo = async (error: WorkInputError): Promise<never> => {
    if (published.length) await unpublishContentFileIds(database, deps, published).catch(() => undefined);
    for (const id of bound) {
      await database.prepare(`UPDATE hub_content_files SET target_type = NULL, target_id = NULL, updated_at = ?
          WHERE id = ? AND state IN ('upload_issued') AND target_type = 'work'`).bind(stamp, id).run();
    }
    throw error;
  };

  const files: WorkDeliveryFile[] = [];
  for (const file of rows) {
    const claim = await database.prepare(`UPDATE hub_content_files SET target_type = 'work', target_id = ?, updated_at = ?
        WHERE id = ? AND owner_profile_id = ? AND state = 'upload_issued' AND target_id IS NULL`)
      .bind(contractId, stamp, file.id, workerId).run();
    if ((claim.meta?.changes ?? 0) !== 1) return undo(new WorkInputError("invalid_files", "納品できないファイルが含まれています。"));
    bound.push(file.id);
    const response = await sendTicketed(deps, file.id, "file_publish");
    const body = response ? await readFileBody(response) : null;
    if (!response || response.status !== 200 || body?.publishState !== "published") {
      return undo(response?.status === 409
        ? new WorkInputError("file_not_publishable", "検査を通っていないファイルが含まれています。", 409)
        : new WorkInputError("files_unavailable", "ファイルの納品は準備中です。", 503));
    }
    published.push(file.id);
    const sha256 = typeof body.sha256 === "string" ? body.sha256.toLowerCase() : "";
    const size = typeof body.sizeBytes === "number" && Number.isSafeInteger(body.sizeBytes) && body.sizeBytes > 0 ? body.sizeBytes : file.declared_bytes;
    if (!/^[0-9a-f]{64}$/.test(sha256)) return undo(new WorkInputError("files_unavailable", "ファイルの指紋を確かめられませんでした。", 503));
    if (size > file.declared_bytes) return undo(new WorkInputError("file_not_publishable", "ファイルの大きさが申告と合いません。", 409));
    if (!file.storage_committed) {
      const committed = await deps.storage
        .commit(database, { profileId: workerId, fileId: file.id, reservation: file.storage_reservation, bytes: size })
        .catch(() => false);
      if (!committed) return undo(new WorkInputError("storage_unavailable", "保存容量を確認できませんでした。", 503));
      await database.prepare("UPDATE hub_content_files SET storage_committed = 1 WHERE id = ?").bind(file.id).run();
    }
    const scanStatus = typeof body.scanStatus === "string" ? body.scanStatus.slice(0, 20) : null;
    const done = await database.prepare(`UPDATE hub_content_files SET state = 'published', stored_bytes = ?, scan_status = ?,
        published_at = COALESCE(published_at, ?), updated_at = ?
      WHERE id = ? AND target_type = 'work' AND target_id = ? AND state = 'upload_issued'`)
      .bind(size, scanStatus, stamp, stamp, file.id, contractId).run();
    if ((done.meta?.changes ?? 0) !== 1) return undo(new WorkInputError("files_unavailable", "ファイルの納品は準備中です。", 503));
    files.push({ id: file.id, name: file.file_name, sha256, size });
  }
  const hash = await workDeliveryHash(contractId, files, stamp);
  await database.prepare(`INSERT INTO work_deliveries (contract_id, files_json, delivery_hash, preview_kind, delivered_at) VALUES (?, ?, ?, 'metadata', ?)
    ON CONFLICT(contract_id) DO UPDATE SET files_json = excluded.files_json, delivery_hash = excluded.delivery_hash,
      preview_kind = excluded.preview_kind, delivered_at = excluded.delivered_at`)
    .bind(contractId, JSON.stringify(files), hash, stamp).run();
  // Re-delivery before the chain record replaces the earlier files.
  if (previous?.files.length) await unpublishContentFileIds(database, deps, previous.files.map((file) => file.id)).catch(() => undefined);
  return { hash, files };
}

/**
 * Full delivery only after release (DESIGN 6.3): the client may fetch a file once Commerce has reported the
 * escrow released; the worker may always fetch their own file while it is still published. The ticket is the
 * ordinary single-use file ticket, so the file component still checks scan, suspension and publish state.
 */
export async function issueWorkFileDownloadTicket(
  database: D1Database,
  deps: ContentFileDeps,
  viewerId: string,
  contractId: string,
  fileId: unknown,
  now = new Date(),
): Promise<{ url: string; expiresAt: string }> {
  const party = await readPartyContract(database, viewerId, contractId);
  if (!party || !isHubFileId(fileId)) throw new WorkInputError("not_found", "ファイルが見つかりません。", 404);
  if (party.side === "client" && party.row.escrow_state !== "released") {
    throw new WorkInputError("not_released", "受け取りは、完了したあとにできます。", 403);
  }
  const delivery = await readWorkDelivery(database, contractId);
  if (!delivery?.files.some((file) => file.id === fileId)) throw new WorkInputError("not_found", "ファイルが見つかりません。", 404);
  const file = await readFile(database, fileId);
  if (!file || file.state !== "published" || file.target_type !== "work" || file.target_id !== contractId) {
    throw new WorkInputError("not_found", "ファイルが見つかりません。", 404);
  }
  if (!deps.privateKeyPkcs8) throw new WorkInputError("files_unavailable", "ファイルを準備できませんでした。", 503);
  try {
    const signed = await signHubFileTicket({ fileId, purpose: "file_download", privateKeyPkcs8: deps.privateKeyPkcs8, now });
    return { url: `${signed.request.path}?ticket=${encodeURIComponent(signed.ticket)}`, expiresAt: signed.expiresAt };
  } catch {
    throw new WorkInputError("files_unavailable", "ファイルを準備できませんでした。", 503);
  }
}
