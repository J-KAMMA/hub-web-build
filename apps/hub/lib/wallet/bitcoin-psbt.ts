/**
 * Bitcoin send: build a PSBT in the browser with @scure/btc-signer, sign it in the user's own wallet, then
 * re-check the signed result against the confirmed values (design section 4). Pure: no network, no secrets,
 * no Node built-ins, so it runs in the browser and on Workers (the broadcast route re-runs the same check).
 *
 * Rules enforced here:
 *  - Hub holds no Bitcoin keys; this file never sees a private key.
 *  - Sends from taproot (P2TR) addresses are REFUSED: Hub cannot tell inscribed UTXOs from plain ones with a
 *    plain Esplora indexer, so a taproot send could burn an Ordinal. UTXOs of exactly 546 or 330 sats on any
 *    address are treated as possible inscriptions and are never selected.
 *  - Inputs come only from the sender address, one recipient output, change back to the same address,
 *    RBF enabled (nSequence 0xfffffffd), SIGHASH_ALL, no output below dust.
 *  - No exchange, swap, route or "buy" logic: a transfer of BTC and nothing else.
 */
import { ripemd160 } from "@noble/hashes/ripemd160";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { base64 } from "@scure/base";
import { NETWORK, p2wpkh, SigHash, TEST_NETWORK, Transaction } from "@scure/btc-signer";
import { parseBitcoinAddress, type BitcoinAddressKind, type ParsedBitcoinAddress } from "@/lib/chains/address/bitcoin";
import { getBitcoinNetwork } from "@/lib/chains/bitcoin-chain-registry";

export type BitcoinSendErrorCode =
  | "unsupported_chain"
  | "taproot_send_refused"
  | "unsupported_from_address"
  | "invalid_from_address"
  | "invalid_destination"
  | "wrong_network"
  | "pubkey_required"
  | "pubkey_mismatch"
  | "amount_too_small"
  | "invalid_amount"
  | "fee_rate_invalid"
  | "fee_too_high"
  | "no_spendable_utxos"
  | "insufficient_funds"
  | "too_many_inputs"
  | "signed_transaction_mismatch"
  | "signed_transaction_invalid";

export class BitcoinSendError extends Error {
  readonly code: BitcoinSendErrorCode;
  constructor(code: BitcoinSendErrorCode, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export type SpendableUtxo = { txid: string; vout: number; value: number; confirmed: boolean; height?: number };

export const MAX_FEE_RATE_SAT_VB = 1_000;
export const MAX_TOTAL_FEE_SATS = 1_000_000n;
export const MAX_INPUTS = 100;
export const RBF_SEQUENCE = 0xfffffffd;
/** UTXO values that look like inscription carriers. Never selected, always reported. */
export const POSSIBLE_INSCRIPTION_VALUES: ReadonlySet<number> = new Set([546, 330]);

const INPUT_VBYTES: Partial<Record<BitcoinAddressKind, number>> = { p2wpkh: 68, p2sh: 91 };
const OUTPUT_VBYTES: Record<BitcoinAddressKind, number> = { p2pkh: 34, p2sh: 32, p2wpkh: 31, p2wsh: 43, p2tr: 43 };
const TX_OVERHEAD_VBYTES = 11;

export function dustLimit(kind: BitcoinAddressKind): number {
  return kind === "p2tr" ? 330 : 546;
}

export type BitcoinSendSummary = {
  chainRef: string;
  networkName: string;
  testnet: boolean;
  from: string;
  fromKind: BitcoinAddressKind;
  to: string;
  toKind: BitcoinAddressKind;
  amountSats: string;
  feeSats: string;
  feeRate: number;
  vsize: number;
  changeSats: string;
  totalDebitedSats: string;
  inputCount: number;
  rbf: true;
  /** Possible inscription UTXOs that were left out of coin selection. */
  excludedPossibleInscriptions: number;
};

export type ExpectedSend = {
  chainRef: string;
  /** Outpoints the transaction must spend (exactly these, no others). */
  inputs: Array<{ txid: string; vout: number; value: string }>;
  /** Outputs by scriptPubKey hex (recipient first, then optional change). */
  outputs: Array<{ scriptHex: string; amount: string }>;
  feeSats: string;
};

export type BuiltBitcoinSend = { psbtBase64: string; summary: BitcoinSendSummary; expected: ExpectedSend };

const hash160 = (data: Uint8Array) => ripemd160(sha256(data));
const networkOf = (testnet: boolean) => (testnet ? TEST_NETWORK : NETWORK);
const outpointKey = (txid: string, vout: number) => `${txid}:${vout}`;

function parseOrThrow(chainRef: string, address: string, code: BitcoinSendErrorCode): ParsedBitcoinAddress {
  try {
    return parseBitcoinAddress(chainRef, address);
  } catch (error) {
    const reason = (error as { code?: string }).code;
    throw new BitcoinSendError(reason === "wrong_network" ? "wrong_network" : code);
  }
}

function parseAmount(value: unknown): bigint {
  let amount: bigint;
  try {
    amount = typeof value === "bigint" ? value : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : typeof value === "string" && /^[0-9]{1,16}$/.test(value) ? BigInt(value) : -1n;
  } catch {
    amount = -1n;
  }
  if (amount <= 0n || amount > 21_000_000n * 100_000_000n) throw new BitcoinSendError("invalid_amount");
  return amount;
}

/** Build the unsigned PSBT and the summary for the confirmation screen. */
export function buildBitcoinSend(input: {
  chainRef: string;
  from: string;
  to: string;
  amountSats: unknown;
  utxos: readonly SpendableUtxo[];
  feeRate: number;
  /** Compressed public key of the sender (hex). Required for P2SH-P2WPKH. */
  publicKeyHex?: string;
}): BuiltBitcoinSend {
  const network = getBitcoinNetwork(input.chainRef);
  if (!network) throw new BitcoinSendError("unsupported_chain");
  const from = parseOrThrow(network.chainRef, input.from, "invalid_from_address");
  if (from.kind === "p2tr") throw new BitcoinSendError("taproot_send_refused");
  if (from.kind !== "p2wpkh" && from.kind !== "p2sh") throw new BitcoinSendError("unsupported_from_address");
  const to = parseOrThrow(network.chainRef, input.to, "invalid_destination");
  const amount = parseAmount(input.amountSats);
  if (amount < BigInt(dustLimit(to.kind))) throw new BitcoinSendError("amount_too_small");
  if (!Number.isFinite(input.feeRate) || input.feeRate < 1 || input.feeRate > MAX_FEE_RATE_SAT_VB) throw new BitcoinSendError("fee_rate_invalid");

  let redeemScript: Uint8Array | undefined;
  if (from.kind === "p2sh") {
    if (!input.publicKeyHex || !/^0[23][0-9a-f]{64}$/i.test(input.publicKeyHex)) throw new BitcoinSendError("pubkey_required");
    const pub = hexToBytes(input.publicKeyHex.toLowerCase());
    redeemScript = p2wpkh(pub).script;
    if (bytesToHex(hash160(redeemScript)) !== from.programHex) throw new BitcoinSendError("pubkey_mismatch");
  }

  const confirmed = input.utxos.filter((u) => u.confirmed);
  const usable = confirmed.filter((u) => !POSSIBLE_INSCRIPTION_VALUES.has(u.value));
  const excluded = confirmed.length - usable.length;
  if (usable.length === 0) throw new BitcoinSendError("no_spendable_utxos");
  for (const u of usable) {
    if (!/^[0-9a-f]{64}$/.test(u.txid) || !Number.isSafeInteger(u.vout) || u.vout < 0 || !Number.isSafeInteger(u.value) || u.value <= 0) throw new BitcoinSendError("no_spendable_utxos");
  }

  const inputVbytes = INPUT_VBYTES[from.kind]!;
  const sorted = [...usable].sort((a, b) => b.value - a.value);
  const feeRate = input.feeRate;
  const vsizeFor = (inputs: number, outputs: number) => TX_OVERHEAD_VBYTES + inputs * inputVbytes + OUTPUT_VBYTES[to.kind] + (outputs > 1 ? OUTPUT_VBYTES[from.kind] : 0);
  const feeFor = (inputs: number, outputs: number) => BigInt(Math.ceil(vsizeFor(inputs, outputs) * feeRate));

  const selected: SpendableUtxo[] = [];
  let total = 0n;
  let fee = 0n;
  let change = 0n;
  let hasChange = false;
  for (const utxo of sorted) {
    selected.push(utxo);
    total += BigInt(utxo.value);
    if (selected.length > MAX_INPUTS) throw new BitcoinSendError("too_many_inputs");
    const feeWithChange = feeFor(selected.length, 2);
    const feeNoChange = feeFor(selected.length, 1);
    if (total >= amount + feeWithChange && total - amount - feeWithChange >= BigInt(dustLimit(from.kind))) {
      fee = feeWithChange; change = total - amount - fee; hasChange = true; break;
    }
    if (total >= amount + feeNoChange) {
      // Change would be dust (or none): it goes to the miners, and the screen shows the real fee.
      const leftover = total - amount - feeNoChange;
      if (leftover < BigInt(dustLimit(from.kind))) { fee = feeNoChange + leftover; change = 0n; hasChange = false; break; }
    }
  }
  if (fee === 0n) throw new BitcoinSendError("insufficient_funds");
  if (fee > MAX_TOTAL_FEE_SATS) throw new BitcoinSendError("fee_too_high");

  const net = networkOf(network.testnet);
  const tx = new Transaction({ version: 2, allowUnknownOutputs: false });
  for (const utxo of selected) {
    tx.addInput({
      txid: utxo.txid,
      index: utxo.vout,
      sequence: RBF_SEQUENCE,
      witnessUtxo: { script: hexToBytes(from.scriptPubKeyHex), amount: BigInt(utxo.value) },
      ...(redeemScript ? { redeemScript } : {}),
      sighashType: SigHash.ALL,
    });
  }
  tx.addOutputAddress(to.normalized, amount, net);
  if (hasChange) tx.addOutputAddress(from.normalized, change, net);

  const vsize = vsizeFor(selected.length, hasChange ? 2 : 1);
  const summary: BitcoinSendSummary = {
    chainRef: network.chainRef,
    networkName: network.name,
    testnet: network.testnet,
    from: from.normalized,
    fromKind: from.kind,
    to: to.normalized,
    toKind: to.kind,
    amountSats: amount.toString(),
    feeSats: fee.toString(),
    feeRate: Number((Number(fee) / vsize).toFixed(2)),
    vsize,
    changeSats: change.toString(),
    totalDebitedSats: (amount + fee).toString(),
    inputCount: selected.length,
    rbf: true,
    excludedPossibleInscriptions: excluded,
  };
  const expected: ExpectedSend = {
    chainRef: network.chainRef,
    inputs: selected.map((u) => ({ txid: u.txid, vout: u.vout, value: String(u.value) })),
    outputs: [{ scriptHex: to.scriptPubKeyHex, amount: amount.toString() }, ...(hasChange ? [{ scriptHex: from.scriptPubKeyHex, amount: change.toString() }] : [])],
    feeSats: fee.toString(),
  };
  return { psbtBase64: base64.encode(tx.toPSBT()), summary, expected };
}

export type VerifiedSignedSend = { hex: string; txid: string; vsize: number };

/**
 * Re-parse what the wallet returned (a finalized or finalizable PSBT, or a raw transaction) and require it to
 * match the confirmed values EXACTLY: the same inputs, the same outputs (scripts and amounts), the expected fee,
 * RBF sequences. A changed output, an added input or a different fee is refused before broadcast.
 */
export function verifySignedBitcoinSend(signed: { psbtBase64?: string; rawHex?: string }, expected: ExpectedSend): VerifiedSignedSend {
  let tx: Transaction;
  try {
    if (signed.psbtBase64) {
      tx = Transaction.fromPSBT(base64.decode(signed.psbtBase64));
      if (!tx.isFinal) tx.finalize();
    } else if (signed.rawHex && /^(?:[0-9a-f]{2})+$/i.test(signed.rawHex)) {
      tx = Transaction.fromRaw(hexToBytes(signed.rawHex.toLowerCase()), { allowUnknownInputs: true, allowUnknownOutputs: true, disableScriptCheck: true });
    } else {
      throw new Error("missing signed transaction");
    }
  } catch {
    throw new BitcoinSendError("signed_transaction_invalid");
  }
  const expectedInputs = new Map(expected.inputs.map((i) => [outpointKey(i.txid, i.vout), i]));
  if (tx.inputsLength !== expectedInputs.size) throw new BitcoinSendError("signed_transaction_mismatch", "inputs");
  const seen = new Set<string>();
  for (let i = 0; i < tx.inputsLength; i += 1) {
    const input = tx.getInput(i);
    const txid = input.txid ? bytesToHex(input.txid) : "";
    const key = outpointKey(txid, input.index ?? -1);
    if (!expectedInputs.has(key) || seen.has(key)) throw new BitcoinSendError("signed_transaction_mismatch", "inputs");
    seen.add(key);
    if (input.sequence !== RBF_SEQUENCE) throw new BitcoinSendError("signed_transaction_mismatch", "sequence");
  }
  if (tx.outputsLength !== expected.outputs.length) throw new BitcoinSendError("signed_transaction_mismatch", "outputs");
  const wanted = new Map<string, number>();
  for (const out of expected.outputs) wanted.set(`${out.scriptHex}:${out.amount}`, (wanted.get(`${out.scriptHex}:${out.amount}`) ?? 0) + 1);
  for (let i = 0; i < tx.outputsLength; i += 1) {
    const out = tx.getOutput(i);
    const key = `${out.script ? bytesToHex(out.script) : ""}:${out.amount ?? -1n}`;
    const left = wanted.get(key) ?? 0;
    if (left === 0) throw new BitcoinSendError("signed_transaction_mismatch", "outputs");
    wanted.set(key, left - 1);
  }
  const inputTotal = expected.inputs.reduce((sum, i) => sum + BigInt(i.value), 0n);
  const outputTotal = expected.outputs.reduce((sum, o) => sum + BigInt(o.amount), 0n);
  if (inputTotal - outputTotal !== BigInt(expected.feeSats) || BigInt(expected.feeSats) > MAX_TOTAL_FEE_SATS) throw new BitcoinSendError("signed_transaction_mismatch", "fee");
  if (!tx.isFinal) throw new BitcoinSendError("signed_transaction_invalid");
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize };
}
