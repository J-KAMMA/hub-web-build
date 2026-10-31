/**
 * Bitcoin wallet-link challenge message (design section 2.1): the same body as the Solana text with the first
 * line `{host} wants you to link your Bitcoin address:` and `Chain ID: {chainRef}`. ASCII only, LF line endings,
 * no trailing newline, kept short (about 530 bytes with the full template; the design target of 400 is not reachable with these fields). Pure: runs on Workers and in the browser.
 */
import { isAsciiHandle, WALLET_LINK_REQUEST_ID_PREFIX } from "./message";

export type BitcoinLinkMessageFields = {
  host: string;
  origin: string;
  address: string;
  handle: string | null;
  chainRef: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  challengeId: string;
};

const ASCII_ONLY = /^[\x20-\x7e]+$/;

export function buildBitcoinLinkMessage(fields: BitcoinLinkMessageFields): string {
  const intro = isAsciiHandle(fields.handle)
    ? `Link this wallet to Hub profile @${fields.handle}. This is not a transaction and costs nothing.`
    : "Link this wallet to your Hub profile. This is not a transaction and costs nothing.";
  const message = [
    `${fields.host} wants you to link your Bitcoin address:`,
    fields.address,
    "",
    intro,
    "",
    `URI: ${fields.origin}/wallet/link`,
    "Version: 1",
    `Chain ID: ${fields.chainRef}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expiresAt}`,
    `Request ID: ${WALLET_LINK_REQUEST_ID_PREFIX}${fields.challengeId}`,
  ].join("\n");
  if (!ASCII_ONLY.test(message.replace(/\n/g, " ")) || message.length > 640) throw new Error("bitcoin link message must be short ASCII");
  return message;
}

/** Strict parse; rebuilding from the parsed fields must give the identical text. */
export function parseBitcoinLinkMessage(text: string): BitcoinLinkMessageFields | null {
  if (typeof text !== "string" || text.length > 1000) return null;
  const lines = text.split("\n");
  if (lines.length !== 12) return null;
  const header = /^(\S+) wants you to link your Bitcoin address:$/.exec(lines[0]!);
  const uri = /^URI: (\S+)\/wallet\/link$/.exec(lines[5]!);
  const chain = /^Chain ID: (bip122:[0-9a-f]{32})$/.exec(lines[7]!);
  const nonce = /^Nonce: ([A-Za-z0-9_-]{16,64})$/.exec(lines[8]!);
  const issued = /^Issued At: (\S+)$/.exec(lines[9]!);
  const expires = /^Expiration Time: (\S+)$/.exec(lines[10]!);
  const requestId = /^Request ID: hub_profile_wallet_link_v1:([A-Za-z0-9_-]{8,80})$/.exec(lines[11]!);
  if (!header || !uri || !chain || !nonce || !issued || !expires || !requestId) return null;
  const withHandle = /^Link this wallet to Hub profile @([A-Za-z0-9_.-]{1,64})\. This is not a transaction and costs nothing\.$/.exec(lines[3]!);
  const fields: BitcoinLinkMessageFields = {
    host: header[1]!,
    origin: uri[1]!,
    address: lines[1]!,
    handle: withHandle ? withHandle[1]! : null,
    chainRef: chain[1]!,
    nonce: nonce[1]!,
    issuedAt: issued[1]!,
    expiresAt: expires[1]!,
    challengeId: requestId[1]!,
  };
  try {
    return buildBitcoinLinkMessage(fields) === text ? fields : null;
  } catch {
    return null;
  }
}
