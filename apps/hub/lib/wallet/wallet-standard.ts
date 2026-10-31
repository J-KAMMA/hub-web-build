/**
 * Solana wallet discovery and signing through the Wallet Standard (client only). Phantom, Solflare and Backpack
 * register themselves here. Hub never sees a key: it asks the wallet to sign a message or to sign and send a
 * transaction, and the user approves in the wallet.
 */
import { getWallets } from "@wallet-standard/app";

import { WALLET_LINK_REQUEST_ID_PREFIX } from "@/lib/server/wallet-link/message";

type StandardWallet = ReturnType<ReturnType<typeof getWallets>["get"]>[number];
type StandardAccount = StandardWallet["accounts"][number];

type Feature<Name extends string, Methods> = { [K in Name]?: Methods };
type ConnectFeature = Feature<"standard:connect", { connect(input?: { silent?: boolean }): Promise<{ accounts: readonly StandardAccount[] }> }>;
type DisconnectFeature = Feature<"standard:disconnect", { disconnect(): Promise<void> }>;
type SignMessageFeature = Feature<"solana:signMessage", { signMessage(...inputs: Array<{ account: StandardAccount; message: Uint8Array }>): Promise<Array<{ signedMessage: Uint8Array; signature: Uint8Array }>> }>;
type SignInFeature = Feature<"solana:signIn", { signIn(...inputs: Array<Record<string, unknown>>): Promise<Array<{ account: StandardAccount; signedMessage: Uint8Array; signature: Uint8Array }>> }>;
type SignAndSendFeature = Feature<"solana:signAndSendTransaction", { signAndSendTransaction(...inputs: Array<{ account: StandardAccount; chain: string; transaction: Uint8Array; options?: Record<string, unknown> }>): Promise<Array<{ signature: Uint8Array }>> }>;

type FeatureMap = Record<string, unknown> & ConnectFeature & DisconnectFeature & SignMessageFeature & SignInFeature & SignAndSendFeature;

export type SolanaWalletClientErrorCode = "unavailable" | "rejected" | "unsupported" | "no_account" | "failed";

export class SolanaWalletClientError extends Error {
  constructor(readonly code: SolanaWalletClientErrorCode) {
    super(code);
  }
}

export type SolanaWalletEntry = {
  name: string;
  icon: string;
  wallet: StandardWallet;
  canSignMessage: boolean;
  canSignIn: boolean;
  canSignAndSend: boolean;
};

export type ConnectedSolanaWallet = { entry: SolanaWalletEntry; account: StandardAccount; address: string };

function features(wallet: StandardWallet): FeatureMap {
  return wallet.features as unknown as FeatureMap;
}

function supportsSolana(wallet: StandardWallet): boolean {
  return wallet.chains.some((chain) => chain.startsWith("solana:")) && "standard:connect" in wallet.features;
}

export function listSolanaWallets(): SolanaWalletEntry[] {
  return getWallets().get().filter(supportsSolana).map((wallet) => {
    const f = features(wallet);
    return {
      name: wallet.name,
      icon: wallet.icon,
      wallet,
      canSignMessage: "solana:signMessage" in f,
      canSignIn: "solana:signIn" in f,
      canSignAndSend: "solana:signAndSendTransaction" in f,
    };
  });
}

/** Calls `onChange` when a wallet registers late; returns an unsubscribe function. */
export function watchSolanaWallets(onChange: () => void): () => void {
  const api = getWallets();
  const offRegister = api.on("register", onChange);
  const offUnregister = api.on("unregister", onChange);
  return () => { offRegister(); offUnregister(); };
}

function asClientError(error: unknown): SolanaWalletClientError {
  if (error instanceof SolanaWalletClientError) return error;
  const text = `${(error as { name?: string })?.name ?? ""} ${(error as { message?: string })?.message ?? ""}`.toLowerCase();
  return new SolanaWalletClientError(/reject|denied|cancel|declin|user/.test(text) ? "rejected" : "failed");
}

export async function connectSolanaWallet(entry: SolanaWalletEntry): Promise<ConnectedSolanaWallet> {
  try {
    const connect = features(entry.wallet)["standard:connect"];
    if (!connect) throw new SolanaWalletClientError("unsupported");
    const { accounts } = await connect.connect();
    const account = accounts.find((item) => item.chains.some((chain) => chain.startsWith("solana:"))) ?? accounts[0];
    if (!account) throw new SolanaWalletClientError("no_account");
    return { entry, account, address: account.address };
  } catch (error) {
    throw asClientError(error);
  }
}

export async function disconnectSolanaWallet(entry: SolanaWalletEntry): Promise<void> {
  try {
    await features(entry.wallet)["standard:disconnect"]?.disconnect();
  } catch {
    /* a wallet that cannot disconnect stays connected on its side; Hub forgets it either way */
  }
}

const TEXT = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Signs the issued link message. `signMessage` signs exactly the bytes given, so the server's byte-for-byte check
 * holds. Wallets without it fall back to `solana:signIn`, which may re-render the text: the returned message is
 * compared with the issued one here, and the server compares again.
 */
export async function signLinkMessage(
  connected: ConnectedSolanaWallet,
  challenge: { message: string; challengeId: string },
): Promise<{ signature: string; signedMessage: string }> {
  const f = features(connected.entry.wallet);
  try {
    if (f["solana:signMessage"]) {
      const [result] = await f["solana:signMessage"].signMessage({ account: connected.account, message: TEXT.encode(challenge.message) });
      return { signature: toBase64(result.signature), signedMessage: new TextDecoder().decode(result.signedMessage) };
    }
    if (f["solana:signIn"]) {
      const lines = challenge.message.split("\n");
      const field = (prefix: string) => lines.find((line) => line.startsWith(prefix))?.slice(prefix.length);
      const [result] = await f["solana:signIn"].signIn({
        domain: lines[0].split(" ")[0],
        address: connected.address,
        statement: lines[3],
        uri: field("URI: "),
        version: field("Version: "),
        chainId: field("Chain ID: "),
        nonce: field("Nonce: "),
        issuedAt: field("Issued At: "),
        expirationTime: field("Expiration Time: "),
        requestId: `${WALLET_LINK_REQUEST_ID_PREFIX}${challenge.challengeId}`,
      });
      return { signature: toBase64(result.signature), signedMessage: new TextDecoder().decode(result.signedMessage) };
    }
  } catch (error) {
    throw asClientError(error);
  }
  throw new SolanaWalletClientError("unsupported");
}

/** Hands the unsigned transaction to the wallet, which asks the user and broadcasts. Returns the base58 signature. */
export async function signAndSendSolanaTransaction(
  connected: ConnectedSolanaWallet,
  input: { chain: string; transaction: Uint8Array },
  encodeSignature: (bytes: Uint8Array) => string,
): Promise<string> {
  const feature = features(connected.entry.wallet)["solana:signAndSendTransaction"];
  if (!feature) throw new SolanaWalletClientError("unsupported");
  try {
    const [result] = await feature.signAndSendTransaction({
      account: connected.account,
      chain: input.chain,
      transaction: input.transaction,
      options: { preflightCommitment: "confirmed" },
    });
    return encodeSignature(result.signature);
  } catch (error) {
    throw asClientError(error);
  }
}

/** Wallet Standard chain id for a CAIP-2 Solana reference ("solana:mainnet" / "solana:devnet"). */
export function walletStandardChain(cluster: "mainnet" | "devnet"): string {
  return `solana:${cluster}`;
}
