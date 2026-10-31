export type ProductValueMode = "comparable" | "interpretive" | "hybrid";

export type ProductComparisonFact = {
  key: string;
  label: string;
  value: string | number | boolean;
  unit?: string;
  sourceUrl?: string;
  verifiedAt?: string;
};

export type ProductValueProfile = {
  mode: ProductValueMode;
  comparisonFacts: readonly ProductComparisonFact[];
  story?: string;
  creator?: string;
  provenance?: string;
};

export type PurchaseReviewInput = {
  profile: ProductValueProfile;
  requiredFactKeys: readonly string[];
  sellerVerified: boolean;
  paymentEndpointVerified: boolean;
  quoteExpiresAt: string | null;
  total: number;
  maximumTotal: number;
  currency: string;
};

export type PurchaseReviewResult = {
  status: "ready_for_confirmation" | "human_review_required" | "blocked";
  reasons: readonly string[];
  missingFactKeys: readonly string[];
};

function hasUsableValue(fact: ProductComparisonFact) {
  if (typeof fact.value === "string") return fact.value.trim().length > 0;
  return typeof fact.value === "boolean" || Number.isFinite(fact.value);
}

/**
 * Classifies a proposal only. It never authorizes payment or replaces the
 * wallet confirmation owned by Commerce.
 */
export function reviewPurchaseProposal(
  input: PurchaseReviewInput,
  now = Date.now(),
): PurchaseReviewResult {
  const available = new Map(
    input.profile.comparisonFacts
      .filter(hasUsableValue)
      .map((fact) => [fact.key, fact]),
  );
  const missingFactKeys = input.requiredFactKeys.filter(
    (key) => !available.has(key),
  );
  const reasons: string[] = [];

  if (!input.sellerVerified) reasons.push("seller_not_verified");
  if (!input.paymentEndpointVerified) reasons.push("payment_endpoint_not_verified");
  if (!/^[A-Z]{3,8}$/u.test(input.currency)) reasons.push("invalid_currency");
  if (!Number.isFinite(input.total) || input.total <= 0) reasons.push("invalid_total");
  if (!Number.isFinite(input.maximumTotal) || input.maximumTotal <= 0) reasons.push("invalid_budget");
  if (input.total > input.maximumTotal) reasons.push("budget_exceeded");
  if (!input.quoteExpiresAt || new Date(input.quoteExpiresAt).getTime() <= now) {
    reasons.push("quote_missing_or_expired");
  }
  if (missingFactKeys.length) reasons.push("required_facts_missing");

  if (reasons.length) {
    return { status: "blocked", reasons, missingFactKeys };
  }

  if (input.profile.mode !== "comparable") {
    return {
      status: "human_review_required",
      reasons: ["interpretation_dependent_value"],
      missingFactKeys: [],
    };
  }

  return {
    status: "ready_for_confirmation",
    reasons: [],
    missingFactKeys: [],
  };
}

export function buildBasicProductValueProfile(product: {
  description: string;
  price: number;
  currency: string;
  delivery: string;
  stock: number | null;
  seller: string;
}): ProductValueProfile {
  return {
    mode: product.description.trim() ? "hybrid" : "comparable",
    comparisonFacts: [
      { key: "price", label: "価格", value: product.price, unit: product.currency },
      { key: "delivery", label: "配送", value: product.delivery },
      ...(product.stock === null
        ? []
        : [{ key: "stock", label: "在庫", value: product.stock, unit: "点" }]),
    ],
    story: product.description.trim() || undefined,
    creator: product.seller.trim() || undefined,
  };
}
