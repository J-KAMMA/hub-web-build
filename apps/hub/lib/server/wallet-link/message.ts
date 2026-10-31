/**
 * Wallet-link challenge messages (design section 2.1). Pure: no Node-only APIs, runs on Workers and in the browser.
 *
 * Solana follows Sign-In With Solana (the EIP-4361 layout that Phantom, Solflare and Backpack render for
 * `solana:signIn`). The text is ASCII only, LF line endings, no trailing newline. The server never trusts a
 * message the client sends back: it must equal the issued bytes exactly (SHA-256 recorded in the challenge row).
 */
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export const WALLET_LINK_TTL_MS = 5 * 60 * 1000;
export const WALLET_LINK_REQUEST_ID_PREFIX = "hub_profile_wallet_link_v1:";

export type SolanaLinkMessageFields = {
  /** Host (with port) of the Hub that issued the challenge. */
  host: string;
  /** Origin of the Hub, e.g. the instance origin. */
  origin: string;
  address: string;
  /** Null (or a handle with non-ASCII characters) selects the text without the handle. */
  handle: string | null;
  cluster: "mainnet" | "devnet";
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  challengeId: string;
};

const ASCII_ONLY = /^[\x20-\x7e]+$/;
const HANDLE_TEXT = /^[A-Za-z0-9_.-]{1,64}$/;

export function sha256Hex(text: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(text)));
}

export function isAsciiHandle(handle: string | null): handle is string {
  return handle !== null && HANDLE_TEXT.test(handle);
}

export function buildSolanaLinkMessage(fields: SolanaLinkMessageFields): string {
  const intro = isAsciiHandle(fields.handle)
    ? `Link this wallet to Hub profile @${fields.handle}. This is not a transaction and costs nothing.`
    : "Link this wallet to your Hub profile. This is not a transaction and costs nothing.";
  const message = [
    `${fields.host} wants you to sign in with your Solana account:`,
    fields.address,
    "",
    intro,
    "",
    `URI: ${fields.origin}/wallet/link`,
    "Version: 1",
    `Chain ID: ${fields.cluster}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expiresAt}`,
    `Request ID: ${WALLET_LINK_REQUEST_ID_PREFIX}${fields.challengeId}`,
  ].join("\n");
  // Every field is validated before it reaches here; this is a last guard against smuggled control characters.
  if (!ASCII_ONLY.test(message.replace(/\n/g, " "))) throw new Error("wallet link message must be ASCII");
  return message;
}

/**
 * Strict parse: every line must be where the template puts it, and rebuilding from the parsed fields must give
 * the identical text. Returns null for anything else.
 */
export function parseSolanaLinkMessage(text: string): SolanaLinkMessageFields | null {
  if (typeof text !== "string" || text.length > 1000) return null;
  const lines = text.split("\n");
  if (lines.length !== 12) return null;
  const header = /^(\S+) wants you to sign in with your Solana account:$/.exec(lines[0]);
  const uri = /^URI: (\S+)\/wallet\/link$/.exec(lines[5]);
  const chain = /^Chain ID: (mainnet|devnet)$/.exec(lines[7]);
  const nonce = /^Nonce: ([A-Za-z0-9_-]{16,64})$/.exec(lines[8]);
  const issued = /^Issued At: (\S+)$/.exec(lines[9]);
  const expires = /^Expiration Time: (\S+)$/.exec(lines[10]);
  const requestId = /^Request ID: hub_profile_wallet_link_v1:([A-Za-z0-9_-]{8,80})$/.exec(lines[11]);
  if (!header || !uri || !chain || !nonce || !issued || !expires || !requestId) return null;
  const withHandle = /^Link this wallet to Hub profile @([A-Za-z0-9_.-]{1,64})\. This is not a transaction and costs nothing\.$/.exec(lines[3]);
  const handle = withHandle ? withHandle[1] : null;
  const fields: SolanaLinkMessageFields = {
    host: header[1],
    origin: uri[1],
    address: lines[1],
    handle,
    cluster: chain[1] as "mainnet" | "devnet",
    nonce: nonce[1],
    issuedAt: issued[1],
    expiresAt: expires[1],
    challengeId: requestId[1],
  };
  try {
    return buildSolanaLinkMessage(fields) === text ? fields : null;
  } catch {
    return null;
  }
}

export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
