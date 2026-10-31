export const SPECIALIST_MARKETS = [
  "employment",
  "real-estate",
  "vehicles",
  "travel",
  "local-services",
] as const;

export type SpecialistMarket = (typeof SPECIALIST_MARKETS)[number];

export const SPECIALIST_MARKET_CAPABILITIES = [
  "listing",
  "comparison",
  "advertising",
  "fixed-listing-plan",
  "external-link",
  "hub-application",
  "hub-appointment",
  "hub-negotiation",
  "hub-checkout",
  "hub-escrow",
  "success-fee",
  "transaction-completion",
] as const;

export type SpecialistMarketCapability =
  (typeof SPECIALIST_MARKET_CAPABILITIES)[number];

const ALLOWED_CAPABILITIES = new Set<SpecialistMarketCapability>([
  "listing",
  "comparison",
  "advertising",
  "fixed-listing-plan",
  "external-link",
]);

export function specialistMarketAllows(
  _market: SpecialistMarket,
  capability: SpecialistMarketCapability,
) {
  return ALLOWED_CAPABILITIES.has(capability);
}

export function specialistMarketDeniedResponse(
  capability: SpecialistMarketCapability,
) {
  return {
    error: "external_provider_required",
    capability,
    message:
      "この分野の申込み・契約・決済は、掲載元の事業者サイトで行ってください。Hubは掲載、比較、広告、外部リンクのみを提供します。",
  } as const;
}
