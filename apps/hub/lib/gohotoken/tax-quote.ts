// GohoToken V3 の署名済み税見積（EIP-712, scheme "gohotoken-v3-eip712"）の検証。参照実装（読み取り専用）:
//   .codex-work/gohotoken-latest-network-console/frontend/src/hooks/useQuote.ts
//   validateTaxQuoteAuthorization / calculateTaxQuoteBreakdownHash / calculateTaxQuoteV3Digest
// 受け取った見積は、接続中のウォレット・販売・数量・基準額・内訳・税政策に一致しなければ使わない（fail closed）。
// ダイジェストは API の値を信用せず、検証した各値から組み直して照合する。

import { encodeAbiParameters, getAddress, hashTypedData, isAddress, isHex, keccak256 } from "viem";
import { z } from "zod";

import {
  TAX_QUOTE_SCHEME_V3,
  TAX_QUOTE_V3_DOMAIN_NAME,
  TAX_QUOTE_V3_DOMAIN_VERSION,
  TAX_QUOTE_V3_PRIMARY_TYPE,
  TAX_QUOTE_V3_TYPES,
  ZERO_ADDRESS,
} from "./vending";

export class TaxQuoteError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "TaxQuoteError";
  }
}

function fail(code: string): never {
  throw new TaxQuoteError(code);
}

const uint = z.string().regex(/^\d{1,78}$/);
const bytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const hexBytes = z.string().regex(/^0x(?:[0-9a-fA-F]{2})+$/);
const addressText = z.string().refine((value) => isAddress(value, { strict: false }));

/** 購入確認 API が返す taxQuoteAuthorization の形（V3）。 */
export const taxQuoteAuthorizationSchema = z.object({
  scheme: z.string().optional(),
  quote: z.object({
    chainId: uint,
    sale: addressText,
    buyer: addressText,
    tokenAmount: uint,
    baseCost: uint,
    breakdownHash: bytes32,
    taxAmount: uint,
    policyId: bytes32,
    platformRemits: z.boolean(),
    policyEpoch: uint,
    deadline: uint,
  }),
  signature: hexBytes,
  digest: bytes32,
  referrer: addressText,
  totalPayment: uint,
  taxRecipient: addressText.optional(),
  /** あれば digest との突き合わせにだけ使う（digest は常に自分で組み直す）。 */
  typedData: z
    .object({
      domain: z.record(z.string(), z.unknown()),
      message: z.record(z.string(), z.unknown()),
      primaryType: z.string().optional(),
    })
    .optional(),
});
export type TaxQuoteAuthorization = z.infer<typeof taxQuoteAuthorizationSchema>;

/** 読み取り専用の見積 API が返す内訳（最小単位）。 */
export type PaymentBreakdown = {
  refundReserveDeposit: bigint;
  protocolFeeGross: bigint;
  affiliateFeeGross: bigint;
  creatorNetAmount: bigint;
};

export type ValidatedTaxQuote = {
  quote: {
    tokenAmount: bigint;
    baseCost: bigint;
    breakdownHash: `0x${string}`;
    taxAmount: bigint;
    policyId: `0x${string}`;
    platformRemits: boolean;
    deadline: bigint;
  };
  signature: `0x${string}`;
  digest: `0x${string}`;
  totalPayment: bigint;
  taxRecipient: `0x${string}`;
};

export type TaxQuoteExpectation = {
  chainId: number;
  saleAddress: string;
  soldTokenAddress: string;
  buyer: string;
  tokenAmount: bigint;
  baseCost: bigint;
  breakdown: PaymentBreakdown;
  /** チェーン上の saleView().taxPolicyEpoch。見積の policyEpoch と一致が必須。 */
  taxPolicyEpoch: bigint;
  /** チェーン上の saleView().platformTaxRecipient。platformRemits の見積の受取先と一致が必須。 */
  platformTaxRecipient: string;
  /** epoch 秒。省略時は現在時刻。 */
  now?: bigint;
};

export function calculateBreakdownHash(breakdown: PaymentBreakdown): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }],
      [breakdown.refundReserveDeposit, breakdown.protocolFeeGross, breakdown.affiliateFeeGross, breakdown.creatorNetAmount],
    ),
  );
}

export type TaxQuoteDigestInput = {
  chainId: bigint;
  sale: string;
  buyer: string;
  referrer: string;
  tokenAmount: bigint;
  baseCost: bigint;
  breakdownHash: `0x${string}`;
  taxAmount: bigint;
  policyId: `0x${string}`;
  platformRemits: boolean;
  recipient: string;
  policyEpoch: bigint;
  deadline: bigint;
};

/** EIP-712: domain {name "GohoToken", version "3", chainId, verifyingContract = 販売}、primaryType GohoTokenTaxQuoteV3。 */
export function calculateTaxQuoteDigest(input: TaxQuoteDigestInput): `0x${string}` {
  return hashTypedData({
    domain: {
      name: TAX_QUOTE_V3_DOMAIN_NAME,
      version: TAX_QUOTE_V3_DOMAIN_VERSION,
      chainId: input.chainId,
      verifyingContract: getAddress(input.sale.toLowerCase()),
    },
    types: TAX_QUOTE_V3_TYPES,
    primaryType: TAX_QUOTE_V3_PRIMARY_TYPE,
    message: {
      buyer: getAddress(input.buyer.toLowerCase()),
      referrer: getAddress(input.referrer.toLowerCase()),
      tokenAmount: input.tokenAmount,
      baseCost: input.baseCost,
      breakdownHash: input.breakdownHash,
      taxAmount: input.taxAmount,
      policyId: input.policyId,
      platformRemits: input.platformRemits,
      recipient: getAddress(input.recipient.toLowerCase()),
      policyEpoch: input.policyEpoch,
      deadline: input.deadline,
    },
  });
}

const sameAddress = (a: string, b: string) => getAddress(a.toLowerCase()) === getAddress(b.toLowerCase());

/**
 * 形の検証と、購入の文脈（ウォレット・販売・数量・基準額・内訳・税政策）への一致を確かめる。
 * 紹介者は常に無し（ゼロアドレス）。scheme が V3 以外、期限切れ、総額が基準額と違う場合などは TaxQuoteError。
 */
export function validateTaxQuoteAuthorization(raw: unknown, expected: TaxQuoteExpectation): ValidatedTaxQuote {
  const parsed = taxQuoteAuthorizationSchema.safeParse(raw);
  if (!parsed.success) fail("tax_quote_shape_invalid");
  const authorization = parsed.data;
  if (authorization.scheme !== TAX_QUOTE_SCHEME_V3) fail("tax_quote_scheme_unsupported");
  const quote = authorization.quote;
  const chainId = BigInt(quote.chainId);
  const tokenAmount = BigInt(quote.tokenAmount);
  const baseCost = BigInt(quote.baseCost);
  const taxAmount = BigInt(quote.taxAmount);
  const policyEpoch = BigInt(quote.policyEpoch);
  const deadline = BigInt(quote.deadline);
  const totalPayment = BigInt(authorization.totalPayment);
  const now = expected.now ?? BigInt(Math.floor(Date.now() / 1000));

  if (chainId !== BigInt(expected.chainId)) fail("tax_quote_wrong_chain");
  if (!sameAddress(quote.sale, expected.saleAddress)) fail("tax_quote_wrong_sale");
  if (!sameAddress(quote.buyer, expected.buyer)) fail("tax_quote_wrong_buyer");
  if (!sameAddress(authorization.referrer, ZERO_ADDRESS)) fail("tax_quote_wrong_referrer");
  if (tokenAmount !== expected.tokenAmount) fail("tax_quote_wrong_token_amount");
  if (baseCost !== expected.baseCost) fail("tax_quote_base_cost_changed");
  const breakdownHash = calculateBreakdownHash(expected.breakdown);
  if (quote.breakdownHash.toLowerCase() !== breakdownHash.toLowerCase()) fail("tax_quote_breakdown_changed");
  // maxPayment（= 総額）は基準額ちょうど。税は内税で、総額に上乗せされない。
  if (taxAmount > baseCost || totalPayment !== baseCost) fail("tax_quote_total_invalid");
  if (policyEpoch <= 0n) fail("tax_quote_policy_epoch_invalid");
  if (policyEpoch !== expected.taxPolicyEpoch) fail("tax_quote_policy_changed");
  if (/^0x0+$/.test(quote.policyId)) fail("tax_quote_policy_unknown");
  if (deadline <= now + 15n) fail("tax_quote_expired");
  if (!isHex(authorization.signature) || authorization.signature.length <= 2) fail("tax_quote_signature_invalid");
  if (!authorization.taxRecipient) fail("tax_quote_recipient_missing");
  const taxRecipient = getAddress(authorization.taxRecipient.toLowerCase());
  const forbidden = [ZERO_ADDRESS, expected.saleAddress, expected.soldTokenAddress].map((value) => value.toLowerCase());
  if (quote.platformRemits ? forbidden.includes(taxRecipient.toLowerCase()) : taxRecipient !== getAddress(ZERO_ADDRESS)) {
    fail("tax_quote_recipient_invalid");
  }
  if (
    quote.platformRemits &&
    taxRecipient.toLowerCase() !== expected.platformTaxRecipient.toLowerCase()
  ) {
    fail("tax_quote_recipient_policy_mismatch");
  }
  const digestInput: TaxQuoteDigestInput = {
    chainId,
    sale: quote.sale,
    buyer: quote.buyer,
    referrer: authorization.referrer,
    tokenAmount,
    baseCost,
    breakdownHash,
    taxAmount,
    policyId: quote.policyId as `0x${string}`,
    platformRemits: quote.platformRemits,
    recipient: taxRecipient,
    policyEpoch,
    deadline,
  };
  const expectedDigest = calculateTaxQuoteDigest(digestInput);
  if (expectedDigest.toLowerCase() !== authorization.digest.toLowerCase()) fail("tax_quote_digest_mismatch");

  // API の typedData は突き合わせだけ。組み直した digest と食い違えば使わない。
  if (authorization.typedData) {
    const { domain, message, primaryType } = authorization.typedData;
    try {
      if (primaryType !== undefined && primaryType !== TAX_QUOTE_V3_PRIMARY_TYPE) fail("tax_quote_typed_data_mismatch");
      if (domain.name !== TAX_QUOTE_V3_DOMAIN_NAME || domain.version !== TAX_QUOTE_V3_DOMAIN_VERSION) {
        fail("tax_quote_typed_data_mismatch");
      }
      if (BigInt(String(domain.chainId)) !== chainId) fail("tax_quote_typed_data_mismatch");
      const fromApi = calculateTaxQuoteDigest({
        chainId,
        sale: String(domain.verifyingContract),
        buyer: String(message.buyer),
        referrer: String(message.referrer),
        tokenAmount: BigInt(String(message.tokenAmount)),
        baseCost: BigInt(String(message.baseCost)),
        breakdownHash: String(message.breakdownHash) as `0x${string}`,
        taxAmount: BigInt(String(message.taxAmount)),
        policyId: String(message.policyId) as `0x${string}`,
        platformRemits: message.platformRemits === true,
        recipient: String(message.recipient),
        policyEpoch: BigInt(String(message.policyEpoch)),
        deadline: BigInt(String(message.deadline)),
      });
      if (fromApi.toLowerCase() !== expectedDigest.toLowerCase()) fail("tax_quote_typed_data_mismatch");
    } catch (error) {
      if (error instanceof TaxQuoteError) throw error;
      fail("tax_quote_typed_data_mismatch");
    }
  }

  return {
    quote: {
      tokenAmount,
      baseCost,
      breakdownHash,
      taxAmount,
      policyId: quote.policyId as `0x${string}`,
      platformRemits: quote.platformRemits,
      deadline,
    },
    signature: authorization.signature as `0x${string}`,
    digest: authorization.digest as `0x${string}`,
    totalPayment,
    taxRecipient,
  };
}
