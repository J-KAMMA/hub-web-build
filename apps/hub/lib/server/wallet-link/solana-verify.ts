/**
 * Solana ownership proof: ed25519 over the exact issued Sign-In With Solana message (design section 2.2).
 * Strict RFC 8032 verification (zip215: false) rejects malleable and non-canonical signatures.
 */
import { ed25519 } from "@noble/curves/ed25519";

const TEXT = new TextEncoder();

/** Accepts standard or url-safe base64 of exactly 64 bytes. Returns null for anything else. */
export function decodeSignatureBase64(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length < 80 || value.length > 100) return null;
  if (!/^[A-Za-z0-9+/_-]+=*$/.test(value)) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    if (binary.length !== 64) return null;
    const bytes = new Uint8Array(64);
    for (let i = 0; i < 64; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export function verifySolanaMessageSignature(message: string, signature: Uint8Array, publicKey: Uint8Array): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) return false;
  try {
    return ed25519.verify(signature, TEXT.encode(message), publicKey, { zip215: false });
  } catch {
    return false;
  }
}
