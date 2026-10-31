const DECIMAL = /^(0|[1-9][0-9]{0,77})$/;
const UINT256_MAX = (1n << 256n) - 1n;
const LEVELS = new Set(["supporter", "silver", "gold", "platinum"]);
const ONCHAIN_STATUSES = new Set(["waiting", "pending", "submitted", "confirmed", "failed", "not_required"]);
const HUB_BASE_UNIT_SCALE = 10n ** 18n;
const BALANCE_FIELDS = [
  "balanceBaseUnits",
  "issuedBaseUnits",
  "reversedBaseUnits",
  "pendingBaseUnits",
  "benefitEligibleBaseUnits",
  "last30DaysBaseUnits",
  "last365DaysBaseUnits",
] as const;

function isBaseUnits(value: unknown): value is string {
  return typeof value === "string" && DECIMAL.test(value) && BigInt(value) <= UINT256_MAX;
}

type Balance = Record<(typeof BALANCE_FIELDS)[number], string> & {
  byServiceBaseUnits: Array<{ service: string; issuedBaseUnits: string }>;
  updatedAt: string | null;
};
type Entry = {
  kind: "revenue" | "refund";
  id: string;
  service: string;
  units: string;
  status: string;
  chainId: number;
  occurredAt: string;
  onchainStatus: string;
  onchainChainId: number | null;
  onchainContractAddress: string | null;
  onchainTransactionHash: string | null;
};
export type ValidatedContributionBatch = {
  contributions: Array<{
    address: string;
    balance: Balance;
    entries: Entry[];
  }>;
  aggregate: Balance & { level: "supporter" | "silver" | "gold" | "platinum" };
};

export function normalizeHubTokenBenefits(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    if (typeof candidate !== "string") continue;
    const benefit = candidate.trim();
    if (!benefit || benefit.length > 120 || seen.has(benefit)) continue;
    seen.add(benefit);
    result.push(benefit);
    if (result.length === 12) break;
  }
  return result;
}

export function hubTokenContributionLevel(
  benefitEligibleBaseUnits: string,
): "supporter" | "silver" | "gold" | "platinum" {
  if (!isBaseUnits(benefitEligibleBaseUnits))
    throw new Error("invalid_hub_token_benefit_units");
  const wholeHub = BigInt(benefitEligibleBaseUnits) / HUB_BASE_UNIT_SCALE;
  if (wholeHub >= 10_000_000n) return "platinum";
  if (wholeHub >= 1_000_000n) return "gold";
  if (wholeHub >= 100_000n) return "silver";
  return "supporter";
}

function entry(value: unknown): Entry | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    (row.kind !== "revenue" && row.kind !== "refund") ||
    typeof row.id !== "string" ||
    !/^[A-Za-z0-9:_-]{1,160}$/.test(row.id) ||
    typeof row.service !== "string" ||
    !/^[a-z][a-z0-9-]{1,31}$/.test(row.service) ||
    !isBaseUnits(row.units) ||
    typeof row.status !== "string" ||
    !/^[a-z][a-z0-9_]{0,31}$/.test(row.status) ||
    !Number.isSafeInteger(row.chainId) ||
    Number(row.chainId) <= 0 ||
    typeof row.occurredAt !== "string" ||
    !Number.isFinite(Date.parse(row.occurredAt)) ||
    typeof row.onchainStatus !== "string" ||
    !ONCHAIN_STATUSES.has(row.onchainStatus) ||
    (row.onchainChainId !== null &&
      (!Number.isSafeInteger(row.onchainChainId) ||
        Number(row.onchainChainId) <= 0)) ||
    (row.onchainContractAddress !== null &&
      (typeof row.onchainContractAddress !== "string" ||
        !/^0x[0-9a-fA-F]{40}$/.test(row.onchainContractAddress))) ||
    (row.onchainTransactionHash !== null &&
      (typeof row.onchainTransactionHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(row.onchainTransactionHash)))
  )
    return null;
  const hasChain = row.onchainChainId !== null;
  const hasContract = row.onchainContractAddress !== null;
  const hasTransaction = row.onchainTransactionHash !== null;
  const completeProof = hasChain && hasContract && hasTransaction;
  if (
    (["submitted", "confirmed"].includes(row.onchainStatus) && !completeProof) ||
    (row.onchainStatus === "not_required" && (hasChain || hasContract || hasTransaction)) ||
    ((hasChain || hasContract || hasTransaction) && !completeProof)
  )
    return null;
  return value as Entry;
}

function balance(value: unknown): Balance | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (
    !BALANCE_FIELDS.every(
      (field) => isBaseUnits(row[field]),
    )
  )
    return null;
  if (
    !Array.isArray(row.byServiceBaseUnits) ||
    !row.byServiceBaseUnits.every(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.service === "string" &&
        /^[a-z][a-z0-9-]{1,31}$/.test(item.service) &&
        isBaseUnits(item.issuedBaseUnits),
    )
  )
    return null;
  if (
    new Set(row.byServiceBaseUnits.map((item) => item.service)).size !==
    row.byServiceBaseUnits.length
  )
    return null;
  if (
    row.updatedAt !== null &&
    (typeof row.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(row.updatedAt)))
  )
    return null;
  const issued = BigInt(row.issuedBaseUnits as string);
  const reversed = BigInt(row.reversedBaseUnits as string);
  const balanceBaseUnits = BigInt(row.balanceBaseUnits as string);
  const serviceIssued = row.byServiceBaseUnits.reduce(
    (sum, item) => sum + BigInt(item.issuedBaseUnits),
    0n,
  );
  if (
    reversed > issued ||
    balanceBaseUnits !== issued - reversed ||
    serviceIssued !== issued ||
    BigInt(row.benefitEligibleBaseUnits as string) > balanceBaseUnits ||
    BigInt(row.last30DaysBaseUnits as string) > balanceBaseUnits ||
    BigInt(row.last365DaysBaseUnits as string) > balanceBaseUnits
  )
    return null;
  return value as Balance;
}

export function validateContributionBatch(
  value: unknown,
  expectedAddresses: string[],
): ValidatedContributionBatch | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Record<string, unknown>;
  if (
    !Array.isArray(payload.contributions) ||
    payload.contributions.length !== expectedAddresses.length
  )
    return null;
  const contributions: ValidatedContributionBatch["contributions"] = [];
  for (let index = 0; index < expectedAddresses.length; index += 1) {
    const candidate = payload.contributions[index];
    if (!candidate || typeof candidate !== "object") return null;
    const row = candidate as Record<string, unknown>;
    const parsedBalance = balance(row.balance);
    const entries = Array.isArray(row.entries)
      ? row.entries.map(entry)
      : null;
    if (
      row.address !== expectedAddresses[index] ||
      !parsedBalance ||
      !entries ||
      entries.length > 50 ||
      entries.some((item) => item === null)
    )
      return null;
    contributions.push({
      address: row.address,
      balance: parsedBalance,
      entries: entries as Entry[],
    });
  }
  const aggregate = balance(payload.aggregate);
  const level = (payload.aggregate as Record<string, unknown> | null)?.level;
  if (
    !aggregate ||
    typeof level !== "string" ||
    !LEVELS.has(level) ||
    level !== hubTokenContributionLevel(aggregate.benefitEligibleBaseUnits)
  )
    return null;
  for (const field of BALANCE_FIELDS) {
    const expected = contributions.reduce(
      (sum, row) => sum + BigInt(row.balance[field]),
      0n,
    );
    if (BigInt(aggregate[field]) !== expected) return null;
  }
  const services = new Map<string, bigint>();
  for (const row of contributions)
    for (const item of row.balance.byServiceBaseUnits) {
      services.set(
        item.service,
        (services.get(item.service) ?? 0n) + BigInt(item.issuedBaseUnits),
      );
    }
  const aggregateServices = new Map(
    aggregate.byServiceBaseUnits.map((item) => [
      item.service,
      BigInt(item.issuedBaseUnits),
    ]),
  );
  if (
    services.size !== aggregateServices.size ||
    [...services].some(
      ([service, amount]) => aggregateServices.get(service) !== amount,
    )
  )
    return null;
  return {
    contributions,
    aggregate: {
      ...aggregate,
      level,
    } as ValidatedContributionBatch["aggregate"],
  };
}
