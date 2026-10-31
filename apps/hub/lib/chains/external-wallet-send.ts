// 外部ウォレット（MetaMask・Rabby・Coinbase Wallet など）から送る処理。
// EIP-6963 で注入ウォレットを列挙し、EIP-1193 で接続・チェーン切替・送信する。
// 非カストディアル: トランザクションはブラウザで組み立て、署名はユーザーのウォレットが行う。
// Hubサーバーは鍵にもトランザクションにも触れない。送金（対価・贈与）のみで、
// 交換・ブリッジ・価格比較は扱わない。
// ウォレットへ渡す RPC は registry の publicRpcUrls だけ（サーバーの HUB_RPC_URL_* は使わない）。

import { getEvmChain, type EvmChainEntry } from "@/lib/chains/evm-chain-registry";
import { parseNativeAmount } from "@/lib/wallet/transaction";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ERC20_TRANSFER = "0xa9059cbb";

export type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

export type Eip6963ProviderInfo = { uuid: string; name: string; icon: string; rdns: string };
export type Eip6963Detail = { info: Eip6963ProviderInfo; provider: Eip1193Provider };

export type ExternalWallet = { id: string; name: string; icon: string; rdns: string; provider: Eip1193Provider };

export type SendAsset =
  | { kind: "native" }
  | { kind: "erc20"; address: string; symbol: string; decimals: number };

export type ExternalSendErrorCode =
  | "user_rejected"
  | "chain_not_supported"
  | "chain_add_unavailable"
  | "chain_switch_failed"
  | "invalid_recipient"
  | "invalid_sender"
  | "invalid_asset"
  | "token_not_contract"
  | "token_read_failed"
  | "invalid_amount"
  | "too_many_decimals"
  | "wallet_unavailable"
  | "send_failed";

export class ExternalSendError extends Error {
  code: ExternalSendErrorCode;
  constructor(code: ExternalSendErrorCode) {
    super(code);
    this.name = "ExternalSendError";
    this.code = code;
  }
}

function rpcCode(error: unknown): number | null {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "number") return code;
    const inner = (error as { data?: { originalError?: { code?: unknown } } }).data?.originalError?.code;
    if (typeof inner === "number") return inner;
  }
  return null;
}

export function toHexChainId(chainId: number): `0x${string}` {
  return `0x${chainId.toString(16)}`;
}

/** EIP-6963: 注入ウォレットを列挙する。target は window 相当。 */
export function discoverExternalWallets(
  target: Pick<Window, "addEventListener" | "removeEventListener" | "dispatchEvent">,
  onChange: (wallets: ExternalWallet[]) => void,
): () => void {
  const found = new Map<string, ExternalWallet>();
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963Detail>).detail;
    if (!detail || !detail.info || typeof detail.info.uuid !== "string" || typeof detail.provider?.request !== "function") return;
    const name = typeof detail.info.name === "string" ? detail.info.name.slice(0, 60) : "Wallet";
    const icon = typeof detail.info.icon === "string" && detail.info.icon.startsWith("data:image/") ? detail.info.icon : "";
    found.set(detail.info.uuid, { id: detail.info.uuid, name, icon, rdns: String(detail.info.rdns ?? ""), provider: detail.provider });
    onChange([...found.values()]);
  };
  target.addEventListener("eip6963:announceProvider", handler);
  target.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => target.removeEventListener("eip6963:announceProvider", handler);
}

export async function connectExternalWallet(wallet: ExternalWallet): Promise<string> {
  let accounts: unknown;
  try {
    accounts = await wallet.provider.request({ method: "eth_requestAccounts" });
  } catch (error) {
    throw new ExternalSendError(rpcCode(error) === 4001 ? "user_rejected" : "wallet_unavailable");
  }
  const first = Array.isArray(accounts) ? accounts[0] : null;
  if (typeof first !== "string" || !ADDRESS.test(first)) throw new ExternalSendError("invalid_sender");
  return first;
}

/** wallet_addEthereumChain に渡す引数。rpcUrls は publicRpcUrls のみ。 */
export function buildAddChainParams(entry: EvmChainEntry) {
  return {
    chainId: toHexChainId(entry.chainId),
    chainName: entry.name,
    nativeCurrency: { name: entry.nativeName, symbol: entry.nativeSymbol, decimals: entry.nativeDecimals },
    rpcUrls: entry.publicRpcUrls.filter((url) => url.startsWith("https://")),
    blockExplorerUrls: [entry.explorerUrl],
  };
}

export function canOfferAddChain(entry: EvmChainEntry): boolean {
  return entry.publicRpcUrls.some((url) => url.startsWith("https://"));
}

/**
 * wallet_switchEthereumChain。4902（未登録）なら公開RPCがあるときだけ
 * wallet_addEthereumChain して再度切り替える。4001 は user_rejected。
 */
export async function ensureWalletChain(provider: Eip1193Provider, chainId: number): Promise<void> {
  const entry = getEvmChain(chainId);
  if (!entry) throw new ExternalSendError("chain_not_supported");
  const hex = toHexChainId(chainId);
  const doSwitch = () => provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
  try {
    await doSwitch();
    return;
  } catch (error) {
    const code = rpcCode(error);
    if (code === 4001) throw new ExternalSendError("user_rejected");
    if (code !== 4902) throw new ExternalSendError("chain_switch_failed");
  }
  if (!canOfferAddChain(entry)) throw new ExternalSendError("chain_add_unavailable");
  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [buildAddChainParams(entry)] });
  } catch (error) {
    throw new ExternalSendError(rpcCode(error) === 4001 ? "user_rejected" : "chain_switch_failed");
  }
  try {
    await doSwitch();
  } catch (error) {
    throw new ExternalSendError(rpcCode(error) === 4001 ? "user_rejected" : "chain_switch_failed");
  }
}

function pad32(value: string): string {
  return value.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

/** ERC-20 transfer(address,uint256) のコールデータ。 */
export function encodeErc20Transfer(to: string, amount: bigint): `0x${string}` {
  if (!ADDRESS.test(to)) throw new ExternalSendError("invalid_recipient");
  if (amount <= 0n || amount >= 1n << 256n) throw new ExternalSendError("invalid_amount");
  return `${ERC20_TRANSFER}${pad32(to)}${amount.toString(16).padStart(64, "0")}` as `0x${string}`;
}

function parseAmount(text: string, decimals: number): bigint {
  try {
    return parseNativeAmount(text.trim(), decimals);
  } catch (error) {
    throw new ExternalSendError(error instanceof Error && error.message === "too_many_decimals" ? "too_many_decimals" : "invalid_amount");
  }
}

export type BuiltTransfer = {
  chainId: number;
  tx: { from: string; to: string; value: `0x${string}`; data?: `0x${string}` };
  amount: bigint;
  symbol: string;
  decimals: number;
  recipient: string;
};

/** ブラウザ内でトランザクションを組み立てる（署名はウォレット）。 */
export function buildTransfer(input: { chainId: number; from: string; to: string; amount: string; asset: SendAsset }): BuiltTransfer {
  const entry = getEvmChain(input.chainId);
  if (!entry) throw new ExternalSendError("chain_not_supported");
  if (!ADDRESS.test(input.from)) throw new ExternalSendError("invalid_sender");
  if (!ADDRESS.test(input.to) || /^0x0{40}$/i.test(input.to)) throw new ExternalSendError("invalid_recipient");
  if (input.asset.kind === "native") {
    const amount = parseAmount(input.amount, entry.nativeDecimals);
    return { chainId: entry.chainId, tx: { from: input.from, to: input.to, value: `0x${amount.toString(16)}` }, amount, symbol: entry.nativeSymbol, decimals: entry.nativeDecimals, recipient: input.to };
  }
  const token = input.asset;
  if (!ADDRESS.test(token.address) || !Number.isInteger(token.decimals) || token.decimals < 0 || token.decimals > 36 || !token.symbol) {
    throw new ExternalSendError("invalid_asset");
  }
  const amount = parseAmount(input.amount, token.decimals);
  return {
    chainId: entry.chainId,
    tx: { from: input.from, to: token.address, value: "0x0", data: encodeErc20Transfer(input.to, amount) },
    amount,
    symbol: token.symbol,
    decimals: token.decimals,
    recipient: input.to,
  };
}

export function formatUnits(value: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  const fraction = (value % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export type TokenMetadata = { address: string; symbol: string; decimals: number };

type RpcReader = (method: string, params: unknown[]) => Promise<string | null>;

function hexToBytes(hex: string): number[] {
  const body = hex.replace(/^0x/, "");
  const out: number[] = [];
  for (let i = 0; i + 1 < body.length; i += 2) out.push(parseInt(body.slice(i, i + 2), 16));
  return out;
}

function printable(bytes: number[]): string | null {
  if (bytes.length === 0 || bytes.length > 32) return null;
  const text = String.fromCharCode(...bytes);
  return /^[ -~]+$/.test(text) ? text.trim() || null : null;
}

/** symbol() の戻り値: 動的 string、または古いトークンの bytes32。 */
export function decodeErc20Symbol(result: string): string | null {
  if (!/^0x[0-9a-fA-F]*$/.test(result)) return null;
  const bytes = hexToBytes(result);
  if (bytes.length === 32) return printable(bytes.filter((b) => b !== 0));
  if (bytes.length < 64) return null;
  const word = (at: number) => bytes.slice(at, at + 32).reduce((acc, b) => acc * 256 + b, 0);
  const offset = word(0);
  if (offset !== 32) return null;
  const length = word(32);
  if (length === 0 || length > 32 || bytes.length < 64 + length) return null;
  return printable(bytes.slice(64, 64 + length));
}

export function decodeErc20Decimals(result: string): number | null {
  if (!/^0x[0-9a-fA-F]{64}$/.test(result)) return null;
  const value = BigInt(result);
  return value <= 36n ? Number(value) : null;
}

/**
 * トークンの decimals() と symbol() をコントラクトから読む。手入力へはフォールバックしない。
 * 読み取り先は対象チェーンの公開RPC。対象チェーンと同じチェーンにいるウォレットの provider も使える。
 * コードが無い（コントラクトでない）アドレスは token_not_contract、読めなければ token_read_failed。
 */
export async function readErc20Metadata(
  chainId: number,
  address: string,
  options: { provider?: Eip1193Provider; fetcher?: typeof fetch } = {},
): Promise<TokenMetadata> {
  const entry = getEvmChain(chainId);
  if (!entry) throw new ExternalSendError("chain_not_supported");
  if (!ADDRESS.test(address)) throw new ExternalSendError("invalid_asset");
  const readers: RpcReader[] = entry.publicRpcUrls.map((url) => (method, params) => publicRpc(url, method, params, options.fetcher ?? fetch));
  const provider = options.provider;
  if (provider) {
    readers.push(async (method, params) => {
      try {
        const id = await provider.request({ method: "eth_chainId" });
        if (typeof id !== "string" || parseInt(id, 16) !== chainId) return null;
        const result = await provider.request({ method, params });
        return typeof result === "string" ? result : null;
      } catch {
        return null;
      }
    });
  }
  for (const read of readers) {
    const code = await read("eth_getCode", [address, "latest"]);
    if (code === null) continue;
    if (/^0x0*$/.test(code)) throw new ExternalSendError("token_not_contract");
    const [decimalsRaw, symbolRaw] = await Promise.all([
      read("eth_call", [{ to: address, data: "0x313ce567" }, "latest"]),
      read("eth_call", [{ to: address, data: "0x95d89b41" }, "latest"]),
    ]);
    const decimals = decimalsRaw ? decodeErc20Decimals(decimalsRaw) : null;
    const symbol = symbolRaw ? decodeErc20Symbol(symbolRaw) : null;
    if (decimals !== null && symbol) return { address, symbol, decimals };
    throw new ExternalSendError("token_read_failed");
  }
  throw new ExternalSendError("token_read_failed");
}

export type FeeEstimate = { wei: bigint; text: string } | null;

async function publicRpc(url: string, method: string, params: unknown[], fetcher: typeof fetch): Promise<string | null> {
  try {
    const response = await fetcher(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
    if (!response.ok) return null;
    const body = (await response.json()) as { result?: unknown };
    return typeof body.result === "string" && /^0x[0-9a-fA-F]*$/.test(body.result) ? body.result : null;
  } catch {
    return null;
  }
}

/** 公開RPCで手数料を概算する。取得できなければ null（確認画面は「ウォレットで表示」と案内）。 */
export async function estimateFee(transfer: BuiltTransfer, fetcher: typeof fetch = fetch): Promise<FeeEstimate> {
  const entry = getEvmChain(transfer.chainId);
  if (!entry) return null;
  for (const url of entry.publicRpcUrls) {
    const [gas, price] = await Promise.all([
      publicRpc(url, "eth_estimateGas", [transfer.tx], fetcher),
      publicRpc(url, "eth_gasPrice", [], fetcher),
    ]);
    if (gas && price && gas.length > 2 && price.length > 2) {
      const wei = BigInt(gas) * BigInt(price);
      return { wei, text: `${formatUnits(wei, entry.nativeDecimals)} ${entry.nativeSymbol}` };
    }
  }
  return null;
}

export type ConfirmationContent = {
  chainName: string;
  chainId: number;
  from: string;
  to: string;
  amountText: string;
  symbol: string;
  feeText: string | null;
  walletName: string;
  /** ウォレットがネットワークの追加または切替を求める旨の注意 */
  networkNote: string;
  willOfferAddChain: boolean;
  /** 送金であり取引（交換）ではない旨 */
  transferNote: string;
};

export function buildConfirmation(input: { transfer: BuiltTransfer; fee: FeeEstimate; walletName: string; japanese: boolean }): ConfirmationContent {
  const entry = getEvmChain(input.transfer.chainId);
  if (!entry) throw new ExternalSendError("chain_not_supported");
  const { japanese } = input;
  return {
    chainName: entry.name,
    chainId: entry.chainId,
    from: input.transfer.tx.from,
    to: input.transfer.recipient,
    amountText: formatUnits(input.transfer.amount, input.transfer.decimals),
    symbol: input.transfer.symbol,
    feeText: input.fee ? input.fee.text : null,
    walletName: input.walletName,
    willOfferAddChain: canOfferAddChain(entry),
    networkNote: japanese
      ? `お使いのウォレット（${input.walletName}）が、${entry.name} への切り替え、または未登録の場合はネットワークの追加を求めます。内容を確認して承認してください。`
      : `Your wallet (${input.walletName}) will ask to switch to ${entry.name}, or to add the network if it is not registered. Review and approve it there.`,
    transferNote: japanese
      ? "これは宛先への送金です。交換・取引ではありません。署名はウォレットで行い、Hubは鍵も資金も預かりません。"
      : "This is a transfer to the recipient, not an exchange or trade. You sign in your wallet; Hub never holds keys or funds.",
  };
}

/** チェーン切替（必要なら追加）→ eth_sendTransaction。tx ハッシュを返す。 */
export async function sendExternalTransfer(wallet: ExternalWallet, transfer: BuiltTransfer): Promise<{ hash: string; explorerUrl: string }> {
  const entry = getEvmChain(transfer.chainId);
  if (!entry) throw new ExternalSendError("chain_not_supported");
  await ensureWalletChain(wallet.provider, transfer.chainId);
  let hash: unknown;
  try {
    hash = await wallet.provider.request({ method: "eth_sendTransaction", params: [transfer.tx] });
  } catch (error) {
    throw new ExternalSendError(rpcCode(error) === 4001 ? "user_rejected" : "send_failed");
  }
  if (typeof hash !== "string" || !HASH.test(hash)) throw new ExternalSendError("send_failed");
  return { hash, explorerUrl: `${entry.explorerUrl.replace(/\/$/, "")}/tx/${hash}` };
}

export function externalSendErrorMessage(code: string, japanese: boolean): string {
  const ja: Record<string, string> = {
    user_rejected: "ウォレットで拒否されました。送金は行われていません。",
    chain_not_supported: "このチェーンは対応していません。",
    chain_add_unavailable: "このチェーンの公開RPCが登録されていないため、Hubからは追加できません。先にウォレットでこのチェーンを追加してください。",
    chain_switch_failed: "ウォレットのネットワーク切り替えに失敗しました。",
    invalid_recipient: "宛先アドレスが正しくありません。",
    invalid_sender: "ウォレットのアドレスを取得できませんでした。",
    invalid_asset: "資産の指定が正しくありません。",
    token_not_contract: "このアドレスはこのチェーン上のコントラクトではありません。送金できません。",
    token_read_failed: "トークンの桁数とシンボルをコントラクトから読み取れませんでした。送金できません。",
    invalid_amount: "金額が正しくありません。",
    too_many_decimals: "小数の桁数が多すぎます。",
    wallet_unavailable: "ウォレットに接続できませんでした。",
    send_failed: "送信できませんでした。",
  };
  const en: Record<string, string> = {
    user_rejected: "Rejected in the wallet. Nothing was sent.",
    chain_not_supported: "This chain is not supported.",
    chain_add_unavailable: "No public RPC is registered for this chain, so Hub cannot add it. Add the chain in your wallet first.",
    chain_switch_failed: "Switching the wallet network failed.",
    invalid_recipient: "The recipient address is invalid.",
    invalid_sender: "Could not read the wallet address.",
    invalid_asset: "The asset is invalid.",
    token_not_contract: "This address is not a contract on this chain. Sending is blocked.",
    token_read_failed: "Could not read decimals and symbol from the token contract. Sending is blocked.",
    invalid_amount: "The amount is invalid.",
    too_many_decimals: "Too many decimal places.",
    wallet_unavailable: "Could not connect to the wallet.",
    send_failed: "Could not send.",
  };
  return (japanese ? ja : en)[code] ?? (japanese ? "送信できませんでした。" : "Could not send.");
}
