export const HUB_EXPANSION_POLICY_VERSION = "hub.expansion.v1" as const;

export type ExpansionStage =
  | "foundation"
  | "connected_market"
  | "managed_network"
  | "selective_infrastructure";

export type ExpansionCapability = {
  id: string;
  label: string;
  stage: ExpansionStage;
  owner: string;
  enabled: boolean;
  hubOperatesUnderlyingBusiness: boolean;
  entryPoints: readonly string[];
  requiredGate?: string;
};

export const hubCoreFunctions = [
  "identity",
  "discovery",
  "contract_and_payment",
  "execution_and_delivery",
  "trust_and_dispute_resolution",
] as const;

export const hubExpansionCapabilities: readonly ExpansionCapability[] = [
  {
    id: "hub_id",
    label: "Hub ID・信用基盤",
    stage: "foundation",
    owner: "services/account + apps/hub + services/identity",
    enabled: true,
    hubOperatesUnderlyingBusiness: true,
    entryPoints: ["/auth", "/profile", "/settings"],
  },
  {
    id: "personal_ai",
    label: "Personal AI OS",
    stage: "foundation",
    owner: "apps/ai",
    enabled: true,
    hubOperatesUnderlyingBusiness: true,
    entryPoints: ["/ai", "/compute"],
  },
  {
    id: "agent_market",
    label: "エージェント市場",
    stage: "connected_market",
    owner: "apps/commerce + apps/ai",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/market", "/ai"],
    requiredGate: "distribution_security_billing_review",
  },
  {
    id: "compute_market",
    label: "コンピューティング市場",
    stage: "connected_market",
    owner: "apps/compute",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/compute"],
    requiredGate: "provider_verification_and_usage_settlement_review",
  },
  {
    id: "vault",
    label: "Hub Vault・個人データ基盤",
    stage: "foundation",
    owner: "apps/vault",
    enabled: true,
    hubOperatesUnderlyingBusiness: true,
    entryPoints: ["/vault"],
  },
  {
    id: "contract_escrow",
    label: "契約・エスクロー・紛争解決",
    stage: "connected_market",
    owner: "apps/commerce",
    enabled: true,
    hubOperatesUnderlyingBusiness: true,
    entryPoints: ["/market", "/services"],
  },
  {
    id: "procurement",
    label: "調達・卸売市場",
    stage: "connected_market",
    owner: "apps/commerce",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/market"],
    requiredGate: "business_trade_terms_and_supplier_review",
  },
  {
    id: "manufacturing_network",
    label: "製造ネットワーク",
    stage: "managed_network",
    owner: "future manufacturing service",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/services"],
    requiredGate: "manufacturer_qualification_and_product_safety_review",
  },
  {
    id: "product_passport",
    label: "商品ID・追跡・修理",
    stage: "managed_network",
    owner: "apps/commerce + apps/logistics",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/market"],
    requiredGate: "product_identity_provenance_and_recall_review",
  },
  {
    id: "circular_operations",
    label: "返品・修理・再販ネットワーク",
    stage: "managed_network",
    owner: "apps/logistics + apps/commerce",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/market"],
    requiredGate: "returns_repair_resale_and_used_goods_review",
  },
  {
    id: "work_market",
    label: "求人・仕事・人材市場",
    stage: "connected_market",
    owner: "apps/commerce",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/services"],
    requiredGate: "employment_information_and_intermediation_review",
  },
  {
    id: "research_market",
    label: "研究・知識市場",
    stage: "connected_market",
    owner: "apps/hub + apps/commerce",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/hubpedia", "/services"],
    requiredGate: "research_funding_ip_and_publication_review",
  },
  {
    id: "organization_os",
    label: "組織・コミュニティ運営OS",
    stage: "managed_network",
    owner: "apps/hub + services/account",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/community", "/services"],
    requiredGate: "organization_tenancy_permissions_and_audit_review",
  },
  {
    id: "insurance_connection",
    label: "安全・保険接続",
    stage: "connected_market",
    owner: "apps/commerce",
    enabled: false,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/market"],
    requiredGate: "licensed_provider_and_solicitation_review",
  },
  {
    id: "logistics",
    label: "Hub Logistics",
    stage: "connected_market",
    owner: "apps/logistics",
    enabled: true,
    hubOperatesUnderlyingBusiness: false,
    entryPoints: ["/market/sell"],
  },
] as const;

export const selectiveInfrastructureCandidates = [
  "data_center",
  "warehouse",
  "delivery_fleet",
  "automated_factory",
  "dedicated_ai_model",
] as const;

export const selectiveInfrastructureEntryCriteria = [
  "sustained_transaction_density",
  "lower_total_cost_than_external_provider",
  "service_quality_or_resilience_gain",
  "legal_and_operational_readiness",
  "reversible_pilot_and_exit_plan",
] as const;

export function validateHubExpansionPolicy() {
  const ids = hubExpansionCapabilities.map((item) => item.id);
  return {
    uniqueIds: new Set(ids).size === ids.length,
    enabledCapabilitiesAreOwned: hubExpansionCapabilities
      .filter((item) => item.enabled)
      .every((item) => item.owner.trim().length > 0),
    gatedCapabilitiesFailClosed: hubExpansionCapabilities
      .filter((item) => !item.enabled)
      .every((item) => Boolean(item.requiredGate)),
  };
}
