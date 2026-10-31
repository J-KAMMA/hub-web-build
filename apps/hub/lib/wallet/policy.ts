// apps/wallet-extension/src/policy.js の移植。

export const HUB_PROFILE_LINK_METHOD = "hub_signProfileLink";
export const LEGACY_RAW_HUB_SIGNING_METHOD = "hub_signWalletChallenge";
export const SIGNING_METHODS = new Set(["personal_sign", "eth_signTypedData_v4", HUB_PROFILE_LINK_METHOD, "eth_sendTransaction"]);
export const READ_METHODS = new Set(["eth_accounts", "eth_requestAccounts", "eth_chainId"]);
export const RPC_READ_METHODS = new Set(["eth_blockNumber", "eth_call", "eth_estimateGas", "eth_feeHistory", "eth_gasPrice", "eth_getBalance", "eth_getCode", "eth_getTransactionCount", "eth_getTransactionReceipt", "net_version"]);
export const NETWORK_METHODS = new Set(["wallet_switchEthereumChain", "wallet_addEthereumChain"]);
// EIP-5792。バッチ＝UserOperation 1つ＝パスキー確認1回。
export const BATCH_METHODS = new Set(["wallet_getCapabilities", "wallet_sendCalls", "wallet_getCallsStatus"]);
// Hub独自口: hub_sendBatchTransaction はCommerce注文の sponsored バッチ、
// hub_prepareSponsoredCall は session-key 署名前の callDataHash 読み出し。
export const HUB_METHODS = new Set(["hub_sendBatchTransaction", "hub_prepareSponsoredCall"]);

export function normalizedOrigin(value: string): string {
  const url = new URL(value);
  if (url.username || url.password || !["https:", "http:"].includes(url.protocol)) throw new Error("invalid_origin");
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !loopback) throw new Error("insecure_origin");
  return url.origin;
}

// ページ内ウォレットの要求元は常に自分自身のオリジン。外部注入の信頼境界は
// 拡張機能側が持つため、ここでは current origin 一致のみを信頼済みとする。
export function isTrustedHubOrigin(value: string, expected = typeof location !== "undefined" ? location.origin : ""): boolean {
  try {
    return normalizedOrigin(value) === expected && expected !== "";
  } catch {
    return false;
  }
}

export function assertSupportedMethod(method: string) {
  if (method === LEGACY_RAW_HUB_SIGNING_METHOD) throw Object.assign(new Error("raw_hub_challenge_signing_removed"), { code: 4200 });
  if (!READ_METHODS.has(method) && !RPC_READ_METHODS.has(method) && !SIGNING_METHODS.has(method) && !NETWORK_METHODS.has(method) && !BATCH_METHODS.has(method) && !HUB_METHODS.has(method)) throw Object.assign(new Error("unsupported_method"), { code: 4200 });
}
