export function normalizeWalletAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const address = value.trim();
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address : null;
}

export function shortWalletAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function parseChainId(value: unknown): number | null {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) return null;
  const chainId = Number.parseInt(value.slice(2), 16);
  return Number.isSafeInteger(chainId) && chainId > 0 ? chainId : null;
}

export function walletNetworkLabel(chainId: number | null): string {
  if (chainId === 1) return "Ethereum";
  if (chainId === 137) return "Polygon";
  if (chainId === 8453) return "Base";
  if (chainId === 42161) return "Arbitrum One";
  if (chainId === 10) return "Optimism";
  return chainId ? `Chain ${chainId}` : "ネットワーク未確認";
}
