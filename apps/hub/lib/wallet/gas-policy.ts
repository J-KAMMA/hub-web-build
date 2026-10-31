// apps/wallet-extension/src/gas-policy.js の移植。

export const GAS_PRESETS = Object.freeze({
  economy: { feeMultiplierBps: 12000, priorityDivisor: 20 },
  standard: { feeMultiplierBps: 20000, priorityDivisor: 10 },
  fast: { feeMultiplierBps: 30000, priorityDivisor: 5 },
});

export const HARD_GAS_CEILINGS = Object.freeze({ callGasLimit: 100000n, verificationGasLimit: 3000000n, preVerificationGas: 200000n });

export const HARD_PAYMASTER_GAS_CEILINGS = Object.freeze({
  paymasterVerificationGasLimit: 1000000n,
  paymasterPostOpGasLimit: 500000n,
});

export const MAX_PAYMASTER_DATA_BYTES = 4096;

export type GasPolicyInput = {
  preset?: string;
  callGasLimit?: string | bigint | null;
  verificationGasLimit?: string | bigint | null;
  preVerificationGas?: string | bigint | null;
  minimumPriorityFeePerGas?: string | bigint | null;
};

export type ResolvedGasPolicy = {
  feeMultiplierBps: number;
  priorityDivisor: number;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  preset: keyof typeof GAS_PRESETS;
};

export function resolveGasPolicy(input: GasPolicyInput = {}): ResolvedGasPolicy {
  const preset = GAS_PRESETS[input.preset as keyof typeof GAS_PRESETS] ?? GAS_PRESETS.economy;
  const limits: Record<string, bigint> = {};
  for (const [field, hardLimit] of Object.entries(HARD_GAS_CEILINGS)) {
    let value: bigint;
    try {
      const raw = (input as Record<string, unknown>)[field];
      value = raw == null || raw === "" ? hardLimit : BigInt(raw as string | bigint);
    } catch {
      throw new Error(`invalid_gas_policy:${field}`);
    }
    if (value <= 0n || value > hardLimit) throw new Error(`invalid_gas_policy:${field}`);
    limits[field] = value;
  }
  return { ...preset, ...limits, preset: Object.hasOwn(GAS_PRESETS, input.preset ?? "") ? (input.preset as keyof typeof GAS_PRESETS) : "economy" } as ResolvedGasPolicy;
}
