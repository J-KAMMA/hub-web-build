// GohoToken ゲートの購入リクエスト組み立て。ここは署名も送信もしない。
// 返すのは approve（必要額ちょうど）と、GohoToken V3 の buyWithTaxQuote の2件だけ。税見積が無い購入は作らない。
// 金額はすべて bigint。チェーンは Avalanche(43114) 以外は拒否（fail closed）。
// 決済トークンは固定しない。販売 API が返す paymentToken / paymentDecimals / paymentSymbol を使う。

import { encodeFunctionData, getAddress, isAddress } from "viem";
import type { ValidatedTaxQuote } from "./tax-quote";
import {
  AVALANCHE_CHAIN_ID,
  ERC20_APPROVE_ABI,
  VENDING_V3_BUY_WITH_TAX_QUOTE_ABI,
  ZERO_ADDRESS,
} from "./vending";

const MAX_UINT256 = (1n << 256n) - 1n;

export type PurchaseGate = {
  chainId: number;
  saleAddress: string;
  /** 必要保有量（トークンの最小単位）。 */
  requiredBalance: bigint;
};

export type PurchaseQuote = {
  /** 買うトークン量（最小単位）。 */
  tokenAmount: bigint;
  /** 決済トークン（販売 API の値）。ゼロアドレスは拒否。 */
  paymentToken: string;
  /** 確認画面に出す記号（販売 API の値。無ければ短縮アドレス）。 */
  paymentSymbol?: string;
  /** 決済トークンの桁数（販売 API の値）。 */
  paymentDecimals: number;
  /** 内税込みで支払う総額（決済トークンの最小単位）。approve と maxPayment もこの額ちょうど。 */
  totalPayment: bigint;
  /** 検証済みの署名済み税見積（V3 の購入に必須）。 */
  taxQuote: ValidatedTaxQuote;
};

export type PurchaseRequest = {
  kind: "approve" | "buyWithTaxQuote";
  to: `0x${string}`;
  data: `0x${string}`;
  value: "0x0";
  chainId: number;
};

export type PurchaseRequests = {
  approve: PurchaseRequest;
  /** buyWithTaxQuote。 */
  buy: PurchaseRequest;
  spender: `0x${string}`;
  paymentToken: `0x${string}`;
  paymentLabel: string;
  paymentDecimals: number;
  tokenAmount: bigint;
  totalPayment: bigint;
  /** 内税の額。 */
  taxAmount: bigint;
};

export class PurchaseError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "PurchaseError";
  }
}

function fail(code: string): never {
  throw new PurchaseError(code);
}

function address(value: string, code: string): `0x${string}` {
  if (typeof value !== "string" || !isAddress(value, { strict: false })) fail(code);
  return getAddress(value.toLowerCase());
}

/** 販売 API の記号は表示ラベルにだけ使う。安全な形でなければ短縮アドレスにする。 */
export function paymentTokenLabel(symbol: string | undefined, token: string): string {
  if (typeof symbol === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,11}$/.test(symbol) && !/^(UNKNOWN|NATIVE)$/i.test(symbol)) {
    return symbol;
  }
  return isAddress(token, { strict: false }) ? `${token.slice(0, 6)}...${token.slice(-4)}` : "決済トークン";
}

export function buildPurchaseRequests(gate: PurchaseGate, quote: PurchaseQuote): PurchaseRequests {
  if (gate.chainId !== AVALANCHE_CHAIN_ID) fail("unsupported_chain");
  const spender = address(gate.saleAddress, "invalid_sale_address");
  const paymentToken = address(quote.paymentToken, "invalid_payment_token");
  if (paymentToken === getAddress(ZERO_ADDRESS)) fail("invalid_payment_token");
  if (!Number.isInteger(quote.paymentDecimals) || quote.paymentDecimals < 0 || quote.paymentDecimals > 36) {
    fail("invalid_payment_decimals");
  }

  for (const amount of [gate.requiredBalance, quote.tokenAmount, quote.totalPayment]) {
    if (typeof amount !== "bigint") fail("amount_must_be_bigint");
  }
  if (gate.requiredBalance <= 0n) fail("invalid_required_balance");
  if (quote.tokenAmount < gate.requiredBalance) fail("quote_below_required_balance");
  if (quote.totalPayment <= 0n) fail("invalid_total_payment");
  // 無制限 approve は作らない。
  if (quote.totalPayment >= MAX_UINT256 || quote.tokenAmount >= MAX_UINT256) fail("unlimited_amount_rejected");

  const approveData = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: "approve",
    args: [spender, quote.totalPayment],
  });

  const tax = quote.taxQuote;
  if (!tax) fail("tax_quote_missing");
  if (tax.quote.tokenAmount !== quote.tokenAmount) fail("tax_quote_token_amount_mismatch");
  if (tax.totalPayment !== quote.totalPayment) fail("tax_quote_total_mismatch");
  const data = encodeFunctionData({
    abi: VENDING_V3_BUY_WITH_TAX_QUOTE_ABI,
    functionName: "buyWithTaxQuote",
    // maxPayment は見積の総額ちょうど。紹介者は付けない。
    args: [tax.quote, tax.signature, tax.totalPayment, ZERO_ADDRESS],
  });
  const buyRequest: PurchaseRequest = { kind: "buyWithTaxQuote", to: spender, data, value: "0x0", chainId: AVALANCHE_CHAIN_ID };

  return Object.freeze({
    approve: Object.freeze({ kind: "approve" as const, to: paymentToken, data: approveData, value: "0x0" as const, chainId: AVALANCHE_CHAIN_ID }),
    buy: Object.freeze(buyRequest),
    spender,
    paymentToken,
    paymentLabel: paymentTokenLabel(quote.paymentSymbol, paymentToken),
    paymentDecimals: quote.paymentDecimals,
    tokenAmount: quote.tokenAmount,
    totalPayment: quote.totalPayment,
    taxAmount: tax.quote.taxAmount,
  });
}

/** 10進文字列（"1.5"）を最小単位へ。浮動小数は使わない。 */
export function parseDecimalToAtomic(value: string, decimals: number): bigint | null {
  if (typeof value !== "string" || !/^\d+(\.\d+)?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(".");
  if (fraction.length > decimals) return null;
  return BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
}

/** 最小単位を表示用の10進文字列へ（末尾の0は落とす）。 */
export function formatAtomic(amount: bigint, decimals: number): string {
  const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""}`;
}
