/**
 * Solana send builder (design section 4). Runs in the browser; Hub never holds a Solana key.
 *
 *  - SOL: one System Program transfer.
 *  - SPL / Token-2022: `transferChecked` (decimals bound) from the sender's associated token account to the recipient's,
 *    preceded by `createAssociatedTokenAccountIdempotent` when the recipient has none. No other instruction.
 *  - Token-2022 mints with TransferHook, PermanentDelegate, NonTransferable or ConfidentialTransfer are refused.
 *
 * The confirmation screen reads what is shown from the serialized transaction itself (`inspectSolanaTransaction`),
 * not from the form, so the user confirms exactly the bytes the wallet is asked to sign. No swap, quote or route.
 */
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createNoopSigner,
  createTransactionMessage,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
} from "@solana/kit";
import { getTransferSolInstruction, SYSTEM_PROGRAM_ADDRESS } from "@solana-program/system";
import {
  findAssociatedTokenPda as findAssociatedTokenPdaLegacy,
  getCreateAssociatedTokenIdempotentInstruction as createAtaLegacy,
  getTransferCheckedInstruction as transferCheckedLegacy,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  findAssociatedTokenPda as findAssociatedTokenPda2022,
  getCreateAssociatedTokenIdempotentInstruction as createAta2022,
  getTransferCheckedInstruction as transferChecked2022,
  TOKEN_2022_PROGRAM_ADDRESS,
} from "@solana-program/token-2022";

import { decodeSolanaAddress } from "@/lib/chains/address/solana";

export type SolanaSendErrorCode =
  | "invalid_address"
  | "invalid_amount"
  | "same_address"
  | "mint_extension_unsupported"
  | "unsupported_token_program"
  | "insufficient_funds"
  | "source_not_associated_account"
  | "unexpected_transaction";

export class SolanaSendError extends Error {
  constructor(readonly code: SolanaSendErrorCode, readonly detail?: string) {
    super(code);
  }
}

/** Lamports charged per signature. A priority fee is not offered. */
export const SOLANA_BASE_FEE_LAMPORTS = BigInt(5000);

export const TOKEN_PROGRAM_IDS = {
  "spl-token": TOKEN_PROGRAM_ADDRESS as string,
  "spl-token-2022": TOKEN_2022_PROGRAM_ADDRESS as string,
} as const;
export type TokenProgramName = keyof typeof TOKEN_PROGRAM_IDS;

const REFUSED_EXTENSIONS = ["transferHook", "permanentDelegate", "nonTransferable", "confidentialTransferMint", "confidentialTransferFeeConfig"];

export type SolanaLifetime = { blockhash: string; lastValidBlockHeight: number };

function requireAddress(value: string): Address {
  if (!decodeSolanaAddress(value)) throw new SolanaSendError("invalid_address");
  return address(value);
}

function requireAmount(value: bigint, max?: bigint): bigint {
  if (typeof value !== "bigint" || value <= BigInt(0) || value >= BigInt(1) << BigInt(64)) throw new SolanaSendError("invalid_amount");
  if (max !== undefined && value > max) throw new SolanaSendError("insufficient_funds");
  return value;
}

function compile(feePayer: Address, lifetime: SolanaLifetime, instructions: Instruction[]) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: lifetime.blockhash as Blockhash, lastValidBlockHeight: BigInt(lifetime.lastValidBlockHeight) }, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  return new Uint8Array(getTransactionEncoder().encode(compileTransaction(message)));
}

export type BuiltSolanaSend = {
  kind: "sol" | "spl";
  from: string;
  to: string;
  amount: bigint;
  mint: string | null;
  decimals: number | null;
  tokenProgram: TokenProgramName | null;
  createRecipientAccount: boolean;
  sourceAccount: string | null;
  recipientAccount: string | null;
  /** Serialized, unsigned transaction handed to the wallet. */
  transaction: Uint8Array;
};

export function buildSolSend(input: { from: string; to: string; lamports: bigint; balanceLamports?: bigint; lifetime: SolanaLifetime }): BuiltSolanaSend {
  const from = requireAddress(input.from);
  const to = requireAddress(input.to);
  if (from === to) throw new SolanaSendError("same_address");
  const amount = requireAmount(input.lamports);
  if (input.balanceLamports !== undefined && amount + SOLANA_BASE_FEE_LAMPORTS > input.balanceLamports) throw new SolanaSendError("insufficient_funds");
  const instruction = getTransferSolInstruction({ source: createNoopSigner(from), destination: to, amount });
  return {
    kind: "sol", from, to, amount, mint: null, decimals: null, tokenProgram: null,
    createRecipientAccount: false, sourceAccount: null, recipientAccount: null,
    transaction: compile(from, input.lifetime, [instruction]),
  };
}

export type MintFacts = { program: TokenProgramName; decimals: number; extensions: readonly string[] };

export function assertSendableMint(mint: MintFacts): void {
  const refused = mint.extensions.find((name) => REFUSED_EXTENSIONS.includes(name));
  if (refused) throw new SolanaSendError("mint_extension_unsupported", refused);
}

export async function deriveAssociatedTokenAccount(owner: string, mint: string, program: TokenProgramName): Promise<string> {
  const args = { owner: requireAddress(owner), mint: requireAddress(mint) };
  const [pda] = program === "spl-token"
    ? await findAssociatedTokenPdaLegacy({ ...args, tokenProgram: TOKEN_PROGRAM_ADDRESS })
    : await findAssociatedTokenPda2022({ ...args, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS });
  return pda;
}

export async function buildSplSend(input: {
  from: string;
  to: string;
  mint: string;
  amount: bigint;
  mintFacts: MintFacts;
  /** The sender's associated token account balance (raw units). */
  sourceBalance: bigint;
  recipientAccountExists: boolean;
  lifetime: SolanaLifetime;
}): Promise<BuiltSolanaSend> {
  const from = requireAddress(input.from);
  const to = requireAddress(input.to);
  const mint = requireAddress(input.mint);
  if (from === to) throw new SolanaSendError("same_address");
  assertSendableMint(input.mintFacts);
  const amount = requireAmount(input.amount, input.sourceBalance);
  const { program, decimals } = input.mintFacts;
  if (program !== "spl-token" && program !== "spl-token-2022") throw new SolanaSendError("unsupported_token_program");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) throw new SolanaSendError("invalid_amount");

  const sourceAccount = address(await deriveAssociatedTokenAccount(from, mint, program));
  const recipientAccount = address(await deriveAssociatedTokenAccount(to, mint, program));
  const signer = createNoopSigner(from);
  const create = !input.recipientAccountExists;
  const instructions: Instruction[] = [];
  if (program === "spl-token") {
    if (create) instructions.push(createAtaLegacy({ payer: signer, ata: recipientAccount, owner: to, mint, tokenProgram: TOKEN_PROGRAM_ADDRESS }));
    instructions.push(transferCheckedLegacy({ source: sourceAccount, mint, destination: recipientAccount, authority: signer, amount, decimals }));
  } else {
    if (create) instructions.push(createAta2022({ payer: signer, ata: recipientAccount, owner: to, mint, tokenProgram: TOKEN_2022_PROGRAM_ADDRESS }));
    instructions.push(transferChecked2022({ source: sourceAccount, mint, destination: recipientAccount, authority: signer, amount, decimals }));
  }
  return {
    kind: "spl", from, to, amount, mint, decimals, tokenProgram: program,
    createRecipientAccount: create, sourceAccount, recipientAccount,
    transaction: compile(from, input.lifetime, instructions),
  };
}

/* ---- Reading back what will be signed ---------------------------------------------------------------------- */

export type DecodedOperation =
  | { type: "transfer-sol"; source: string; destination: string; lamports: bigint }
  | { type: "create-token-account"; payer: string; account: string; owner: string; mint: string; program: string }
  | { type: "transfer-checked"; source: string; mint: string; destination: string; authority: string; amount: bigint; decimals: number; program: string };

export type InspectedTransaction = {
  feePayer: string;
  requiredSignatures: number;
  operations: DecodedOperation[];
  /** Any instruction this decoder does not recognise: the screen must refuse to proceed when this is non-empty. */
  unknown: string[];
};

function readU64(data: { readonly [index: number]: number }, offset: number): bigint {
  let value = BigInt(0);
  for (let i = 7; i >= 0; i--) value = (value << BigInt(8)) | BigInt(data[offset + i]);
  return value;
}

export function inspectSolanaTransaction(bytes: Uint8Array): InspectedTransaction {
  const transaction = getTransactionDecoder().decode(bytes);
  const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  const keys = compiled.staticAccounts.map(String);
  const operations: DecodedOperation[] = [];
  const unknown: string[] = [];
  for (const instruction of compiled.instructions) {
    const program = keys[instruction.programAddressIndex];
    const accounts = (instruction.accountIndices ?? []).map((index) => keys[index]);
    const data = instruction.data ?? new Uint8Array();
    if (program === String(SYSTEM_PROGRAM_ADDRESS) && data.length === 12 && data[0] === 2 && data[1] === 0 && data[2] === 0 && data[3] === 0 && accounts.length === 2) {
      operations.push({ type: "transfer-sol", source: accounts[0], destination: accounts[1], lamports: readU64(data, 4) });
    } else if ((program === TOKEN_PROGRAM_ADDRESS || program === TOKEN_2022_PROGRAM_ADDRESS) && data.length === 10 && data[0] === 12 && accounts.length === 4) {
      operations.push({ type: "transfer-checked", source: accounts[0], mint: accounts[1], destination: accounts[2], authority: accounts[3], amount: readU64(data, 1), decimals: data[9], program });
    } else if (program === "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" && data.length === 1 && data[0] === 1 && accounts.length === 6) {
      operations.push({ type: "create-token-account", payer: accounts[0], account: accounts[1], owner: accounts[2], mint: accounts[3], program: accounts[5] });
    } else {
      unknown.push(program);
    }
  }
  return { feePayer: keys[0], requiredSignatures: compiled.header.numSignerAccounts, operations, unknown };
}

/** True only when the serialized bytes contain exactly the operations the build intended and nothing else. */
export function assertBuiltMatches(built: BuiltSolanaSend): InspectedTransaction {
  const inspected = inspectSolanaTransaction(built.transaction);
  const fail = () => { throw new SolanaSendError("unexpected_transaction"); };
  if (inspected.unknown.length > 0 || inspected.feePayer !== built.from || inspected.requiredSignatures !== 1) fail();
  const ops = inspected.operations;
  if (built.kind === "sol") {
    const op = ops[0];
    if (ops.length !== 1 || op?.type !== "transfer-sol" || op.source !== built.from || op.destination !== built.to || op.lamports !== built.amount) fail();
  } else {
    const transfer = ops[ops.length - 1];
    const expectedLength = built.createRecipientAccount ? 2 : 1;
    if (ops.length !== expectedLength || transfer?.type !== "transfer-checked") fail();
    if (transfer!.type === "transfer-checked" && (transfer!.source !== built.sourceAccount || transfer!.destination !== built.recipientAccount
      || transfer!.mint !== built.mint || transfer!.amount !== built.amount || transfer!.decimals !== built.decimals || transfer!.authority !== built.from)) fail();
    if (built.createRecipientAccount) {
      const create = ops[0];
      if (create?.type !== "create-token-account" || create.payer !== built.from || create.account !== built.recipientAccount || create.owner !== built.to || create.mint !== built.mint) fail();
    }
  }
  return inspected;
}

/* ---- Amount text ------------------------------------------------------------------------------------------- */

export function parseTokenAmount(text: string, decimals: number): bigint | null {
  const match = /^(\d{1,20})(?:\.(\d{1,36}))?$/.exec(text.trim());
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  const raw = BigInt(match[1]) * BigInt(10) ** BigInt(decimals) + BigInt((fraction || "0").padEnd(decimals, "0") || "0");
  return raw > BigInt(0) && raw < BigInt(1) << BigInt(64) ? raw : null;
}

export function formatTokenAmount(raw: bigint, decimals: number): string {
  if (decimals === 0) return raw.toString();
  const padded = raw.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** Transfer-fee estimate for Token-2022 mints: what the recipient receives. Rounds up like the program, capped at maximumFee. */
export function transferFeeFor(amount: bigint, fee: { basisPoints: number; maximumFee: string } | null): bigint {
  if (!fee || fee.basisPoints <= 0) return BigInt(0);
  const raw = (amount * BigInt(fee.basisPoints) + BigInt(9999)) / BigInt(10000);
  const cap = BigInt(fee.maximumFee || "0");
  return raw > cap ? cap : raw;
}
