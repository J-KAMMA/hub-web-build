const BASE_UNITS_PER_HUB = 10n ** 18n;

export function parseHubTokenBaseUnits(value: unknown): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value))
    throw new Error("invalid_hub_token_base_units");
  return BigInt(value);
}

export function wholeHubUnits(baseUnits: bigint): string {
  if (baseUnits < 0n) throw new Error("invalid_hub_token_base_units");
  return String(baseUnits / BASE_UNITS_PER_HUB);
}
