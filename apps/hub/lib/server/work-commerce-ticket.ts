/*
 * Hub -> Commerce work ticket (DESIGN 6.2, owner approved 2026-10-29; AGENTS.md 2026-10-29 work-escrow rule).
 *
 * The browser carries this single-use ticket from Hub to Commerce's own screens; Hub never sees the payment.
 * Audience `jkamma-commerce-work`, signed with a Hub key that is NOT the file-ticket key
 * (`HUB_COMMERCE_WORK_TICKET_PRIVATE_KEY_PKCS8`), expiry at most 5 minutes. Claims are exactly: contract ID,
 * purpose, the terms that purpose needs (displayed amount, accept window, turnaround, delivery fingerprint),
 * issue time, expiry and a unique ID. Never a profile ID, handle, Account subject or wallet; Commerce rejects
 * unknown claims. Hub signs only after it has checked that the caller is the right side of the contract.
 */
import { WORK_ACCEPT_DAYS, WORK_TICKET_PURPOSES, type WorkTicketPurpose } from "@/lib/work-commissions";
import { WORK_CONTRACT_ID } from "@/lib/server/work-escrow-state";

export const WORK_TICKET_ISSUER = "jkamma-hub";
export const WORK_TICKET_AUDIENCE = "jkamma-commerce-work";
export const WORK_TICKET_TYPE = "hub-commerce-work-ticket+jwt";
export const WORK_TICKET_MAX_LIFETIME_SECONDS = 300;
export const WORK_TICKET_DEFAULT_LIFETIME_SECONDS = 300;

export type WorkTicketClaims = {
  iss: typeof WORK_TICKET_ISSUER;
  aud: typeof WORK_TICKET_AUDIENCE;
  purpose: WorkTicketPurpose;
  contract_id: string;
  iat: number;
  exp: number;
  jti: string;
  /** fund only */
  price_jpy?: number;
  fee_base_jpy?: number;
  accept_days?: number;
  turnaround_days?: number;
  /** deliver only: the hub.work.delivery.v1 fingerprint as 0x + 64 hex (bytes32) */
  delivery_hash?: string;
};

/** Tax-excluded base of a tax-included price, rounded up (Commerce work-direct tests: 5000 -> 4546). */
export const workFeeBaseJpy = (priceJpy: number) => Math.ceil((priceJpy * 10) / 11);

export type WorkTicketTerms = {
  amountUnits?: number;
  turnaroundDays?: number;
  deliveryHash?: string;
};

const b64url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const encode = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

function pkcs8(value: string): ArrayBuffer {
  const body = value.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

export async function signWorkCommerceTicket(input: {
  contractId: string;
  purpose: WorkTicketPurpose;
  terms?: WorkTicketTerms;
  privateKeyPkcs8: string | null | undefined;
  lifetimeSeconds?: number;
  now?: Date;
}): Promise<{ ticket: string; claims: WorkTicketClaims; expiresAt: string }> {
  if (!WORK_CONTRACT_ID.test(input.contractId)) throw new Error("invalid_contract_id");
  if (!WORK_TICKET_PURPOSES.includes(input.purpose)) throw new Error("invalid_purpose");
  const lifetime = input.lifetimeSeconds ?? WORK_TICKET_DEFAULT_LIFETIME_SECONDS;
  if (!Number.isSafeInteger(lifetime) || lifetime < 1 || lifetime > WORK_TICKET_MAX_LIFETIME_SECONDS) throw new Error("invalid_ticket_lifetime");
  const secret = input.privateKeyPkcs8?.trim();
  if (!secret) throw new Error("ticket_key_unconfigured");

  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000);
  const claims: WorkTicketClaims = {
    iss: WORK_TICKET_ISSUER,
    aud: WORK_TICKET_AUDIENCE,
    purpose: input.purpose,
    contract_id: input.contractId,
    iat,
    exp: iat + lifetime,
    jti: crypto.randomUUID(),
  };
  const terms = input.terms ?? {};
  if (input.purpose === "fund") {
    if (!Number.isSafeInteger(terms.amountUnits) || !Number.isSafeInteger(terms.turnaroundDays)) throw new Error("terms_required");
    claims.price_jpy = terms.amountUnits;
    // Pre-tax base for the on-chain 1% fee (Commerce: ceil(price / 1.1)).
    claims.fee_base_jpy = workFeeBaseJpy(terms.amountUnits as number);
    claims.accept_days = WORK_ACCEPT_DAYS;
    claims.turnaround_days = terms.turnaroundDays;
  } else if (input.purpose === "deliver") {
    if (!terms.deliveryHash || !/^[0-9a-f]{64}$/.test(terms.deliveryHash)) throw new Error("terms_required");
    claims.delivery_hash = `0x${terms.deliveryHash}`;
  }
  const signingInput = `${encode({ alg: "EdDSA", typ: WORK_TICKET_TYPE })}.${encode(claims)}`;
  const key = await crypto.subtle.importKey("pkcs8", pkcs8(secret), { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(signingInput)));
  return { ticket: `${signingInput}.${b64url(signature)}`, claims, expiresAt: new Date(claims.exp * 1000).toISOString() };
}

/**
 * Where the browser takes the ticket. The ticket rides in the URL fragment, which is never sent to a server
 * or written to access logs. Commerce serves its screens under /shopping; `/shopping/work` is this module's assumption and Commerce reads the fragment.
 */
export function workCommerceHandoffUrl(origin: string, ticket: string): string {
  return `${origin.replace(/\/+$/, "")}/shopping/work#ticket=${encodeURIComponent(ticket)}`;
}
