// Hardware-wallet signer (Ledger over WebHID) exposed as an EIP-1193 provider.
//
// Non-custodial: the private key never leaves the device; Hub never sees it, never stores it,
// and never derives it. Every signature is (1) summarised by Hub with reviewDappRequest and
// confirmed by the user, then (2) confirmed again on the device. Anything unexpected fails closed.
// Hub does not choose swap routes or build exchange requests; it only relays what the caller asks.

import { parseTransaction, recoverTransactionAddress, serializeTransaction } from "viem";
import { normalizeWalletAddress } from "@/lib/hub-wallet";
import { assertTransactionNetwork, normalizeChainId, walletNetwork } from "@/lib/wallet/networks";
import { rpcRequest } from "@/lib/wallet/rpc-client";
import { reviewDappRequest, type DappRequestReview } from "@/lib/wallet-request-safety";

export const DEFAULT_HARDWARE_PATH = "m/44'/60'/0'/0/0";
export const HARDWARE_ACCOUNT_LIST_SIZE = 5;

export type HardwareSignature = { v: number | string; r: string; s: string };

/** The subset of @ledgerhq/hw-app-eth that Hub uses. A mock implements the same shape in tests. */
export type LedgerEthApp = {
  getAddress(path: string, display?: boolean): Promise<{ address: string; publicKey?: string }>;
  /** Several paths in one device request (Trezor asks for permission once per request, not per path). */
  getAddresses?(paths: string[]): Promise<Array<{ address: string }>>;
  signPersonalMessage(path: string, messageHex: string): Promise<HardwareSignature>;
  signEIP712Message(path: string, message: Record<string, unknown>): Promise<HardwareSignature>;
  signTransaction(path: string, rawTxHex: string, resolution?: unknown): Promise<HardwareSignature>;
  resolveTransaction?(rawTxHex: string): Promise<unknown>;
  close?(): Promise<void>;
};

export type HardwareDevice = "ledger" | "trezor";
export type HardwareAccount = { index: number; path: string; address: string };

export type HardwareSigningPrompt = {
  review: DappRequestReview;
  path: string;
  address: string;
  chainName: string;
  /** Plain text of a personal_sign message, or null. */
  messagePreview: string | null;
  nonce: number | null;
  gas: string | null;
  /** gas x maxFeePerGas in wei: the most the transaction can cost. */
  maxFeeWei: string | null;
  typed: { chainId: string | null; verifyingContract: string | null; primaryType: string | null } | null;
};

export type HardwareProviderOptions = {
  openApp(): Promise<LedgerEthApp>;
  path?: string;
  chainId: string | number;
  /** Shows the Hub-side summary. Resolve false (or reject) to cancel before anything reaches the device. */
  confirm(prompt: HardwareSigningPrompt): Promise<boolean>;
  rpc?(chainId: `0x${string}`, method: string, params: unknown[]): Promise<unknown>;
  /** Ledger "resolution" (clear-signing metadata) for a raw tx; optional. */
  resolveTransaction?(rawTxHex: string): Promise<unknown>;
};

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/;
const DATA = /^0x(?:[0-9a-f]{2})*$/;
const MAX_GAS = 30_000_000n;
const MAX_SAFE_NONCE = 2n ** 53n - 1n;
const MAX_FEE_PER_GAS = 10n ** 15n; // 1,000,000 gwei
const ALLOWED_TX_KEYS = new Set(["from", "to", "value", "data", "gas", "nonce", "maxFeePerGas", "maxPriorityFeePerGas", "chainId", "type"]);

function quantityField(value: unknown, code: string): bigint | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !QUANTITY.test(value)) throw new HardwareWalletError(code, -32602);
  return BigInt(value);
}

export class HardwareWalletError extends Error {
  code: number;
  /** The vendor's own error code (e.g. Trezor "Transport_Missing"), shown to the user to tell causes apart. */
  detail?: string;
  constructor(message: string, code: number, detail?: string) {
    super(message);
    this.name = "HardwareWalletError";
    this.code = code;
    this.detail = detail;
  }
}
const rejected = () => new HardwareWalletError("user_rejected", 4001);
const disconnected = () => new HardwareWalletError("hardware_wallet_disconnected", 4900);
const locked = () => new HardwareWalletError("hardware_wallet_locked", 4900);
const invalid = (m: string) => new HardwareWalletError(m, -32602);

export function hardwarePath(index: number): string {
  if (!Number.isInteger(index) || index < 0 || index > 99) throw invalid("hardware_path_invalid");
  return `m/44'/60'/0'/0/${index}`;
}

export function isValidHardwarePath(path: unknown): path is string {
  return typeof path === "string" && /^m\/44'\/60'\/\d{1,3}'?(?:\/\d{1,3}){0,2}$/.test(path);
}

/** Maps Ledger/transport failures to a clean cancel (4001) or a fail-closed disconnect (4900). */
export function mapHardwareError(reason: unknown): HardwareWalletError {
  if (reason instanceof HardwareWalletError) return reason;
  const r = (reason ?? {}) as { statusCode?: unknown; name?: unknown; message?: unknown };
  const status = typeof r.statusCode === "number" ? r.statusCode : null;
  const name = typeof r.name === "string" ? r.name : "";
  const message = typeof r.message === "string" ? r.message : "";
  if (status === 0x6985 || status === 0x6986 || /denied by the user|rejected/i.test(message)) return rejected();
  if (name === "TransportOpenUserCancelled") return rejected();
  if (status === 0x5515 || status === 0x6faa || /locked/i.test(message)) return locked();
  if (/Disconnected|TransportInterfaceNotAvailable|TransportRaceCondition|NotFoundError|InvalidStateError|device.*(disconnected|not found)/i.test(name + " " + message)) return disconnected();
  return new HardwareWalletError("hardware_wallet_failed", -32603);
}

function needsReopen(e: HardwareWalletError) {
  return e.message === "hardware_wallet_disconnected" || e.message === "hardware_wallet_failed";
}

export async function listHardwareAccounts(app: LedgerEthApp, count = HARDWARE_ACCOUNT_LIST_SIZE): Promise<HardwareAccount[]> {
  const out: HardwareAccount[] = [];
  try {
    const paths = Array.from({ length: count }, (_, index) => hardwarePath(index));
    const batch = app.getAddresses ? await app.getAddresses(paths) : null;
    if (batch && batch.length !== count) throw invalid("hardware_address_invalid");
    for (let index = 0; index < count; index += 1) {
      const path = paths[index]!;
      const { address } = batch ? batch[index]! : await app.getAddress(path, false);
      const normalized = normalizeWalletAddress(address);
      if (!normalized) throw invalid("hardware_address_invalid");
      out.push({ index, path, address: normalized });
    }
  } catch (reason) {
    throw mapHardwareError(reason);
  }
  return out;
}

function stripHex(value: string) {
  return value.startsWith("0x") ? value.slice(2) : value;
}

function signatureHex(sig: HardwareSignature, forceRecoveryId = false): `0x${string}` {
  const r = stripHex(String(sig.r)).padStart(64, "0");
  const s = stripHex(String(sig.s)).padStart(64, "0");
  let v = typeof sig.v === "number" ? sig.v : Number.parseInt(stripHex(String(sig.v)), 16);
  if (!/^[0-9a-fA-F]{64}$/.test(r) || !/^[0-9a-fA-F]{64}$/.test(s) || !Number.isInteger(v)) throw invalid("hardware_signature_invalid");
  if (forceRecoveryId && v < 27) v += 27;
  return `0x${r}${s}${v.toString(16).padStart(2, "0")}`;
}

function messageBytesHex(message: string): { hex: string; preview: string | null } {
  if (/^0x(?:[0-9a-fA-F]{2})*$/.test(message)) {
    const hex = message.slice(2);
    let preview: string | null = null;
    try {
      preview = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16)));
    } catch {
      preview = null;
    }
    return { hex, preview };
  }
  const bytes = new TextEncoder().encode(message);
  return { hex: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""), preview: message };
}

export type HardwareEvmProvider = {
  request(input: { method: string; params?: unknown[] | object }): Promise<unknown>;
  setPath(path: string): void;
  close(): Promise<void>;
  readonly path: string;
};

export function createHardwareEvmProvider(options: HardwareProviderOptions): HardwareEvmProvider {
  let path = options.path ?? DEFAULT_HARDWARE_PATH;
  let chainId = normalizeChainId(options.chainId);
  let app: LedgerEthApp | null = null;
  let cachedAddress: { path: string; address: string } | null = null;
  let inFlight = 0;
  const rpc = options.rpc ?? (async (chain, method, params) => {
    const network = walletNetwork(chain);
    if (!network) throw new HardwareWalletError("transaction_network_not_allowed", 4902);
    return (await rpcRequest(network.rpcUrls, chain, method, params)).result;
  });

  async function device(): Promise<LedgerEthApp> {
    if (app) return app;
    try {
      app = await options.openApp();
    } catch (reason) {
      throw mapHardwareError(reason);
    }
    return app;
  }

  async function run<T>(fn: (a: LedgerEthApp) => Promise<T>): Promise<T> {
    const a = await device();
    try {
      return await fn(a);
    } catch (reason) {
      const mapped = mapHardwareError(reason);
      if (needsReopen(mapped)) {
        app = null;
        cachedAddress = null;
        try { await a.close?.(); } catch { /* already gone */ }
      }
      throw mapped;
    }
  }

  async function currentAddress(): Promise<string> {
    if (cachedAddress && cachedAddress.path === path) return cachedAddress.address;
    const { address } = await run((a) => a.getAddress(path, false));
    const normalized = normalizeWalletAddress(address);
    if (!normalized) throw invalid("hardware_address_invalid");
    cachedAddress = { path, address: normalized };
    return normalized;
  }

  async function approve(
    chain: `0x${string}`,
    rawRequest: { method: string; params: unknown[] },
    address: string,
    extra: Partial<Pick<HardwareSigningPrompt, "messagePreview" | "nonce" | "gas" | "maxFeeWei" | "typed">> = {},
  ) {
    const review = reviewDappRequest(rawRequest);
    const network = walletNetwork(chain);
    let ok = false;
    try {
      ok = await options.confirm({
        review,
        path,
        address,
        chainName: network?.name ?? chain,
        messagePreview: extra.messagePreview ?? null,
        nonce: extra.nonce ?? null,
        gas: extra.gas ?? null,
        maxFeeWei: extra.maxFeeWei ?? null,
        typed: extra.typed ?? null,
      });
    } catch {
      ok = false;
    }
    if (!ok || chain !== chainId) throw rejected();
  }

  async function sendTransaction(params: unknown[], chain: `0x${string}`): Promise<`0x${string}`> {
    const address = await currentAddress();
    const tx = params[0] as Record<string, unknown> | undefined;
    if (!tx || typeof tx !== "object" || Array.isArray(tx)) throw invalid("dapp_transaction_invalid");
    for (const key of Object.keys(tx)) if (!ALLOWED_TX_KEYS.has(key)) throw invalid(`dapp_transaction_field_unsupported:${key.slice(0, 32)}`);
    if (tx.from !== undefined && (typeof tx.from !== "string" || !ADDRESS.test(tx.from) || tx.from.toLowerCase() !== address.toLowerCase())) throw invalid("hardware_from_mismatch");
    if (typeof tx.to !== "string" || !ADDRESS.test(tx.to)) throw invalid("dapp_destination_invalid");
    const to = tx.to as `0x${string}`;
    const data = (tx.data === undefined ? "0x" : tx.data) as string;
    if (typeof data !== "string" || !DATA.test(data)) throw invalid("dapp_data_invalid");
    const valueText = tx.value === undefined ? "0x0" : tx.value;
    if (typeof valueText !== "string" || !QUANTITY.test(valueText)) throw invalid("dapp_value_invalid");
    const value = BigInt(valueText);
    if (tx.type !== undefined && tx.type !== "0x2") throw invalid("dapp_tx_type_unsupported");
    if (tx.chainId !== undefined && (typeof tx.chainId !== "string" || !QUANTITY.test(tx.chainId) || BigInt(tx.chainId) !== BigInt(chain))) throw invalid("dapp_chain_mismatch");
    const suppliedNonce = quantityField(tx.nonce, "dapp_nonce_invalid");
    if (suppliedNonce !== null && suppliedNonce > MAX_SAFE_NONCE) throw invalid("dapp_nonce_invalid");
    const suppliedGas = quantityField(tx.gas, "dapp_gas_invalid");
    if (suppliedGas !== null && (suppliedGas === 0n || suppliedGas > MAX_GAS)) throw invalid("dapp_gas_invalid");
    const suppliedMaxFee = quantityField(tx.maxFeePerGas, "dapp_fee_invalid");
    const suppliedPriority = quantityField(tx.maxPriorityFeePerGas, "dapp_fee_invalid");
    if (suppliedMaxFee !== null && suppliedMaxFee > MAX_FEE_PER_GAS) throw invalid("dapp_fee_invalid");
    if (suppliedMaxFee !== null && suppliedPriority !== null && suppliedPriority > suppliedMaxFee) throw invalid("dapp_fee_invalid");
    assertTransactionNetwork(chain);

    const nonce = suppliedNonce ?? BigInt(String(await rpc(chain, "eth_getTransactionCount", [address, "pending"])));
    const gas = suppliedGas ?? BigInt(String(await rpc(chain, "eth_estimateGas", [{ from: address, to, data, value: `0x${value.toString(16)}` }])));
    if (gas === 0n || gas > MAX_GAS) throw invalid("dapp_gas_invalid");
    let maxFeePerGas = suppliedMaxFee;
    let priority = suppliedPriority;
    if (maxFeePerGas === null || priority === null) {
      const gasPrice = BigInt(String(await rpc(chain, "eth_gasPrice", [])));
      if (maxFeePerGas === null) maxFeePerGas = suppliedPriority !== null && suppliedPriority > gasPrice * 2n ? suppliedPriority : gasPrice * 2n;
      if (priority === null) {
        let fetched = gasPrice;
        try { fetched = BigInt(String(await rpc(chain, "eth_maxPriorityFeePerGas", []))); } catch { /* use gasPrice as the cap */ }
        priority = fetched > maxFeePerGas ? maxFeePerGas : fetched;
      }
    }
    if (priority > maxFeePerGas || maxFeePerGas > MAX_FEE_PER_GAS) throw invalid("dapp_fee_invalid");
    const unsigned = {
      type: "eip1559" as const,
      chainId: Number(BigInt(chain)),
      nonce: Number(nonce),
      to,
      value,
      data: data as `0x${string}`,
      gas,
      maxFeePerGas,
      maxPriorityFeePerGas: priority,
    };
    // Review the normalised, validated fields -- the same ones that are signed.
    await approve(chain, { method: "eth_sendTransaction", params: [{ to, value: `0x${value.toString(16)}`, data }] }, address, {
      nonce: Number(nonce),
      gas: gas.toString(),
      maxFeeWei: (gas * maxFeePerGas).toString(),
    });
    const rawHex = serializeTransaction(unsigned).slice(2);
    const resolver = options.resolveTransaction ?? (await device()).resolveTransaction?.bind(await device());
    const resolution = resolver ? await resolver(rawHex) : undefined;
    const sig = await run((a) => a.signTransaction(path, rawHex, resolution));
    const hex = signatureHex(sig);
    const recovery = Number.parseInt(hex.slice(130), 16);
    const signed = serializeTransaction(unsigned, { r: `0x${hex.slice(2, 66)}`, s: `0x${hex.slice(66, 130)}`, yParity: recovery & 1 });
    // The signed bytes must be exactly what was reviewed and must recover to the device address.
    const parsed = parseTransaction(signed);
    if (
      parsed.to?.toLowerCase() !== to.toLowerCase() ||
      parsed.value !== value ||
      (parsed.data ?? "0x") !== data ||
      parsed.chainId !== unsigned.chainId ||
      parsed.nonce !== unsigned.nonce ||
      parsed.gas !== gas ||
      parsed.maxFeePerGas !== maxFeePerGas
    ) throw new HardwareWalletError("hardware_tx_mismatch", -32603);
    const signer = await recoverTransactionAddress({ serializedTransaction: signed as `0x02${string}` });
    if (signer.toLowerCase() !== address.toLowerCase()) throw new HardwareWalletError("hardware_signer_mismatch", -32603);
    if (chain !== chainId) throw rejected();
    const hash = await rpc(chain, "eth_sendRawTransaction", [signed]);
    if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new HardwareWalletError("transaction_hash_missing", -32603);
    return hash as `0x${string}`;
  }

  async function guarded<T>(fn: (chain: `0x${string}`) => Promise<T>): Promise<T> {
    const chain = chainId; // snapshot once; review, signing and broadcast all use this value
    inFlight += 1;
    try {
      return await fn(chain);
    } finally {
      inFlight -= 1;
    }
  }

  return {
    get path() { return path; },
    setPath(next: string) {
      if (!isValidHardwarePath(next)) throw invalid("hardware_path_invalid");
      path = next;
      cachedAddress = null;
    },
    async close() {
      const a = app;
      app = null;
      cachedAddress = null;
      try { await a?.close?.(); } catch { /* already gone */ }
    },
    async request({ method, params }) {
      const list = Array.isArray(params) ? params : [];
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [await currentAddress()];
        case "eth_chainId":
          return chainId;
        case "wallet_switchEthereumChain": {
          if (inFlight > 0) throw new HardwareWalletError("hardware_request_in_flight", -32002);
          const target = (list[0] as { chainId?: unknown } | undefined)?.chainId;
          let next: `0x${string}`;
          try { next = normalizeChainId(target as string); } catch { throw invalid("invalid_chain_id"); }
          if (!walletNetwork(next)) throw new HardwareWalletError("unknown_chain", 4902);
          chainId = next;
          return null;
        }
        case "personal_sign":
          return guarded(async (chain) => {
            const address = await currentAddress();
            const message = list[0];
            if (typeof message !== "string" || message.length > 20_000) throw invalid("dapp_params_invalid");
            if (list[1] !== undefined && String(list[1]).toLowerCase() !== address.toLowerCase()) throw invalid("hardware_from_mismatch");
            const { hex, preview } = messageBytesHex(message);
            await approve(chain, { method, params: list }, address, { messagePreview: preview });
            return signatureHex(await run((a) => a.signPersonalMessage(path, hex)), true);
          });
        case "eth_signTypedData_v4":
          return guarded(async (chain) => {
            const address = await currentAddress();
            if (String(list[0]).toLowerCase() !== address.toLowerCase()) throw invalid("hardware_from_mismatch");
            let typed: unknown;
            try { typed = typeof list[1] === "string" ? JSON.parse(list[1]) : list[1]; } catch { throw invalid("dapp_params_invalid"); }
            if (!typed || typeof typed !== "object" || Array.isArray(typed)) throw invalid("dapp_params_invalid");
            const domain = (typed as { domain?: unknown }).domain;
            const d = domain && typeof domain === "object" ? (domain as { chainId?: unknown; verifyingContract?: unknown }) : {};
            let domainChain: string | null = null;
            if (d.chainId !== undefined) {
              const raw = d.chainId;
              const text = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? String(raw)
                : typeof raw === "string" && /^(?:[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(raw) ? raw : null;
              if (text === null || BigInt(text) !== BigInt(chain)) throw invalid("typed_data_chain_mismatch");
              domainChain = BigInt(text).toString();
            }
            const verifying = typeof d.verifyingContract === "string" ? d.verifyingContract : null;
            await approve(chain, { method, params: list }, address, {
              typed: {
                chainId: domainChain,
                verifyingContract: verifying,
                primaryType: typeof (typed as { primaryType?: unknown }).primaryType === "string" ? String((typed as { primaryType: string }).primaryType).slice(0, 80) : null,
              },
            });
            return signatureHex(await run((a) => a.signEIP712Message(path, typed as Record<string, unknown>)), true);
          });
        case "eth_sendTransaction":
          return guarded((chain) => sendTransaction(list, chain));
        case "eth_estimateGas":
        case "eth_gasPrice":
        case "eth_getTransactionReceipt":
        case "eth_getTransactionByHash":
        case "eth_blockNumber":
        case "eth_getBalance":
        case "eth_call":
          return rpc(chainId, method, list);
        default:
          throw new HardwareWalletError("method_not_supported", 4200);
      }
    },
  };
}
