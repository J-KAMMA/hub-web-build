/**
 * Bitcoin address parsing for the wallet registry (design section 1.2). Pure; used by client and server.
 * Output carries the scriptPubKey: indexer and tip checks compare scripts, never address strings.
 * Accepted: P2PKH, P2SH, P2WPKH, P2WSH (watch-only/receive), P2TR. Everything else is rejected.
 */
import { base58check, bech32, bech32m } from "@scure/base";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { getBitcoinNetwork, type BitcoinNetworkEntry } from "../bitcoin-chain-registry";

export type BitcoinAddressKind = "p2pkh" | "p2sh" | "p2wpkh" | "p2wsh" | "p2tr";
export type BitcoinAddressErrorCode = "invalid_address" | "wrong_network" | "unsupported_script" | "unknown_network";

export class BitcoinAddressError extends Error {
  readonly code: BitcoinAddressErrorCode;
  constructor(code: BitcoinAddressErrorCode) {
    super(code);
    this.code = code;
  }
}

export type ParsedBitcoinAddress = {
  chainRef: string;
  kind: BitcoinAddressKind;
  normalized: string;
  scriptPubKeyHex: string;
  /** hash160 for p2pkh/p2sh/p2wpkh, 32-byte program for p2wsh/p2tr. */
  programHex: string;
};

const b58c = base58check(sha256);
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{25,35}$/;

function fromSegwit(text: string, network: BitcoinNetworkEntry): ParsedBitcoinAddress {
  // BIP-173: all lowercase or all uppercase, never mixed.
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) throw new BitcoinAddressError("invalid_address");
  const lower = text.toLowerCase();
  let decoded: { prefix: string; words: number[] } | null = null;
  let isM = false;
  try { decoded = bech32.decode(lower as `${string}1${string}`, 90); } catch { /* try bech32m */ }
  if (!decoded) {
    try { decoded = bech32m.decode(lower as `${string}1${string}`, 90); isM = true; } catch { throw new BitcoinAddressError("invalid_address"); }
  }
  if (decoded.prefix !== network.hrp) {
    throw new BitcoinAddressError(decoded.prefix === "bc" || decoded.prefix === "tb" || decoded.prefix === "bcrt" ? "wrong_network" : "invalid_address");
  }
  const version = decoded.words[0];
  if (version === undefined || version > 16) throw new BitcoinAddressError("invalid_address");
  // BIP-350: v0 must be bech32, v1+ must be bech32m.
  if ((version === 0) === isM) throw new BitcoinAddressError("invalid_address");
  let program: Uint8Array;
  try { program = Uint8Array.from(bech32.fromWords(decoded.words.slice(1))); } catch { throw new BitcoinAddressError("invalid_address"); }
  let kind: BitcoinAddressKind;
  let prefix: string;
  if (version === 0 && program.length === 20) { kind = "p2wpkh"; prefix = "0014"; }
  else if (version === 0 && program.length === 32) { kind = "p2wsh"; prefix = "0020"; }
  else if (version === 1 && program.length === 32) { kind = "p2tr"; prefix = "5120"; }
  else if (version === 0) throw new BitcoinAddressError("invalid_address");
  else throw new BitcoinAddressError("unsupported_script");
  const programHex = bytesToHex(program);
  return { chainRef: network.chainRef, kind, normalized: lower, scriptPubKeyHex: prefix + programHex, programHex };
}

function fromBase58(text: string, network: BitcoinNetworkEntry): ParsedBitcoinAddress {
  if (!BASE58_RE.test(text)) throw new BitcoinAddressError("invalid_address");
  let bytes: Uint8Array;
  try { bytes = b58c.decode(text); } catch { throw new BitcoinAddressError("invalid_address"); }
  if (bytes.length !== 21) throw new BitcoinAddressError("invalid_address");
  const hash = bytesToHex(bytes.slice(1));
  const version = bytes[0]!;
  if (version === network.p2pkhVersion) return { chainRef: network.chainRef, kind: "p2pkh", normalized: text, scriptPubKeyHex: `76a914${hash}88ac`, programHex: hash };
  if (version === network.p2shVersion) return { chainRef: network.chainRef, kind: "p2sh", normalized: text, scriptPubKeyHex: `a914${hash}87`, programHex: hash };
  // A known version byte of another Bitcoin network is a network mismatch, anything else is simply invalid.
  throw new BitcoinAddressError([0x00, 0x05, 0x6f, 0xc4].includes(version) ? "wrong_network" : "invalid_address");
}

/** Parse an address for the given network. Throws BitcoinAddressError. Trims plain ASCII whitespace only; zero-width characters are rejected. */
export function parseBitcoinAddress(chainRef: string, input: unknown): ParsedBitcoinAddress {
  const network = getBitcoinNetwork(chainRef);
  if (!network) throw new BitcoinAddressError("unknown_network");
  if (typeof input !== "string") throw new BitcoinAddressError("invalid_address");
  const text = input.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
  if (!text || text.length > 100 || !/^[\x21-\x7e]+$/.test(text)) throw new BitcoinAddressError("invalid_address");
  const lead = text.slice(0, 3).toLowerCase();
  if (lead === "bc1" || lead === "tb1" || text.toLowerCase().startsWith("bcrt1")) return fromSegwit(text, network);
  return fromBase58(text, network);
}

export function tryParseBitcoinAddress(chainRef: string, input: unknown): ParsedBitcoinAddress | null {
  try { return parseBitcoinAddress(chainRef, input); } catch { return null; }
}
