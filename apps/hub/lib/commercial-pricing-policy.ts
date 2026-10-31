import { HUB_REVENUE_RATES } from "./monetization-policy";

export const HUB_MARKETPLACE_FEE_BPS = HUB_REVENUE_RATES.generalCommerceFeeBps;
export const HUB_MARKETPLACE_FEE_PERCENT = 1;

export const HUB_REGULATED_LISTING_KINDS = [
  "jobs",
  "travel",
  "lodging",
  "transport",
] as const;

export type HubRegulatedListingKind = (typeof HUB_REGULATED_LISTING_KINDS)[number];

export const HUB_GENERAL_COMMERCE_KINDS = [
  "physical-goods",
  "digital-goods",
  "software-api",
  "creator-content",
  "membership",
  "contract-deliverable",
  "primary-event-ticket",
  "direct-provider-service",
] as const;

export type HubGeneralCommerceKind = (typeof HUB_GENERAL_COMMERCE_KINDS)[number];

export function calculateMarketplaceFee(amountMinor: number): {
  platformFeeMinor: number;
  sellerReceivesMinor: number;
} {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("amountMinor must be a non-negative safe integer.");
  }
  const platformFeeMinor = Math.floor(amountMinor * HUB_MARKETPLACE_FEE_BPS / 10_000);
  return {
    platformFeeMinor,
    sellerReceivesMinor: amountMinor - platformFeeMinor,
  };
}

export function calculateMarketplaceMoneyFlow(input: {
  merchandiseMinor: number;
  shippingMinor?: number;
  taxMinor?: number;
  sponsoredGasMinor?: number;
}): {
  buyerPaysMinor: number;
  feeBaseMinor: number;
  platformFeeMinor: number;
  sellerReceivesMinor: number;
  hubNetRevenueMinor: number;
} {
  const values = [
    input.merchandiseMinor,
    input.shippingMinor ?? 0,
    input.taxMinor ?? 0,
    input.sponsoredGasMinor ?? 0,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error("money flow amounts must be non-negative safe integers.");
  }
  const [merchandiseMinor, shippingMinor, taxMinor, sponsoredGasMinor] = values;
  const platformFeeMinor = calculateMarketplaceFee(merchandiseMinor + shippingMinor).platformFeeMinor;
  const sellerReceivesMinor = merchandiseMinor + shippingMinor - platformFeeMinor;
  return {
    buyerPaysMinor: merchandiseMinor + shippingMinor + taxMinor,
    feeBaseMinor: merchandiseMinor + shippingMinor,
    platformFeeMinor,
    sellerReceivesMinor,
    hubNetRevenueMinor: platformFeeMinor - sponsoredGasMinor,
  };
}

export function permitsHubTransaction(kind: string): kind is HubGeneralCommerceKind {
  return (HUB_GENERAL_COMMERCE_KINDS as readonly string[]).includes(kind);
}

export function isListingAndAdvertisingOnly(kind: string): kind is HubRegulatedListingKind {
  return (HUB_REGULATED_LISTING_KINDS as readonly string[]).includes(kind);
}
