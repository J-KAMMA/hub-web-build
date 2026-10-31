export type FederatedListingSource = "personal-node" | "hub-managed" | "external-catalog";

export type FederatedListing = {
  version: "hub.federated-commerce.v1";
  listingId: string;
  sellerActor: string;
  canonicalNode: string;
  productRevision: string;
  title: string;
  description: string;
  category: string;
  price: string;
  currency: string;
  approximateInventory?: number;
  shippingRegions: string[];
  returnPolicyUrl?: string;
  quoteEndpoint: string;
  escrowPolicy: "none" | "two-party";
  source: FederatedListingSource;
};

export type FederatedQuoteRoute = "direct" | "hub-referral";

export type FederatedSignedQuote = {
  version: "hub.federated-quote.v1";
  quoteId: string;
  listingId: string;
  sellerActor: string;
  buyerActor: string;
  productRevision: string;
  quantity: number;
  totalAmount: string;
  currency: string;
  paymentAsset: string;
  reservedUntil: string;
  escrowContract?: string;
  route: FederatedQuoteRoute;
  hubReferralFeeBps: 0 | 100;
  termsDigest: string;
  sellerSignature: string;
};

export type FederatedVerifiedReview = {
  version: "hub.federated-review.v1";
  listingId: string;
  sellerActor: string;
  orderCommitment: string;
  rating: 1 | 2 | 3 | 4 | 5;
  review: string;
  publishedAt: string;
  buyerSignature: string;
};

function isHttpsUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isPositiveDecimal(value: unknown) {
  return typeof value === "string"
    && /^(?:0|[1-9]\d{0,38})(?:\.\d{1,18})?$/.test(value)
    && Number(value) > 0;
}

function isDigest(value: unknown) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

export function referralFeeBpsForRoute(route: FederatedQuoteRoute): 0 | 100 {
  return route === "hub-referral" ? 100 : 0;
}

export function validateFederatedListing(value: unknown): value is FederatedListing {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<FederatedListing>;
  return item.version === "hub.federated-commerce.v1"
    && isHttpsUrl(item.listingId)
    && isHttpsUrl(item.sellerActor)
    && isHttpsUrl(item.canonicalNode)
    && typeof item.productRevision === "string"
    && item.productRevision.length > 0
    && typeof item.title === "string"
    && item.title.trim().length > 0
    && typeof item.description === "string"
    && typeof item.category === "string"
    && isPositiveDecimal(item.price)
    && typeof item.currency === "string"
    && /^[A-Z0-9_-]{2,16}$/.test(item.currency)
    && Array.isArray(item.shippingRegions)
    && item.shippingRegions.every((region) => typeof region === "string" && region.length > 0)
    && (item.returnPolicyUrl === undefined || isHttpsUrl(item.returnPolicyUrl))
    && isHttpsUrl(item.quoteEndpoint)
    && (item.escrowPolicy === "none" || item.escrowPolicy === "two-party")
    && ["personal-node", "hub-managed", "external-catalog"].includes(item.source ?? "");
}

export function validateFederatedSignedQuote(value: unknown): value is FederatedSignedQuote {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<FederatedSignedQuote>;
  const routeValid = item.route === "direct" || item.route === "hub-referral";
  return item.version === "hub.federated-quote.v1"
    && typeof item.quoteId === "string"
    && item.quoteId.length >= 8
    && isHttpsUrl(item.listingId)
    && isHttpsUrl(item.sellerActor)
    && isHttpsUrl(item.buyerActor)
    && typeof item.productRevision === "string"
    && item.productRevision.length > 0
    && Number.isInteger(item.quantity)
    && (item.quantity ?? 0) >= 1
    && (item.quantity ?? 0) <= 100
    && isPositiveDecimal(item.totalAmount)
    && typeof item.currency === "string"
    && /^[A-Z0-9_-]{2,16}$/.test(item.currency)
    && typeof item.paymentAsset === "string"
    && item.paymentAsset.length > 0
    && typeof item.reservedUntil === "string"
    && !Number.isNaN(Date.parse(item.reservedUntil))
    && Date.parse(item.reservedUntil) > Date.now()
    && (item.escrowContract === undefined || /^0x[0-9a-fA-F]{40}$/.test(item.escrowContract))
    && routeValid
    && item.hubReferralFeeBps === referralFeeBpsForRoute(item.route as FederatedQuoteRoute)
    && isDigest(item.termsDigest)
    && typeof item.sellerSignature === "string"
    && item.sellerSignature.length >= 16;
}

export function validateFederatedVerifiedReview(value: unknown): value is FederatedVerifiedReview {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<FederatedVerifiedReview>;
  return item.version === "hub.federated-review.v1"
    && isHttpsUrl(item.listingId)
    && isHttpsUrl(item.sellerActor)
    && isDigest(item.orderCommitment)
    && Number.isInteger(item.rating)
    && (item.rating ?? 0) >= 1
    && (item.rating ?? 0) <= 5
    && typeof item.review === "string"
    && item.review.length <= 5_000
    && typeof item.publishedAt === "string"
    && !Number.isNaN(Date.parse(item.publishedAt))
    && typeof item.buyerSignature === "string"
    && item.buyerSignature.length >= 16;
}
