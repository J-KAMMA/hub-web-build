export const HUB_MONETIZATION_POLICY_VERSION = "value-movement-v1" as const;

export const HUB_REVENUE_PRINCIPLE = {
  free: "conversation_and_user_owned_compute",
  paid: "transactions_compute_operations_distribution",
} as const;

export const HUB_FREE_CAPABILITIES = [
  "social.post",
  "social.reply",
  "social.follow",
  "social.dm.standard",
  "ai.local",
  "ai.user_owned_server",
  "ai.model_byok",
  "memory.local",
  "agent.mcp.low_frequency",
  "data.export",
  "agent.portability",
] as const;

export const HUB_FORBIDDEN_REVENUE_SOURCES = [
  "private_conversation_sale",
  "personal_data_sale",
  "ai_memory_lock_in",
  "post_view_charge",
  "user_owned_server_connection_tax",
] as const;

export const HUB_REVENUE_RATES = {
  /** Marketplace sales: 1% of the pre-tax item amount. */
  generalCommerceFeeBps: 100,
  /** Work commissions: 1%, only while HUB_WORK_COMMISSIONS_ENABLED is on. */
  workCommissionFeeBps: 100,
  /** Tips are direct wallet transfers; Hub takes nothing. */
  tipFeeBps: 0,
} as const;

export const HUB_WORK_COMMISSIONS_FLAG = "HUB_WORK_COMMISSIONS_ENABLED" as const;

export const HUB_PERSONAL_NODE_PLANS = [
  {
    id: "free",
    monthlyJpyMin: 0,
    monthlyJpyMax: 0,
    userOperated: true,
    capabilities: ["local_devices", "user_owned_server"],
  },
  {
    id: "node_lite",
    monthlyJpyMin: 980,
    monthlyJpyMax: 1_980,
    userOperated: false,
    capabilities: ["encrypted_backup", "device_sync", "lightweight_ai", "always_on"],
  },
  {
    id: "node_pro",
    monthlyJpyMin: 4_980,
    monthlyJpyMax: 9_800,
    userOperated: false,
    capabilities: ["large_memory", "agents", "vector_database", "files", "gpu", "recovery", "versions"],
  },
  {
    id: "organization",
    monthlyJpyMin: null,
    monthlyJpyMax: null,
    userOperated: false,
    capabilities: ["organization_node", "sso", "audit", "retention", "support"],
  },
] as const;

export function calculateBasisPointFee(amountMinor: number, feeBps: number) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("amountMinor must be a non-negative safe integer");
  }
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000) {
    throw new Error("feeBps must be an integer from 0 to 10000");
  }
  return Math.floor(amountMinor * feeBps / 10_000);
}
