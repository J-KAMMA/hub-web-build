/*
 * 指名依頼 (crowdsourcing v1, 2026-10-29; docs/hub-commissions/DESIGN.md).
 *
 * Pure rules shared by the server code, the routes and the pages. No I/O here.
 * Hub holds the request, the thread and the delivery list. Payment, the receipt and the refund are Commerce's;
 * the money sits in an on-chain escrow nobody at jkamma can move. Amounts below are displayed conditions
 * (whole JPYC), never a payment record.
 */

export const WORK_MIN_PRICE_UNITS = 100;
/** Testnet canary cap per request = Commerce WORK_DEFAULT_MAX_JPY (DESIGN 5.1). Owner decision to raise; keep equal to Commerce. */
export const WORK_MAX_PRICE_UNITS = 30_000;
export const WORK_FEE_NOTE_JA = "手数料は報酬額の1%（消費税込み）";
export const WORK_ACCEPT_DAYS = 7;
export const WORK_REVIEW_DAYS = 7;
export const WORK_DISPUTE_DAYS = 14;
export const WORK_THREAD_CLOSE_DAYS = 30;
/** Owner decision 2026-10-29: threads are kept 1 year after the contract closes, for abuse review. */
export const WORK_THREAD_RETENTION_DAYS = 365;
export const WORK_MAX_CATEGORIES = 8;
export const WORK_MAX_DELIVERY_FILES = 10;
/** DESIGN 10: unfunded requests per client per day, open contracts per client. */
export const WORK_MAX_UNFUNDED_PER_DAY = 5;
export const WORK_MAX_OPEN_PER_CLIENT = 10;

export const WORK_ESCROW_STATES = ["pending_funding", "funded", "accepted", "delivered", "flagged", "released", "refunded"] as const;
export type WorkEscrowState = (typeof WORK_ESCROW_STATES)[number];
export type WorkAudience = "general" | "adult";
export type WorkTicketPurpose = "bind" | "fund" | "accept" | "decline" | "deliver" | "confirm" | "flag";
export const WORK_TICKET_PURPOSES: readonly WorkTicketPurpose[] = ["bind", "fund", "accept", "decline", "deliver", "confirm", "flag"];

const RANK: Record<WorkEscrowState, number> = {
  pending_funding: 0,
  funded: 1,
  accepted: 2,
  delivered: 3,
  flagged: 4,
  released: 5,
  refunded: 5,
};

export function isWorkEscrowState(value: unknown): value is WorkEscrowState {
  return typeof value === "string" && (WORK_ESCROW_STATES as readonly string[]).includes(value);
}

export function isTerminalWorkState(state: WorkEscrowState): boolean {
  return state === "released" || state === "refunded";
}

/**
 * Commerce's reply may only move a contract forward. Anything older, out of order, or a change out of a
 * terminal state is ignored (fail closed: the page keeps showing the last good state as "確認中").
 */
export function canAdvanceWorkState(from: WorkEscrowState, to: WorkEscrowState): boolean {
  if (isTerminalWorkState(from)) return from === to;
  if (to === "refunded") return from !== "pending_funding";
  return RANK[to] >= RANK[from];
}

/* ------------------------------------------------------------------ input */

export class WorkInputError extends Error {
  constructor(readonly code: string, message: string, readonly status: 400 | 403 | 404 | 409 | 429 | 503 = 400) {
    super(message);
    this.name = "WorkInputError";
  }
}

function clean(value: unknown, max: number, field: string, options: { required?: boolean; multiline?: boolean } = {}): string {
  const text = typeof value === "string" ? value.normalize("NFKC") : "";
  // eslint-disable-next-line no-control-regex
  const stripped = (options.multiline ? text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "") : text.replace(/[\u0000-\u001f\u007f]/g, " ")).trim();
  if (options.required && !stripped) throw new WorkInputError("invalid_input", `${field}を入力してください。`);
  if (stripped.length > max) throw new WorkInputError("invalid_input", `${field}は${max}文字以内で入力してください。`);
  return stripped;
}

function wholeUnits(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d{1,7}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(number) || number < WORK_MIN_PRICE_UNITS || number > WORK_MAX_PRICE_UNITS) {
    throw new WorkInputError("invalid_input", `${field}は${WORK_MIN_PRICE_UNITS}〜${WORK_MAX_PRICE_UNITS}の整数で入力してください。`);
  }
  return number;
}

function whole(value: unknown, min: number, max: number, field: string): number {
  const number = typeof value === "number" ? value : typeof value === "string" && /^\d{1,4}$/.test(value.trim()) ? Number(value.trim()) : NaN;
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new WorkInputError("invalid_input", `${field}は${min}〜${max}の整数で入力してください。`);
  }
  return number;
}

export type WorkOfferSettingsInput = {
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

export function parseWorkCategories(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,、\n]/) : [];
  const seen = new Set<string>();
  for (const entry of list) {
    const text = clean(entry, 30, "種類");
    if (text) seen.add(text);
  }
  if (seen.size > WORK_MAX_CATEGORIES) throw new WorkInputError("invalid_input", `種類は${WORK_MAX_CATEGORIES}個までです。`);
  return [...seen];
}

export function parseWorkOfferSettings(input: Record<string, unknown>): WorkOfferSettingsInput {
  if (typeof input.accepting !== "boolean" || typeof input.adultAllowed !== "boolean") {
    throw new WorkInputError("invalid_input", "受付と成人向けの指定が正しくありません。");
  }
  return {
    accepting: input.accepting,
    minPriceUnits: wholeUnits(input.minPriceUnits, "最低額"),
    priceNote: clean(input.priceNote, 500, "価格の説明", { multiline: true }),
    acceptsText: clean(input.acceptsText, 1000, "受ける内容", { multiline: true }),
    refusesText: clean(input.refusesText, 1000, "受けない内容", { multiline: true }),
    turnaroundDays: whole(input.turnaroundDays, 1, 90, "所要日数"),
    categories: parseWorkCategories(input.categories),
    adultAllowed: input.adultAllowed,
    maxOpen: whole(input.maxOpen, 1, 20, "同時に受ける数"),
  };
}

export type WorkRequestInput = {
  workerHandle: string;
  category: string;
  title: string;
  brief: string;
  budgetUnits: number;
  audience: WorkAudience;
};

export function parseWorkRequestInput(input: Record<string, unknown>): WorkRequestInput {
  const handle = clean(input.workerHandle, 64, "宛先", { required: true }).replace(/^@/, "");
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(handle)) throw new WorkInputError("invalid_input", "宛先が正しくありません。");
  if (input.audience !== "general" && input.audience !== "adult") throw new WorkInputError("invalid_input", "成人向けかどうかを選んでください。");
  if (input.acknowledged !== true) {
    throw new WorkInputError("acknowledgement_required", "修正なし・期限・返金の条件・公開は選べることを確かめてから送ってください。");
  }
  return {
    workerHandle: handle,
    category: clean(input.category, 30, "種類", { required: true }),
    title: clean(input.title, 100, "題名", { required: true }),
    brief: clean(input.brief, 4000, "依頼文", { required: true, multiline: true }),
    budgetUnits: wholeUnits(input.budgetUnits, "額"),
    audience: input.audience,
  };
}

export function parseWorkMessageBody(value: unknown): string {
  return clean(value, 2000, "メッセージ", { required: true, multiline: true });
}

/* ----------------------------------------------------------- text checks */

/**
 * DESIGN 6.4: payment outside the escrow is reported, and the sender is warned. A hint, never a verdict:
 * it only sets a flag and shows a warning; nothing is blocked or decided automatically.
 */
const OFF_PLATFORM_PAYMENT = /(口座|振込|振り込|銀行|paypal|ペイペイ|paypay|銀行振込|0x[0-9a-f]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|別(?:の)?送金|直接.{0,6}(?:払|支払|送金)|外で.{0,6}(?:払|支払|取引))/i;

export function looksLikeOffPlatformPayment(body: string): boolean {
  return OFF_PLATFORM_PAYMENT.test(body);
}

/** DESIGN 4/11.6: an employment-style post (hourly pay, fixed hours, continuing direction) is not a commission. */
const EMPLOYMENT_LIKE = /(時給|日給|月給|勤務時間|出勤|シフト|常駐|週\s*\d+\s*日|雇用|社員募集|アルバイト)/;

export function looksLikeEmployment(text: string): boolean {
  return EMPLOYMENT_LIKE.test(text);
}

/* ----------------------------------------------------------- fingerprint */

export type WorkDeliveryFile = { id: string; name: string; sha256: string; size: number };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * `hub.work.delivery.v1`: SHA-256 of a canonical JSON of the contract ID, each file's SHA-256 and size (sorted
 * by hash then size, so the upload order does not matter) and the delivery time. Only this fingerprint goes on
 * chain. File names are not part of it.
 */
export async function workDeliveryHash(contractId: string, files: readonly WorkDeliveryFile[], deliveredAt: string): Promise<string> {
  const entries = files
    .map((file) => ({ sha256: file.sha256.toLowerCase(), size: file.size }))
    .sort((a, b) => (a.sha256 < b.sha256 ? -1 : a.sha256 > b.sha256 ? 1 : a.size - b.size));
  const text = canonical({ v: "hub.work.delivery.v1", contract: contractId, files: entries, deliveredAt });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/* ------------------------------------------------------------ permissions */

export type WorkSide = "client" | "worker";

export type WorkContractFacts = {
  state: WorkEscrowState;
  deliverySealed: boolean;
  flagUntil: string | null;
  releaseAt: string | null;
  acceptBy: string | null;
  deliverBy: string | null;
};

/** Which side may ask for which Commerce action in which state. Hub checks this before it signs a ticket. */
export function workTicketAllowed(side: WorkSide, purpose: WorkTicketPurpose, facts: WorkContractFacts, now: Date): boolean {
  const before = (iso: string | null) => iso === null || new Date(iso).getTime() > now.getTime();
  switch (purpose) {
    case "bind":
      return side === "worker" && facts.state === "pending_funding";
    case "fund":
      return side === "client" && facts.state === "pending_funding";
    case "accept":
      return side === "worker" && facts.state === "funded" && before(facts.acceptBy);
    case "decline":
      return side === "worker" && (facts.state === "funded" || facts.state === "accepted");
    case "deliver":
      return side === "worker" && facts.state === "accepted" && facts.deliverySealed && before(facts.deliverBy);
    case "confirm":
      return side === "client" && facts.state === "delivered";
    case "flag":
      return side === "client" && facts.state === "delivered" && facts.flagUntil === null && before(facts.releaseAt);
  }
}

/** DESIGN 7.5: stop new requests from a client whose flags mostly end in refunds. */
export function clientRestricted(stats: { completed: number; refundedAfterFlag: number }): boolean {
  return stats.refundedAfterFlag >= 3 && stats.refundedAfterFlag > stats.completed;
}

export const WORK_STATE_LABEL_JA: Record<WorkEscrowState, string> = {
  pending_funding: "入金待ち",
  funded: "受諾待ち",
  accepted: "制作中",
  delivered: "確認期間",
  flagged: "未着の申し立て中",
  released: "完了",
  refunded: "返金済み",
};

export const WORK_STATE_LABEL_EN: Record<WorkEscrowState, string> = {
  pending_funding: "Awaiting payment",
  funded: "Awaiting acceptance",
  accepted: "In progress",
  delivered: "In review",
  flagged: "Non-delivery claim open",
  released: "Completed",
  refunded: "Refunded",
};
