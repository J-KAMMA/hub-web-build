import { isHubScopedRef, type HubScopedRef } from "./core-model";

export type HubCommerceKind =
  | "marketplace"
  | "digital"
  | "work"
  | "ai";

export type HubCommerceRail =
  | "marketplace-payment-contract"
  | "work-escrow"
  | "x402";

export type HubCommerceStage =
  | "proposed"
  | "quoted"
  | "authorization_required"
  | "authorized"
  | "submitted"
  | "confirmed"
  | "fulfilling"
  | "fulfilled"
  | "evidence_pending"
  | "evidenced"
  | "settling"
  | "settled"
  | "disputed"
  | "refunded"
  | "failed"
  | "cancelled";

export type HubCommerceProposal = {
  version: "hub.commerce.v1";
  kind: HubCommerceKind;
  actor: HubScopedRef;
  offer: HubScopedRef;
  seller: HubScopedRef;
  quantity: number;
  currency: string;
  maximumCharge: string;
  termsDigest: string;
  expiresAt: string;
};

export type HubCommerceHandoff = {
  version: "hub.commerce.v1";
  status: "payment_authorization_required";
  proposal: HubCommerceProposal;
  commerce: {
    method: "POST";
    path: string;
    browserDirect: true;
    hubProxy: false;
    forwardHubProposal: false;
    authorizationSource: "payment-account-browser-flow";
  };
  execution: {
    rail: HubCommerceRail;
    fulfillmentOwner: "commerce" | "ai";
    evidence:
      | "commerce-order-and-chain-evidence"
      | "commerce-entitlement-evidence"
      | "work-escrow-and-delivery-evidence"
      | "x402-verification-and-settlement-evidence";
  };
  invariants: {
    hubHoldsFunds: false;
    hubReceivesSigningKeys: false;
    explicitMaximumCharge: true;
    serverVerificationRequired: true;
  };
};

const TRANSITIONS: Record<HubCommerceStage, readonly HubCommerceStage[]> = {
  proposed: ["quoted", "cancelled", "failed"],
  quoted: ["authorization_required", "cancelled", "failed"],
  authorization_required: ["authorized", "cancelled", "failed"],
  authorized: ["submitted", "cancelled", "failed"],
  submitted: ["confirmed", "failed"],
  confirmed: ["fulfilling", "fulfilled", "disputed", "refunded", "failed"],
  fulfilling: ["fulfilled", "disputed", "refunded", "failed"],
  fulfilled: ["evidence_pending", "disputed", "refunded"],
  evidence_pending: ["evidenced", "disputed", "failed"],
  evidenced: ["settling", "disputed", "refunded"],
  settling: ["settled", "disputed", "refunded", "failed"],
  settled: ["disputed", "refunded"],
  disputed: ["fulfilled", "evidence_pending", "settling", "settled", "refunded"],
  refunded: [],
  failed: [],
  cancelled: [],
};

export function transitionHubCommerceStage(
  current: HubCommerceStage,
  next: HubCommerceStage,
) {
  if (!TRANSITIONS[current].includes(next)) {
    throw new Error(`invalid_commerce_transition:${current}:${next}`);
  }
  return next;
}

function validMaximum(value: unknown) {
  return typeof value === "string"
    && /^(?:0|[1-9]\d{0,38})$/.test(value)
    && BigInt(value) > 0n;
}

export function parseHubCommerceProposal(
  value: unknown,
): HubCommerceProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<HubCommerceProposal>;
  if (item.version !== "hub.commerce.v1") return null;
  if (!["marketplace", "digital", "work", "ai"].includes(item.kind ?? "")) {
    return null;
  }
  if (
    !isHubScopedRef(item.actor)
    || item.actor.namespace !== "hub"
    || item.actor.kind !== "profile"
    || !isHubScopedRef(item.offer)
    || !isHubScopedRef(item.seller)
  ) {
    return null;
  }
  if (
    !Number.isInteger(item.quantity)
    || (item.quantity ?? 0) < 1
    || (item.quantity ?? 0) > 100
    || typeof item.currency !== "string"
    || !/^[A-Z0-9_-]{2,16}$/.test(item.currency)
    || !validMaximum(item.maximumCharge)
    || typeof item.termsDigest !== "string"
    || !/^sha256:[0-9a-f]{64}$/.test(item.termsDigest)
    || typeof item.expiresAt !== "string"
    || Number.isNaN(Date.parse(item.expiresAt))
    || Date.parse(item.expiresAt) <= Date.now()
    || Date.parse(item.expiresAt) > Date.now() + 30 * 60_000
  ) {
    return null;
  }
  return item as HubCommerceProposal;
}

function commercePath(proposal: HubCommerceProposal) {
  if (proposal.kind === "work") return "/work-proposals";
  if (proposal.kind === "ai") return "/compute/funding-grants";
  return `/products/${encodeURIComponent(proposal.offer.id)}/payment-request`;
}

function executionFor(
  kind: HubCommerceKind,
): HubCommerceHandoff["execution"] {
  switch (kind) {
    case "marketplace":
      return {
        rail: "marketplace-payment-contract",
        fulfillmentOwner: "commerce",
        evidence: "commerce-order-and-chain-evidence",
      };
    case "digital":
      return {
        rail: "marketplace-payment-contract",
        fulfillmentOwner: "commerce",
        evidence: "commerce-entitlement-evidence",
      };
    case "work":
      return {
        rail: "work-escrow",
        fulfillmentOwner: "commerce",
        evidence: "work-escrow-and-delivery-evidence",
      };
    case "ai":
      return {
        rail: "x402",
        fulfillmentOwner: "ai",
        evidence: "x402-verification-and-settlement-evidence",
      };
  }
}

export function createHubCommerceHandoff(
  proposal: HubCommerceProposal,
): HubCommerceHandoff {
  return {
    version: "hub.commerce.v1",
    status: "payment_authorization_required",
    proposal,
    commerce: {
      method: "POST",
      path: commercePath(proposal),
      browserDirect: true,
      hubProxy: false,
      forwardHubProposal: false,
      authorizationSource: "payment-account-browser-flow",
    },
    execution: executionFor(proposal.kind),
    invariants: {
      hubHoldsFunds: false,
      hubReceivesSigningKeys: false,
      explicitMaximumCharge: true,
      serverVerificationRequired: true,
    },
  };
}
