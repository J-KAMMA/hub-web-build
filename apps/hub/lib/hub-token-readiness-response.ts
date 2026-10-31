export type HubTokenReadiness = {
  ok: boolean;
  database: "reachable";
  generationActive: boolean;
  generation: "exact-v1";
  reconciliationOk: boolean;
  onchainOk: boolean;
  onchainEnvironmentOk: boolean;
  onchainChainId: number;
  tokenContractAddress: string;
  checkpointContractAddress: string;
  scopeTokensOk: boolean;
  issuerSecretsOk: boolean;
  pendingRevenueCount: number;
  reviewRevenueCount: number;
  pendingRefundCount: number;
  pendingCheckpointCount: number;
  latestCheckpointEpoch: number;
  latestCheckpointSubmittedAt: string | null;
};

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function parseHubTokenReadiness(value: unknown): HubTokenReadiness | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const pendingRevenueCount = count(input.pendingRevenueCount);
  const reviewRevenueCount = count(input.reviewRevenueCount);
  const pendingRefundCount = count(input.pendingRefundCount);
  const pendingCheckpointCount = count(input.pendingCheckpointCount);
  const latestCheckpointEpoch = count(input.latestCheckpointEpoch);
  const submittedAt = input.latestCheckpointSubmittedAt;
  const reconciliation = input.reconciliation as Record<string, unknown> | null;
  const onchain = input.onchain as Record<string, unknown> | null;
  const scopeTokens = input.scopeTokens as Record<string, unknown> | null;
  const issuerSecrets = input.issuerSecrets as Record<string, unknown> | null;
  if (
    typeof input.ok !== "boolean" ||
    input.generation !== "exact-v1" ||
    input.database !== "reachable" ||
    typeof input.generationActive !== "boolean" ||
    !reconciliation || typeof reconciliation.ok !== "boolean" ||
    !onchain || typeof onchain.ok !== "boolean" ||
    typeof onchain.environmentOk !== "boolean" ||
    !Number.isSafeInteger(onchain.chainId) || Number(onchain.chainId) <= 0 ||
    typeof onchain.tokenContractAddress !== "string" ||
    !/^0x[0-9a-f]{40}$/.test(onchain.tokenContractAddress) ||
    typeof onchain.checkpointContractAddress !== "string" ||
    !/^0x[0-9a-f]{40}$/.test(onchain.checkpointContractAddress) ||
    !scopeTokens || typeof scopeTokens.ok !== "boolean" ||
    !issuerSecrets || typeof issuerSecrets.ok !== "boolean" ||
    input.ok !== (input.generationActive && reconciliation.ok && onchain.ok && scopeTokens.ok && issuerSecrets.ok) ||
    pendingRevenueCount === null ||
    reviewRevenueCount === null ||
    pendingRefundCount === null ||
    pendingCheckpointCount === null ||
    latestCheckpointEpoch === null ||
    !(submittedAt === null || (typeof submittedAt === "string" && Number.isFinite(Date.parse(submittedAt))))
  ) return null;
  return {
    ok: input.ok,
    database: "reachable",
    generation: "exact-v1",
    generationActive: input.generationActive,
    reconciliationOk: reconciliation.ok,
    onchainOk: onchain.ok,
    onchainEnvironmentOk: onchain.environmentOk,
    onchainChainId: Number(onchain.chainId),
    tokenContractAddress: onchain.tokenContractAddress as string,
    checkpointContractAddress: onchain.checkpointContractAddress as string,
    scopeTokensOk: scopeTokens.ok,
    issuerSecretsOk: issuerSecrets.ok,
    pendingRevenueCount,
    reviewRevenueCount,
    pendingRefundCount,
    pendingCheckpointCount,
    latestCheckpointEpoch,
    latestCheckpointSubmittedAt: submittedAt === null ? null : new Date(submittedAt as string).toISOString(),
  };
}
