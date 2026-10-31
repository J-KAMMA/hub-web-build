export type AgentCommerceStage =
  | "discover"
  | "compare"
  | "configure"
  | "quoted"
  | "authorizing"
  | "submitted"
  | "failed";

export type AgentCommerceCandidate = {
  id: string;
  title: string;
  seller: string;
  priceJpyc: number;
  shippingJpyc: number;
  stockQuantity: number | null;
  fulfillmentType: string;
  valueMode?: "comparable" | "interpretive" | "hybrid";
};

export type AgentCommercePolicy = {
  maximumPerPurchaseJpyc: number;
  requireConfirmation: true;
};

export type AgentCommerceState = {
  stage: AgentCommerceStage;
  query: string;
  selectedProductId: string | null;
  quantity: number;
  quoteId: string | null;
  transactionHash: string | null;
  error: string | null;
};

export type AgentCommerceEvent =
  | { type: "search"; query: string }
  | { type: "select"; productId: string }
  | { type: "configure"; quantity: number }
  | { type: "quote_created"; quoteId: string }
  | { type: "authorization_started" }
  | { type: "submitted"; transactionHash: string }
  | { type: "failed"; error: string }
  | { type: "reset" };

export const DEFAULT_AGENT_COMMERCE_POLICY: AgentCommercePolicy = {
  maximumPerPurchaseJpyc: 10_000,
  requireConfirmation: true,
};

export const INITIAL_AGENT_COMMERCE_STATE: AgentCommerceState = {
  stage: "discover",
  query: "",
  selectedProductId: null,
  quantity: 1,
  quoteId: null,
  transactionHash: null,
  error: null,
};

export function reduceAgentCommerce(
  state: AgentCommerceState,
  event: AgentCommerceEvent,
): AgentCommerceState {
  switch (event.type) {
    case "search":
      return {
        ...INITIAL_AGENT_COMMERCE_STATE,
        stage: event.query.trim() ? "compare" : "discover",
        query: event.query,
      };
    case "select":
      return {
        ...state,
        stage: "configure",
        selectedProductId: event.productId,
        quantity: 1,
        quoteId: null,
        error: null,
      };
    case "configure":
      return {
        ...state,
        stage: "configure",
        quantity: event.quantity,
        quoteId: null,
        error: null,
      };
    case "quote_created":
      return { ...state, stage: "quoted", quoteId: event.quoteId, error: null };
    case "authorization_started":
      return { ...state, stage: "authorizing", error: null };
    case "submitted":
      return {
        ...state,
        stage: "submitted",
        transactionHash: event.transactionHash,
        error: null,
      };
    case "failed":
      return { ...state, stage: "failed", error: event.error };
    case "reset":
      return INITIAL_AGENT_COMMERCE_STATE;
  }
}

export function candidateTotalJpyc(
  candidate: AgentCommerceCandidate,
  quantity: number,
) {
  if (!Number.isInteger(quantity) || quantity < 1) return Number.POSITIVE_INFINITY;
  return candidate.priceJpyc * quantity + candidate.shippingJpyc;
}

export function agentCommercePolicyFailure(
  candidate: AgentCommerceCandidate,
  quantity: number,
  policy: AgentCommercePolicy,
) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
    return "invalid_quantity";
  }
  if (
    candidate.stockQuantity !== null &&
    quantity > candidate.stockQuantity
  ) {
    return "insufficient_stock";
  }
  if (candidateTotalJpyc(candidate, quantity) > policy.maximumPerPurchaseJpyc) {
    return "purchase_limit_exceeded";
  }
  return null;
}
