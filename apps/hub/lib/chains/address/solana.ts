/**
 * Solana address handling (design section 1.2). Pure: client and server share it. No @solana/web3.js.
 * An address is the base58 encoding of a 32-byte ed25519 public key. Base58 is case-sensitive: addresses are
 * stored exactly as given, never case-folded.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export type SolanaAddressErrorCode = "malformed_address" | "address_cannot_sign";

export class SolanaAddressError extends Error {
  constructor(readonly code: SolanaAddressErrorCode) {
    super(code);
  }
}

/** Decodes a Solana address to its 32 bytes, or null. Rejects any non-canonical base58 encoding. */
export function decodeSolanaAddress(value: unknown): Uint8Array | null {
  if (typeof value !== "string") return null;
  if (value.length < 32 || value.length > 44 || !BASE58.test(value)) return null;
  let bytes: Uint8Array;
  try {
    bytes = base58.decode(value);
  } catch {
    return null;
  }
  if (bytes.length !== 32) return null;
  // Round trip: refuses leading-zero tricks and any alternative spelling of the same bytes.
  return base58.encode(bytes) === value ? bytes : null;
}

/** Trimmed, validated address string (case preserved), or null. Whitespace inside is never removed. */
export function normalizeSolanaAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return decodeSolanaAddress(trimmed) ? trimmed : null;
}

/** True when the 32 bytes decode to a point on the ed25519 curve, so a key can exist for them. */
export function isOnEd25519Curve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  try {
    ed25519.ExtendedPoint.fromHex(bytes);
    return true;
  } catch {
    return false;
  }
}

/** For wallet links: a valid address whose bytes are a curve point. Program-derived addresses cannot sign. */
export function normalizeSolanaSignerAddress(value: unknown): { address: string; publicKey: Uint8Array } {
  const address = normalizeSolanaAddress(value);
  if (!address) throw new SolanaAddressError("malformed_address");
  const publicKey = decodeSolanaAddress(address)!;
  if (!isOnEd25519Curve(publicKey)) throw new SolanaAddressError("address_cannot_sign");
  return { address, publicKey };
}

/** A transaction signature: 64 bytes, base58. */
export function normalizeSolanaSignature(value: unknown): string | null {
  if (typeof value !== "string" || value.length < 80 || value.length > 90 || !BASE58.test(value)) return null;
  try {
    const bytes = base58.decode(value);
    return bytes.length === 64 && base58.encode(bytes) === value ? value : null;
  } catch {
    return null;
  }
}
