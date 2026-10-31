/**
 * BIP-322 message verification for wallet links (design section 2.3). Narrow on purpose.
 *
 * Accepted:
 *  - P2WPKH: simple or full (single ECDSA key, SIGHASH_ALL, low-S)
 *  - P2TR: simple or full, key-path only (one 64- or 65-byte Schnorr witness item; sighash DEFAULT or ALL)
 *  - P2SH-P2WPKH: full only (simple is for native segwit)
 * Rejected: P2PKH (legacy BIP-137 only), P2WSH, multisig, taproot script-path, anything else.
 *
 * "Full" must be exactly the virtual `to_sign` for this `to_spend`: version 0, locktime 0, one input with
 * sequence 0 spending to_spend:0, one zero-value OP_RETURN output. Time-locked variants are not accepted
 * (they are only enabled in tests to prove the sighash code against the official generated vectors).
 *
 * Implemented on @noble/@scure primitives only (no Node Buffer, no bitcoinjs); sighashes are written out here
 * and validated against the BIP-322 test vectors in bitcoin-bip322.test.ts.
 */
import { schnorr, secp256k1 } from "@noble/curves/secp256k1";
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";
import { RawTx, RawWitness } from "@scure/btc-signer";
import type { ParsedBitcoinAddress } from "@/lib/chains/address/bitcoin";

export type Bip322Method = "bip322_simple" | "bip322_full";
export type Bip322Result =
  | { ok: true; method: Bip322Method }
  | { ok: false; reason: "unsupported_script" | "malformed_signature" | "invalid_signature" | "not_key_path" };

const FAIL = (reason: Extract<Bip322Result, { ok: false }>["reason"]): Bip322Result => ({ ok: false, reason });
const hash160 = (data: Uint8Array) => ripemd160(sha256(data));
const equalBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, index) => byte === b[index]);
const sha256d = (data: Uint8Array) => sha256(sha256(data));
const u32le = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n >>> 0, true); return b; };
const i32le = (n: number) => { const b = new Uint8Array(4); new DataView(b.buffer).setInt32(0, n, true); return b; };
const u64le = (n: bigint) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, n, true); return b; };
function varint(n: number): Uint8Array {
  if (n < 0xfd) return Uint8Array.of(n);
  if (n <= 0xffff) return Uint8Array.of(0xfd, n & 0xff, n >> 8);
  return Uint8Array.of(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
}
const varBytes = (data: Uint8Array) => concatBytes(varint(data.length), data);

const TAG_BIP322 = sha256(utf8ToBytes("BIP0322-signed-message"));
const TAG_TAPSIGHASH = sha256(utf8ToBytes("TapSighash"));
const OP_RETURN = Uint8Array.of(0x6a);

/** sha256_tag(message) for the BIP0322-signed-message tag. */
export function bip322MessageHash(message: string): Uint8Array {
  return sha256(concatBytes(TAG_BIP322, TAG_BIP322, utf8ToBytes(message)));
}

/** Serialised `to_spend` (legacy form: version 0, one input, one zero-value output paying to the challenge script). */
export function bip322ToSpendTx(message: string, scriptPubKey: Uint8Array): Uint8Array {
  const scriptSig = concatBytes(Uint8Array.of(0x00, 0x20), bip322MessageHash(message));
  return concatBytes(
    i32le(0),
    varint(1),
    new Uint8Array(32), u32le(0xffffffff), varBytes(scriptSig), u32le(0),
    varint(1),
    u64le(0n), varBytes(scriptPubKey),
    u32le(0),
  );
}

/** Internal-order txid bytes of to_spend (as used inside the outpoint of to_sign). */
export function bip322ToSpendTxid(message: string, scriptPubKey: Uint8Array): Uint8Array {
  return sha256d(bip322ToSpendTx(message, scriptPubKey));
}

type ToSign = {
  version: number;
  lockTime: number;
  sequence: number;
  /** Outpoint txid in internal byte order, index 0. */
  prevTxid: Uint8Array;
  scriptSig: Uint8Array;
  witness: Uint8Array[];
};

/** BIP-143 sighash (SIGHASH_ALL) for the single input of to_sign. */
function sighashV0(tx: ToSign, scriptCode: Uint8Array, amount: bigint): Uint8Array {
  const outpoint = concatBytes(tx.prevTxid, u32le(0));
  const hashPrevouts = sha256d(outpoint);
  const hashSequence = sha256d(u32le(tx.sequence));
  const hashOutputs = sha256d(concatBytes(u64le(0n), varBytes(OP_RETURN)));
  return sha256d(concatBytes(
    i32le(tx.version), hashPrevouts, hashSequence, outpoint, varBytes(scriptCode), u64le(amount),
    u32le(tx.sequence), hashOutputs, u32le(tx.lockTime), u32le(1),
  ));
}

/** BIP-341 key-path sighash for the single input of to_sign (spent output amount 0, script `spk`). */
function sighashV1(tx: ToSign, spk: Uint8Array, hashType: number): Uint8Array {
  const outpoint = concatBytes(tx.prevTxid, u32le(0));
  const msg = concatBytes(
    Uint8Array.of(0x00), // epoch
    Uint8Array.of(hashType),
    i32le(tx.version),
    u32le(tx.lockTime),
    sha256(outpoint),
    sha256(u64le(0n)),
    sha256(varBytes(spk)),
    sha256(u32le(tx.sequence)),
    sha256(concatBytes(u64le(0n), varBytes(OP_RETURN))),
    Uint8Array.of(0x00), // spend_type: key path, no annex
    u32le(0),
  );
  return sha256(concatBytes(TAG_TAPSIGHASH, TAG_TAPSIGHASH, msg));
}

const CURVE_N = secp256k1.CURVE.n;
function verifyEcdsa(sigWithType: Uint8Array, hash: Uint8Array, pubkey: Uint8Array): boolean {
  if (sigWithType.length < 9 || sigWithType.length > 73) return false;
  if (sigWithType[sigWithType.length - 1] !== 0x01) return false; // SIGHASH_ALL only
  if (pubkey.length !== 33 || (pubkey[0] !== 0x02 && pubkey[0] !== 0x03)) return false;
  try {
    const sig = secp256k1.Signature.fromDER(sigWithType.slice(0, -1));
    if (sig.s > CURVE_N >> 1n) return false; // low-S only
    return secp256k1.verify(sig, hash, pubkey, { lowS: true });
  } catch {
    return false;
  }
}

function checkInput(address: ParsedBitcoinAddress, tx: ToSign, scriptSigMustBeEmpty: boolean): Bip322Result {
  const spk = hexToBytes(address.scriptPubKeyHex);
  const program = hexToBytes(address.programHex);
  if (address.kind === "p2wpkh") {
    if (tx.scriptSig.length !== 0 || tx.witness.length !== 2) return FAIL("invalid_signature");
    const [sig, pubkey] = tx.witness as [Uint8Array, Uint8Array];
    if (!equalBytes(hash160(pubkey), program)) return FAIL("invalid_signature");
    const scriptCode = concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), program, Uint8Array.of(0x88, 0xac));
    return verifyEcdsa(sig, sighashV0(tx, scriptCode, 0n), pubkey) ? { ok: true, method: "bip322_full" } : FAIL("invalid_signature");
  }
  if (address.kind === "p2sh") {
    // Single-key P2SH-P2WPKH only: scriptSig is exactly one push of the 22-byte redeem script 0014{hash160(pubkey)}.
    if (scriptSigMustBeEmpty || tx.witness.length !== 2) return FAIL("unsupported_script");
    const [sig, pubkey] = tx.witness as [Uint8Array, Uint8Array];
    const redeem = concatBytes(Uint8Array.of(0x00, 0x14), hash160(pubkey));
    if (!equalBytes(tx.scriptSig, concatBytes(Uint8Array.of(0x16), redeem))) return FAIL("unsupported_script");
    if (!equalBytes(hash160(redeem), program)) return FAIL("invalid_signature");
    const scriptCode = concatBytes(Uint8Array.of(0x76, 0xa9, 0x14), hash160(pubkey), Uint8Array.of(0x88, 0xac));
    return verifyEcdsa(sig, sighashV0(tx, scriptCode, 0n), pubkey) ? { ok: true, method: "bip322_full" } : FAIL("invalid_signature");
  }
  if (address.kind === "p2tr") {
    if (tx.scriptSig.length !== 0) return FAIL("invalid_signature");
    // Key path only: exactly one item. Two or more items (control block / script path or annex) are refused.
    if (tx.witness.length !== 1) return FAIL("not_key_path");
    const item = tx.witness[0]!;
    if (item.length !== 64 && item.length !== 65) return FAIL("not_key_path");
    let hashType = 0x00;
    if (item.length === 65) {
      hashType = item[64]!;
      if (hashType !== 0x01) return FAIL("invalid_signature"); // 0x00 may not be explicit; only ALL
    }
    try {
      return schnorr.verify(item.slice(0, 64), sighashV1(tx, spk, hashType), program) ? { ok: true, method: "bip322_full" } : FAIL("invalid_signature");
    } catch {
      return FAIL("invalid_signature");
    }
  }
  return FAIL("unsupported_script");
}

export type Bip322Options = {
  /** Accept time-locked / non-zero version "full" proofs. Tests only; production verification is strict. */
  allowTimelockedFull?: boolean;
};

function decodeBase64(text: string): Uint8Array | null {
  try { return base64.decode(text.trim()); } catch { return null; }
}

/** Verify a BIP-322 simple or full signature for `message` (the exact issued text) against `address`. */
export function verifyBip322(address: ParsedBitcoinAddress, message: string, signature: unknown, options: Bip322Options = {}): Bip322Result {
  if (typeof signature !== "string" || signature.length < 8 || signature.length > 4096) return FAIL("malformed_signature");
  if (address.kind === "p2pkh" || address.kind === "p2wsh") return FAIL("unsupported_script");
  const spk = hexToBytes(address.scriptPubKeyHex);
  const toSpendTxid = bip322ToSpendTxid(message, spk);

  let variant: "simple" | "full" | "unknown" = "unknown";
  let body = signature.trim();
  if (body.startsWith("smp")) { variant = "simple"; body = body.slice(3); }
  else if (body.startsWith("ful")) { variant = "full"; body = body.slice(3); }
  const bytes = decodeBase64(body);
  if (!bytes || bytes.length === 0) return FAIL("malformed_signature");

  const trySimple = (): Bip322Result | null => {
    if (address.kind === "p2sh") return FAIL("unsupported_script"); // simple is for native segwit and taproot only
    let witness: Uint8Array[];
    try {
      witness = RawWitness.decode(bytes);
      if (!equalBytes(RawWitness.encode(witness), bytes)) return null; // trailing bytes / non-canonical
    } catch { return null; }
    const result = checkInput(address, { version: 0, lockTime: 0, sequence: 0, prevTxid: toSpendTxid, scriptSig: new Uint8Array(0), witness }, true);
    return result.ok ? { ok: true, method: "bip322_simple" } : result;
  };

  const tryFull = (): Bip322Result | null => {
    let tx: ReturnType<typeof RawTx.decode>;
    try {
      tx = RawTx.decode(bytes);
      if (!equalBytes(RawTx.encode(tx), bytes)) return null;
    } catch { return null; }
    if (tx.inputs.length !== 1 || tx.outputs.length !== 1) return FAIL("invalid_signature");
    const input = tx.inputs[0]!;
    const output = tx.outputs[0]!;
    // RawTx exposes the txid in display (reversed) byte order; our to_spend txid is in internal order.
    const prev = Uint8Array.from(input.txid).reverse();
    if (input.index !== 0 || !equalBytes(prev, toSpendTxid)) return FAIL("invalid_signature");
    if (output.amount !== 0n || !equalBytes(output.script, OP_RETURN)) return FAIL("invalid_signature");
    if (!options.allowTimelockedFull && (tx.version !== 0 || tx.lockTime !== 0 || input.sequence !== 0)) return FAIL("invalid_signature");
    const witness = tx.witnesses?.[0] ?? [];
    return checkInput(address, { version: tx.version, lockTime: tx.lockTime, sequence: input.sequence, prevTxid: toSpendTxid, scriptSig: input.finalScriptSig ?? new Uint8Array(0), witness }, false);
  };

  let result: Bip322Result | null;
  if (variant === "simple") result = trySimple();
  else if (variant === "full" || address.kind === "p2sh") result = tryFull();
  else result = trySimple() ?? tryFull();
  return result ?? FAIL("malformed_signature");
}
