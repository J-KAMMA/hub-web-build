/**
 * External Bitcoin wallet adapters (browser only). Hub never creates, holds or recovers Bitcoin keys: the user's
 * own wallet signs, on the user's device. Two paths:
 *  - sats-connect (Xverse, Leather and other wallets that speak the sats-connect request API)
 *  - UniSat via its injected `window.unisat`
 * Both return the same shape so the panel does not care which one is connected. sats-connect is loaded on demand
 * (it brings its own picker UI); nothing here runs on the server.
 */
import { base64, hex } from "@scure/base";
import { tryParseBitcoinAddress } from "@/lib/chains/address/bitcoin";
import type { BitcoinNetworkEntry } from "@/lib/chains/bitcoin-chain-registry";

export type BitcoinWalletId = "sats-connect" | "unisat";

export type BitcoinWalletAccount = { address: string; publicKey: string | null };

export type BitcoinWalletAdapter = {
  id: BitcoinWalletId;
  label: string;
  isAvailable(): boolean;
  /** Payment addresses of the wallet for the given network. */
  connect(network: BitcoinNetworkEntry): Promise<BitcoinWalletAccount[]>;
  /** Signature (base64) over `message`: BIP-322 where the address type supports it, otherwise legacy signmessage. */
  signMessage(network: BitcoinNetworkEntry, address: string, message: string): Promise<string>;
  /** Sign every input of an unsigned PSBT with SIGHASH_ALL. Returns the signed PSBT (base64). Never broadcasts. */
  signPsbt(network: BitcoinNetworkEntry, address: string, psbtBase64: string, inputCount: number): Promise<string>;
};

export class BitcoinWalletClientError extends Error {
  readonly code: "unavailable" | "rejected" | "failed" | "network_mismatch";
  constructor(code: BitcoinWalletClientError["code"]) {
    super(code);
    this.code = code;
  }
}

function networkNameForSats(network: BitcoinNetworkEntry): "Mainnet" | "Testnet4" | "Signet" {
  if (!network.testnet) return "Mainnet";
  return network.chainRef.endsWith("da84f2bafbbc53dee25a72ae") ? "Testnet4" : "Signet";
}

function classify(error: unknown): BitcoinWalletClientError {
  if (error instanceof BitcoinWalletClientError) return error;
  const text = String((error as { message?: unknown })?.message ?? error).toLowerCase();
  if (text.includes("cancel") || text.includes("reject") || text.includes("denied") || text.includes("declin")) return new BitcoinWalletClientError("rejected");
  return new BitcoinWalletClientError("failed");
}

/** BIP-322 for native segwit and taproot, legacy signmessage for P2PKH and P2SH. */
function protocolFor(network: BitcoinNetworkEntry, address: string): "BIP322" | "ECDSA" {
  const parsed = tryParseBitcoinAddress(network.chainRef, address);
  return parsed && (parsed.kind === "p2wpkh" || parsed.kind === "p2tr") ? "BIP322" : "ECDSA";
}

export const satsConnectAdapter: BitcoinWalletAdapter = {
  id: "sats-connect",
  label: "Xverse / Leather など (sats-connect)",
  isAvailable: () => typeof window !== "undefined",
  async connect(network) {
    try {
      const { default: Wallet, AddressPurpose, BitcoinNetworkType } = await import("sats-connect");
      await Wallet.selectProvider();
      const response = await Wallet.request("wallet_connect", {
        addresses: [AddressPurpose.Payment],
        message: "Hub: アドレスを選びます",
        network: BitcoinNetworkType[networkNameForSats(network)],
      });
      if (response.status !== "success") throw new BitcoinWalletClientError("rejected");
      const accounts = response.result.addresses
        .filter((item: { purpose: string }) => item.purpose === AddressPurpose.Payment)
        .map((item: { address: string; publicKey: string }) => ({ address: item.address, publicKey: item.publicKey || null }));
      if (accounts.length === 0) throw new BitcoinWalletClientError("failed");
      // The wallet must be on the network the user picked: an address of another network is a mismatch.
      if (!accounts.some((item: BitcoinWalletAccount) => tryParseBitcoinAddress(network.chainRef, item.address))) throw new BitcoinWalletClientError("network_mismatch");
      return accounts.filter((item: BitcoinWalletAccount) => tryParseBitcoinAddress(network.chainRef, item.address));
    } catch (error) {
      throw classify(error);
    }
  },
  async signMessage(network, address, message) {
    try {
      const { default: Wallet, MessageSigningProtocols } = await import("sats-connect");
      const response = await Wallet.request("signMessage", { address, message, protocol: MessageSigningProtocols[protocolFor(network, address)] });
      if (response.status !== "success") throw new BitcoinWalletClientError("rejected");
      return response.result.signature;
    } catch (error) {
      throw classify(error);
    }
  },
  async signPsbt(_network, address, psbtBase64, inputCount) {
    try {
      const { default: Wallet } = await import("sats-connect");
      const response = await Wallet.request("signPsbt", {
        psbt: psbtBase64,
        signInputs: { [address]: Array.from({ length: inputCount }, (_, index) => index) },
        broadcast: false,
      });
      if (response.status !== "success") throw new BitcoinWalletClientError("rejected");
      return response.result.psbt;
    } catch (error) {
      throw classify(error);
    }
  },
};

type UnisatProvider = {
  requestAccounts(): Promise<string[]>;
  getPublicKey(): Promise<string>;
  switchChain?(chain: string): Promise<unknown>;
  signMessage(message: string, type?: "ecdsa" | "bip322-simple"): Promise<string>;
  signPsbt(psbtHex: string, options?: { autoFinalized?: boolean; toSignInputs?: Array<{ index: number; address: string; sighashTypes?: number[] }> }): Promise<string>;
};

function unisat(): UnisatProvider | null {
  const provider = (typeof window !== "undefined" ? (window as unknown as { unisat?: UnisatProvider }).unisat : undefined) ?? null;
  return provider;
}

function unisatChain(network: BitcoinNetworkEntry) {
  if (!network.testnet) return "BITCOIN_MAINNET";
  return network.chainRef.endsWith("da84f2bafbbc53dee25a72ae") ? "BITCOIN_TESTNET4" : "BITCOIN_SIGNET";
}

export const unisatAdapter: BitcoinWalletAdapter = {
  id: "unisat",
  label: "UniSat",
  isAvailable: () => unisat() !== null,
  async connect(network) {
    const provider = unisat();
    if (!provider) throw new BitcoinWalletClientError("unavailable");
    try {
      await provider.switchChain?.(unisatChain(network));
      const addresses = await provider.requestAccounts();
      const publicKey = await provider.getPublicKey().catch(() => null);
      const accounts = addresses
        .filter((address) => tryParseBitcoinAddress(network.chainRef, address))
        .map((address) => ({ address, publicKey }));
      if (accounts.length === 0) throw new BitcoinWalletClientError("network_mismatch");
      return accounts;
    } catch (error) {
      throw classify(error);
    }
  },
  async signMessage(network, address, message) {
    const provider = unisat();
    if (!provider) throw new BitcoinWalletClientError("unavailable");
    try {
      return await provider.signMessage(message, protocolFor(network, address) === "BIP322" ? "bip322-simple" : "ecdsa");
    } catch (error) {
      throw classify(error);
    }
  },
  async signPsbt(_network, address, psbtBase64, inputCount) {
    const provider = unisat();
    if (!provider) throw new BitcoinWalletClientError("unavailable");
    try {
      const signedHex = await provider.signPsbt(hex.encode(base64.decode(psbtBase64)), {
        autoFinalized: true,
        toSignInputs: Array.from({ length: inputCount }, (_, index) => ({ index, address, sighashTypes: [1] })),
      });
      return base64.encode(hex.decode(signedHex));
    } catch (error) {
      throw classify(error);
    }
  },
};

export const BITCOIN_WALLET_ADAPTERS: readonly BitcoinWalletAdapter[] = [satsConnectAdapter, unisatAdapter];
