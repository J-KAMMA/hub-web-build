const BASIS_POINTS = 10_000;

export interface CreatorRevenueInput {
  profileId: string;
  eligibleUnits: number;
}

export interface CreatorRevenueAllocation extends CreatorRevenueInput {
  amountMicros: number;
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer.`);
}

export function allocateCreatorRevenue(
  grossRevenueMicros: number,
  inputs: CreatorRevenueInput[],
  platformFeeBps = 3000,
): { platformFeeMicros: number; distributableMicros: number; allocations: CreatorRevenueAllocation[] } {
  assertInteger(grossRevenueMicros, "grossRevenueMicros");
  if (!Number.isInteger(platformFeeBps) || platformFeeBps < 0 || platformFeeBps > BASIS_POINTS) {
    throw new Error("platformFeeBps must be an integer between 0 and 10000.");
  }

  const aggregated = new Map<string, number>();
  for (const input of inputs) {
    const profileId = input.profileId.trim();
    if (!profileId || profileId.length > 128) throw new Error("profileId is invalid.");
    if (!Number.isSafeInteger(input.eligibleUnits) || input.eligibleUnits <= 0) {
      throw new Error("eligibleUnits must be a positive safe integer.");
    }
    const next = (aggregated.get(profileId) ?? 0) + input.eligibleUnits;
    if (!Number.isSafeInteger(next)) throw new Error("eligibleUnits total is too large.");
    aggregated.set(profileId, next);
  }

  const distributableMicros = Math.floor(grossRevenueMicros * (BASIS_POINTS - platformFeeBps) / BASIS_POINTS);
  const platformFeeMicros = grossRevenueMicros - distributableMicros;
  const totalUnits = [...aggregated.values()].reduce((sum, units) => sum + units, 0);
  if (totalUnits === 0 || distributableMicros === 0) {
    return { platformFeeMicros, distributableMicros, allocations: [] };
  }

  const distributable = BigInt(distributableMicros);
  const divisor = BigInt(totalUnits);
  const rows = [...aggregated].map(([profileId, eligibleUnits]) => {
    const numerator = distributable * BigInt(eligibleUnits);
    return {
      profileId,
      eligibleUnits,
      amountMicros: Number(numerator / divisor),
      remainder: numerator % divisor,
    };
  });
  let remainderMicros = distributableMicros - rows.reduce((sum, row) => sum + row.amountMicros, 0);
  rows.sort((left, right) => left.remainder === right.remainder
    ? left.profileId.localeCompare(right.profileId)
    : left.remainder > right.remainder ? -1 : 1);
  for (let index = 0; index < rows.length && remainderMicros > 0; index += 1, remainderMicros -= 1) {
    rows[index].amountMicros += 1;
  }

  return {
    platformFeeMicros,
    distributableMicros,
    allocations: rows.map(({ profileId, eligibleUnits, amountMicros }) => ({ profileId, eligibleUnits, amountMicros })),
  };
}
