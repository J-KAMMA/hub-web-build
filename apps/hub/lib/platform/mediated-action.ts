import {
  isHubScopedRef,
  type HubScopedRef,
} from "@/lib/platform/core-model";

export type HubMediatedActionKind =
  | "message-send"
  | "purchase";

export type HubMediatedActionProposal = {
  version: "hub.mediation.v1";
  kind: HubMediatedActionKind;
  actor: HubScopedRef;
  target: HubScopedRef;
  summary: string;
  payload: Record<string, string | number | boolean>;
  expiresAt: string;
};

export type HubMediationResult = {
  version: "hub.mediation.v1";
  mediationId: string;
  status: "confirmation_required" | "payment_authorization_required";
  capability:
    | "hub.communication.message.mediate"
    | "hub.commerce.purchase.propose";
  proposal: HubMediatedActionProposal;
  execution: {
    performed: false;
    messageSent: false;
    valueMoved: false;
  };
};

function isSafePayload(
  value: unknown,
): value is Record<string, string | number | boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 20) return false;
  return entries.every(([key, item]) =>
    /^[a-z][a-zA-Z0-9]{0,59}$/.test(key)
    && (
      typeof item === "boolean"
      || (typeof item === "number" && Number.isFinite(item))
      || (typeof item === "string" && [...item].length <= 20_000)
    )
  );
}

export function parseMediatedActionProposal(
  value: unknown,
): HubMediatedActionProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Partial<HubMediatedActionProposal>;
  if (candidate.version !== "hub.mediation.v1") return null;
  if (candidate.kind !== "message-send" && candidate.kind !== "purchase") {
    return null;
  }
  if (!isHubScopedRef(candidate.actor) || !isHubScopedRef(candidate.target)) {
    return null;
  }
  if (
    candidate.actor.namespace !== "hub"
    || candidate.actor.kind !== "profile"
  ) {
    return null;
  }
  if (
    typeof candidate.summary !== "string"
    || !candidate.summary.trim()
    || [...candidate.summary].length > 500
  ) {
    return null;
  }
  if (!isSafePayload(candidate.payload)) return null;
  if (
    typeof candidate.expiresAt !== "string"
    || Number.isNaN(Date.parse(candidate.expiresAt))
    || Date.parse(candidate.expiresAt) <= Date.now()
    || Date.parse(candidate.expiresAt) > Date.now() + 30 * 60_000
  ) {
    return null;
  }
  if (
    candidate.kind === "message-send"
    && (typeof candidate.payload.body !== "string"
      || !candidate.payload.body.trim())
  ) {
    return null;
  }
  if (
    candidate.kind === "purchase"
    && (
      typeof candidate.payload.productId !== "string"
      || typeof candidate.payload.sellerId !== "string"
      || typeof candidate.payload.total !== "number"
      || candidate.payload.total <= 0
      || typeof candidate.payload.currency !== "string"
    )
  ) {
    return null;
  }
  return {
    version: candidate.version,
    kind: candidate.kind,
    actor: candidate.actor,
    target: candidate.target,
    summary: candidate.summary.trim(),
    payload: candidate.payload,
    expiresAt: candidate.expiresAt,
  };
}

export function mediateHubAction(
  proposal: HubMediatedActionProposal,
): HubMediationResult {
  const purchase = proposal.kind === "purchase";
  return {
    version: "hub.mediation.v1",
    mediationId: crypto.randomUUID(),
    status: purchase
      ? "payment_authorization_required"
      : "confirmation_required",
    capability: purchase
      ? "hub.commerce.purchase.propose"
      : "hub.communication.message.mediate",
    proposal,
    execution: {
      performed: false,
      messageSent: false,
      valueMoved: false,
    },
  };
}

