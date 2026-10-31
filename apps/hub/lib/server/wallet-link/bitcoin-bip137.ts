/**
 * Legacy "signmessage" (BIP-137 header byte) verification for wallet links (design section 2.3).
 *
 * The header byte must match the address kind:
 *   27-30 uncompressed P2PKH, 31-34 compressed P2PKH, 35-38 P2SH-P2WPKH, 39-42 P2WPKH.
 * Taproot (and anything else) is never verified here: BIP-137 has no taproot form, and accepting a
 * recoverable signature against a P2TR output key would be a forgery risk.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, concatBytes, utf8ToBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";
import type { ParsedBitcoinAddress } from "@/lib/chains/address/bitcoin";

export type Bip137Result =
  | { ok: true; method: "bip137_legacy" }
  | { ok: false; reason: "unsupported_script" | "malformed_signature" | "header_mismatch" | "invalid_signature" };

const FAIL = (reason: Extract<Bip137Result, { ok: false }>["reason"]): Bip137Result => ({ ok: false, reason });
const hash160 = (data: Uint8Array) => ripemd160(sha256(data));
const CURVE_N = secp256k1.CURVE.n;

function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
}

/** double SHA-256 of "\x18Bitcoin Signed Message:\n" || varint(len) || message. */
export function bitcoinSignedMessageHash(message: string): Uint8Array {
  const body = utf8ToBytes(message);
  const prefix = utf8ToBytes("Bitcoin Signed Message:\n");
  return sha256(sha256(concatBytes(Uint8Array.of(prefix.length), prefix, varint(body.length), body)));
}

export function verifyBip137(address: ParsedBitcoinAddress, message: string, signature: unknown): Bip137Result {
  if (typeof signature !== "string" || signature.length < 80 || signature.length > 100) return FAIL("malformed_signature");
  if (address.kind !== "p2pkh" && address.kind !== "p2sh" && address.kind !== "p2wpkh") return FAIL("unsupported_script");
  let raw: Uint8Array;
  try { raw = base64.decode(signature.trim()); } catch { return FAIL("malformed_signature"); }
  if (raw.length !== 65) return FAIL("malformed_signature");
  const header = raw[0]!;
  if (header < 27 || header > 42) return FAIL("header_mismatch");
  const expectedRange = address.kind === "p2pkh" ? [27, 34] : address.kind === "p2sh" ? [35, 38] : [39, 42];
  if (header < expectedRange[0]! || header > expectedRange[1]!) return FAIL("header_mismatch");
  const recovery = (header - 27) & 3;
  const compressed = address.kind !== "p2pkh" || header >= 31;
  let publicKey: Uint8Array;
  try {
    const sig = secp256k1.Signature.fromCompact(raw.slice(1)).addRecoveryBit(recovery);
    if (sig.s > CURVE_N >> 1n) return FAIL("invalid_signature"); // low-S only
    publicKey = sig.recoverPublicKey(bitcoinSignedMessageHash(message)).toRawBytes(compressed);
  } catch {
    return FAIL("invalid_signature");
  }
  let matches: boolean;
  if (address.kind === "p2sh") {
    // P2SH-P2WPKH: redeem script is 0014{hash160(pubkey)}.
    matches = bytesToHex(hash160(concatBytes(Uint8Array.of(0x00, 0x14), hash160(publicKey)))) === address.programHex;
  } else {
    matches = bytesToHex(hash160(publicKey)) === address.programHex;
  }
  return matches ? { ok: true, method: "bip137_legacy" } : FAIL("invalid_signature");
}
