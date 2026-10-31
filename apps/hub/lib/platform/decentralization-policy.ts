export type HubDataAuthority = "personal-node" | "service" | "shared-projection";

export type HubDecentralizationPolicy = {
  authority: HubDataAuthority;
  portable: boolean;
  ownerHostedBody: boolean;
  hubMayIndex: boolean;
  hubMayCache: "never" | "with-consent" | "required-record";
  reason: string;
};

export const HUB_DECENTRALIZATION_POLICY = {
  publicPost: {
    authority: "personal-node",
    portable: true,
    ownerHostedBody: true,
    hubMayIndex: true,
    hubMayCache: "with-consent",
    reason: "Public expression remains user-owned while Hub provides a replaceable AppView.",
  },
  publicMedia: {
    authority: "personal-node",
    portable: true,
    ownerHostedBody: true,
    hubMayIndex: true,
    hubMayCache: "with-consent",
    reason: "Owners choose origins, mirrors, and cache permission.",
  },
  searchProjection: {
    authority: "shared-projection",
    portable: true,
    ownerHostedBody: false,
    hubMayIndex: true,
    hubMayCache: "with-consent",
    reason: "Several replaceable index and recommendation providers may project public data.",
  },
  privateMessage: {
    authority: "personal-node",
    portable: true,
    ownerHostedBody: true,
    hubMayIndex: false,
    hubMayCache: "with-consent",
    reason: "Relays may retain only encrypted envelopes for bounded offline delivery.",
  },
  accountRecovery: {
    authority: "service",
    portable: false,
    ownerHostedBody: false,
    hubMayIndex: false,
    hubMayCache: "required-record",
    reason: "A clearly accountable service must prevent takeover and coordinate recovery.",
  },
  paymentRecord: {
    authority: "service",
    portable: true,
    ownerHostedBody: false,
    hubMayIndex: false,
    hubMayCache: "required-record",
    reason: "Commerce retains authoritative settlement, refund, tax, and accounting records.",
  },
  legalIdentity: {
    authority: "service",
    portable: false,
    ownerHostedBody: false,
    hubMayIndex: false,
    hubMayCache: "never",
    reason: "Identity data stays isolated and must never enter Hub projections or public nodes.",
  },
  moderationDecision: {
    authority: "service",
    portable: true,
    ownerHostedBody: false,
    hubMayIndex: false,
    hubMayCache: "required-record",
    reason: "Enforcement, reasons, evidence, and appeals require an accountable audit trail.",
  },
} as const satisfies Record<string, HubDecentralizationPolicy>;

export type HubDecentralizedResource = keyof typeof HUB_DECENTRALIZATION_POLICY;

export function decentralizationPolicyFor(resource: HubDecentralizedResource) {
  return HUB_DECENTRALIZATION_POLICY[resource];
}
