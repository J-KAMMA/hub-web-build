// ウォレットの表示用の小さな関数。/v2/wallet（V2NativeWallet）と右列のウォレット（V2AsideWallet）で共有する。
// 状態も鍵も持たない純粋な関数だけを置く。

import type { HubWalletNetwork, HubWalletToken } from "@/lib/wallet/networks";

const ERC20_BALANCE_OF = "0x70a08231";

export function pad32(value: string): string {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export function erc20BalanceOfData(account: string): string {
  return `${ERC20_BALANCE_OF}${pad32(account)}`;
}

export function formatTokenQuantity(value: bigint, token: HubWalletToken): string {
  const scale = 10n ** BigInt(token.decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(token.decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""} ${token.symbol}`;
}

export function shortAddress(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export function shortHash(value: string): string {
  return `${value.slice(0, 14)}…`;
}

export function chainTag(network: HubWalletNetwork | null, japanese: boolean): string {
  if (!network) return "";
  return network.testnet ? (japanese ? "テストネット" : "testnet") : (japanese ? "メインネット" : "mainnet");
}
