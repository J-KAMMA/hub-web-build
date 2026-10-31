// 購入前の確認から、署名・送信前の購入リクエスト組み立てまで（ネットワークの書き込みは API 経由のみ）。
// 流れ: 読み取りの見積 → 購入確認 API（署名）→（非同期なら承認待ち）→ V3 税見積（EIP-712）の検証 →
// approve / buyWithTaxQuote の組み立て。税見積が無い・V3 でない場合は買わない。どこかで想定外があれば blocked / unavailable で閉じる。

import { decodeEventLog, decodeFunctionResult, encodeFunctionData, getAddress, toEventSelector } from "viem";

import type { ApiResult, GohoTokenPurchaseApi, SaleInfo, SaleRef, SellerInfo, WalletSigner } from "./api";
import { buildPurchaseRequests, paymentTokenLabel, PurchaseError, type PurchaseRequests } from "./purchase";
import { TaxQuoteError, validateTaxQuoteAuthorization, type ValidatedTaxQuote } from "./tax-quote";
import {
  AVALANCHE_CHAIN_ID,
  GOHOTOKEN_V3_FACTORY_AVALANCHE,
  KNOWN_PAYMENT_TOKENS_AVALANCHE,
  PURCHASED_EVENT_ABI,
  VENDING_V3_SALE_VIEW_ABI,
  ZERO_ADDRESS,
} from "./vending";

export const PAYMENT_TIMING_TEXT =
  "購入取引がチェーン上で成功した時点で支払いが実行されます。利用許可（approve）だけでは購入代金は支払われません。";
export const DELIVERY_TIMING_TEXT =
  "購入に使用したチェーン上でトランザクションが確認され、トークンの発行が完了するとウォレット残高に反映されます。";

const APPROVAL_MAX_WAIT_MS = 120_000;

export type PrepareResult =
  | { status: "ready"; requests: PurchaseRequests; intentId: string; taxQuote: ValidatedTaxQuote; taxQuoteDeadline: bigint }
  | { status: "blocked"; reason: string }
  | { status: "unavailable"; reason?: string };

export type PrepareParams = {
  api: GohoTokenPurchaseApi;
  signer: WalletSigner;
  sale: SaleRef;
  saleInfo: SaleInfo;
  seller: SellerInfo;
  requiredAtomic: bigint;
  residenceCountryCode: string;
  /** 購入に使うウォレットと同じ読み取り経路の eth_call（新しい provider や秘密は使わない）。 */
  ethCall: (to: `0x${string}`, data: `0x${string}`) => Promise<string>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function paymentMethodText(saleInfo: SaleInfo): string {
  const known = KNOWN_PAYMENT_TOKENS_AVALANCHE[saleInfo.paymentToken.toLowerCase()];
  const currency = known?.accountingCurrency ?? paymentTokenLabel(saleInfo.paymentSymbol, saleInfo.paymentToken);
  return `${currency} on Avalanche`;
}

export type SaleChainState = { platformTaxRecipient: `0x${string}`; taxPolicyEpoch: bigint };

/**
 * 販売コントラクトの saleView() を読み、工場・決済トークンが API の値と一致することを確かめて、税政策を返す。
 * 読めない・形が違う・一致しないときは null（呼び出し側は閉じる）。
 */
export async function readSaleChainState(
  ethCall: PrepareParams["ethCall"],
  saleInfo: Pick<SaleInfo, "saleAddress" | "paymentToken" | "tokenAddress">,
): Promise<SaleChainState | null> {
  try {
    const to = getAddress(saleInfo.saleAddress.toLowerCase());
    const raw = await ethCall(to, encodeFunctionData({ abi: VENDING_V3_SALE_VIEW_ABI, functionName: "saleView" }));
    if (typeof raw !== "string" || !/^0x[0-9a-fA-F]+$/.test(raw)) return null;
    const view = decodeFunctionResult({ abi: VENDING_V3_SALE_VIEW_ABI, functionName: "saleView", data: raw as `0x${string}` });
    if (view.factory.toLowerCase() !== GOHOTOKEN_V3_FACTORY_AVALANCHE.toLowerCase()) return null;
    if (view.paymentToken.toLowerCase() !== saleInfo.paymentToken.toLowerCase()) return null;
    if (view.token.toLowerCase() !== saleInfo.tokenAddress.toLowerCase()) return null;
    if (view.taxPolicyEpoch <= 0n) return null;
    return { platformTaxRecipient: view.platformTaxRecipient, taxPolicyEpoch: view.taxPolicyEpoch };
  } catch {
    return null;
  }
}

function okValue<T>(result: ApiResult<T>): T | null {
  return result.status === "ok" ? result.value : null;
}

export async function prepareGohoPurchase(params: PrepareParams): Promise<PrepareResult> {
  const { api, signer, sale, saleInfo, seller, requiredAtomic } = params;
  const now = params.now ?? Date.now;
  const sleep = params.sleep ?? defaultSleep;
  if (sale.chainId !== AVALANCHE_CHAIN_ID || saleInfo.chainId !== AVALANCHE_CHAIN_ID) return { status: "blocked", reason: "unsupported_chain" };
  if (getAddress(saleInfo.saleAddress) !== getAddress(sale.saleAddress.toLowerCase())) return { status: "blocked", reason: "sale_mismatch" };

  // 見積は購入の直前に取り直す（古い見積を使わない）。
  const quote = okValue(await api.getBuyQuote(sale, requiredAtomic, signer.address));
  if (!quote) return { status: "unavailable", reason: "quote_unavailable" };

  const request = (taxQuoteApprovalToken?: string) =>
    api.checkEligibility(signer, {
      buyerWallet: signer.address,
      sale,
      residenceCountryCode: params.residenceCountryCode,
      termsAcceptedAt: new Date(now()).toISOString(),
      tokenAmount: requiredAtomic,
      quote,
      paymentMethod: paymentMethodText(saleInfo),
      paymentTiming: seller.paymentTiming ?? PAYMENT_TIMING_TEXT,
      deliveryTiming: seller.deliveryTiming ?? DELIVERY_TIMING_TEXT,
      applicationDeadline: saleInfo.buyEnd !== undefined && saleInfo.buyEnd > 0 ? new Date(saleInfo.buyEnd * 1000).toISOString() : "none",
      legal: seller.legal,
      taxQuoteApprovalToken,
    });

  let eligibility = okValue(await request());
  if (!eligibility) return { status: "unavailable", reason: "eligibility_unavailable" };

  // 税見積の署名が非同期のとき: 承認されるまで状態を問い合わせ、承認の合図を付けてもう一度確認する。
  if (eligibility.taxQuoteApproval) {
    const approval = eligibility.taxQuoteApproval;
    const deadline = Math.min(Date.parse(approval.expiresAt) || 0, now() + APPROVAL_MAX_WAIT_MS);
    let wait = approval.pollAfterMs;
    let approved = false;
    while (now() + wait <= deadline) {
      await sleep(wait);
      const status = okValue(await api.getApprovalStatus(approval.statusToken));
      if (!status) return { status: "unavailable", reason: "approval_unavailable" };
      if (status.status === "approved") {
        approved = true;
        break;
      }
      if (status.status !== "pending") return { status: "blocked", reason: `tax_quote_approval_${status.status}` };
      wait = status.pollAfterMs ?? wait;
    }
    if (!approved) return { status: "blocked", reason: "tax_quote_approval_timeout" };
    eligibility = okValue(await request(approval.statusToken));
    if (!eligibility) return { status: "unavailable", reason: "eligibility_unavailable" };
    if (eligibility.taxQuoteApproval) return { status: "blocked", reason: "tax_quote_approval_loop" };
  }

  // 税政策はチェーン上の値と突き合わせる。読めなければ閉じる。
  const chainState = eligibility.allowed ? await readSaleChainState(params.ethCall, saleInfo) : null;
  if (eligibility.allowed && !chainState) return { status: "unavailable", reason: "sale_state_unavailable" };

  if (!eligibility.allowed) return { status: "blocked", reason: eligibility.reason || "not_allowed" };
  if (!eligibility.intentId) return { status: "unavailable", reason: "eligibility_intent_missing" };

  try {
    // V3 の購入は署名済み税見積が必須。無ければ買わない。
    if (eligibility.taxQuoteAuthorization === undefined || eligibility.taxQuoteAuthorization === null) {
      return { status: "blocked", reason: "tax_quote_missing" };
    }
    const taxQuote = validateTaxQuoteAuthorization(eligibility.taxQuoteAuthorization, {
      chainId: AVALANCHE_CHAIN_ID,
      saleAddress: saleInfo.saleAddress,
      soldTokenAddress: saleInfo.tokenAddress,
      buyer: signer.address,
      tokenAmount: requiredAtomic,
      baseCost: quote.paymentAmount,
      breakdown: quote.breakdown,
      taxPolicyEpoch: chainState!.taxPolicyEpoch,
      platformTaxRecipient: chainState!.platformTaxRecipient,
      now: BigInt(Math.floor(now() / 1000)),
    });
    const requests = buildPurchaseRequests(
      { chainId: sale.chainId, saleAddress: sale.saleAddress, requiredBalance: requiredAtomic },
      {
        tokenAmount: requiredAtomic,
        paymentToken: saleInfo.paymentToken,
        paymentSymbol: saleInfo.paymentSymbol,
        paymentDecimals: saleInfo.paymentDecimals,
        totalPayment: taxQuote.totalPayment,
        taxQuote,
      },
    );
    return {
      status: "ready",
      requests,
      intentId: eligibility.intentId,
      taxQuote,
      taxQuoteDeadline: taxQuote.quote.deadline,
    };
  } catch (error) {
    if (error instanceof TaxQuoteError || error instanceof PurchaseError) return { status: "blocked", reason: error.code };
    return { status: "blocked", reason: "purchase_build_failed" };
  }
}

type ReceiptLog = { address?: string; topics?: string[]; data?: string; logIndex?: string | number };

/**
 * 受領書から Purchased をちょうど1件探し、検証済みの税見積と一致することを確かめて log index を返す。
 * 見つからない・複数・購入者違い・紹介者あり・見積の digest / 金額 / 政策 / 税区分の不一致・読めない形は null。
 * （サーバー側の確定は GohoToken の purchase-confirmations が行う。ここは記録を送る前の自己確認。）
 */
export function decodePurchasedLog(log: ReceiptLog) {
  try {
    if (!Array.isArray(log.topics) || log.topics.length === 0) return null;
    return decodeEventLog({
      abi: PURCHASED_EVENT_ABI,
      data: (log.data ?? "0x") as `0x${string}`,
      topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
    }).args;
  } catch {
    return null;
  }
}

export function findPurchasedLogIndex(
  receipt: { logs?: ReceiptLog[] },
  saleAddress: string,
  buyer: string,
  expected: ValidatedTaxQuote,
): number | null {
  const selector = toEventSelector(PURCHASED_EVENT_ABI[0]).toLowerCase();
  const matches = (receipt.logs ?? []).filter(
    (log) =>
      typeof log.address === "string" &&
      log.address.toLowerCase() === saleAddress.toLowerCase() &&
      Array.isArray(log.topics) &&
      log.topics[0]?.toLowerCase() === selector,
  );
  if (matches.length !== 1) return null;
  const log = matches[0]!;
  try {
    const args = decodePurchasedLog(log);
    if (!args) return null;
    if (args.buyer.toLowerCase() !== buyer.toLowerCase()) return null;
    // Hub の購入は紹介者ゼロ。紹介者があると affiliateFee が第三者へ回るため、Hub の購入の証拠とは認めない。
    if (args.referrer.toLowerCase() !== ZERO_ADDRESS) return null;
    if (args.quoteDigest.toLowerCase() !== expected.digest.toLowerCase()) return null;
    if (args.tokenAmount !== expected.quote.tokenAmount) return null;
    if (args.grossCost !== expected.quote.baseCost) return null;
    if (args.taxAmount !== expected.quote.taxAmount) return null;
    if (args.policyId.toLowerCase() !== expected.quote.policyId.toLowerCase()) return null;
    if (Number(args.taxMode) !== (expected.quote.platformRemits ? 2 : 1)) return null;
    const index = typeof log.logIndex === "number" ? log.logIndex : Number(BigInt(String(log.logIndex)));
    return Number.isInteger(index) && index >= 0 ? index : null;
  } catch {
    return null;
  }
}
