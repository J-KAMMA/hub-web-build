/**
 * Chain families and CAIP-2 references (docs/hub-multichain/SOLANA-BITCOIN-DESIGN.md section 1.1).
 * Pure module: no server-only imports, shared by the UI, the server and tests.
 */
export type ChainFamily = "evm" | "solana" | "bitcoin";
export type ChainNamespace = "eip155" | "solana" | "bip122";
export type ChainRef = `eip155:${number}` | `solana:${string}` | `bip122:${string}`;

const FAMILY_BY_NAMESPACE: Record<ChainNamespace, ChainFamily> = { eip155: "evm", solana: "solana", bip122: "bitcoin" };
const NAMESPACE_BY_FAMILY: Record<ChainFamily, ChainNamespace> = { evm: "eip155", solana: "solana", bitcoin: "bip122" };

export function familyOf(ref: string): ChainFamily {
  const namespace = ref.split(":", 1)[0] as ChainNamespace;
  const family = FAMILY_BY_NAMESPACE[namespace];
  if (!family || !ref.includes(":")) throw new Error(`Unknown chain reference: ${ref}`);
  return family;
}

export function namespaceOf(family: ChainFamily): ChainNamespace {
  return NAMESPACE_BY_FAMILY[family];
}
