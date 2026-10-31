// GohoToken 購入系 API のクライアント（2026-10-13 公開分。docs/hub-gohotoken-purchase/handoff.md「GohoToken 側の API」）。
//
// - 呼び先は https://gohotoken.com/api/... だけ。api.gohotoken.com は呼ばない（国の判定の印は gohotoken.com の
//   Worker が付ける。直接だと国が無く購入は閉じる）。
// - cookie は使わない（credentials: "omit"）。書き込みは毎回ウォレット署名: 使い捨て番号を取り、
//   personal_sign で署名し、x-goho-* 見出しを付けて送る。
// - どの呼び出しも、失敗・想定外の形は { status: "unavailable" } に畳む（利用側は「準備中」へ閉じる）。
//   ただし購入確認 API の 403 の { allowed: false, reason } は「許可されない」という正規の答えとして返す。
// 署名文面の出典（読み取り専用）:
//   frontend/src/services/gohoApi.ts createSignedHeaders / api/src/auth.js buildSigningMessage

import { getAddress, isAddress } from "viem";
import { z } from "zod";

import { AVALANCHE_CHAIN_ID, GOHOTOKEN_V3_FACTORY_AVALANCHE } from "./vending";

export const GOHOTOKEN_API_ORIGIN = "https://gohotoken.com";
/** 購入確認 API が照合するサイト規約の版。販売者のテンプレート ID を入れると全件止まる（10/12に確認済み）。 */
export const SITE_TERMS_VERSION = "gohotoken-site-terms-v5";
/** サイト規約は固定のURL。売り手の termsUrl や販売のURLで代用しない。 */
export const SITE_TERMS_URL = "https://gohotoken.com/terms";
export const PRIVACY_POLICY_VERSION = "gohotoken-privacy-v3";
export const JURISDICTION_POLICY_VERSION = "2026-08-15.global-residence-v1";
/** API が固定境界の目印として要求する値（人間向けの文章ではない）。 */
export const PURCHASE_CANCELLATION_REFUND_TERMS = "gohotoken_no_purchase_cancellation_or_refund_v1";

const REQUEST_TIMEOUT_MS = 12_000;

export type Unavailable = { status: "unavailable"; reason?: string };
export type ApiResult<T> = { status: "ok"; value: T } | Unavailable;

export type SaleRef = { chainId: number; saleAddress: string };

/** ウォレット署名者。signMessage は personal_sign（EIP-191）。 */
export type WalletSigner = {
  address: string;
  signMessage(message: string): Promise<string>;
};

// ---------- 応答の形 ----------

const addressText = z.string().refine((value) => isAddress(value, { strict: false }));
const uintText = z.string().regex(/^\d{1,78}$/);
const intLike = z.preprocess((value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value), z.number().int());

const saleSchema = z.object({
  chainId: intLike,
  saleAddress: addressText,
  tokenAddress: addressText,
  creatorWallet: addressText,
  visibilityStatus: z.literal("public"),
  publicListingEligible: z.literal(true),
  onchainAttestationStatus: z.literal("verified"),
  paymentToken: addressText,
  paymentDecimals: intLike.pipe(z.number().min(0).max(36)),
  paymentSymbol: z.string().max(32).optional(),
  tokenName: z.string().max(100).optional(),
  tokenSymbol: z.string().max(32).optional(),
  taxDisplayMode: z.string().max(64).optional(),
  /** 購入受付の終了時刻（epoch 秒）。0 または無しは期限なし。 */
  buyEnd: intLike.pipe(z.number().min(0)).optional(),
  /** 版の見分け。V3 の工場の住所と一致する販売だけ買える（2026-10-15）。 */
  contractVersion: z.string().max(16).optional(),
  factoryAddress: addressText.optional(),
});

const nonEmpty = z.string().trim().min(1).max(2000);
const sellerSchema = z.object({
  sellerInfoReady: z.literal(true),
  legalDisplayStatus: z.literal("ready"),
  creatorWallet: addressText.optional(),
  sellerDisplayName: nonEmpty,
  legalSellerName: nonEmpty.optional(),
  legalAddress: nonEmpty.optional(),
  contactEmail: nonEmpty.optional(),
  inquiryUrl: nonEmpty.optional(),
  contactMethod: nonEmpty.optional(),
  paymentTiming: nonEmpty.optional(),
  deliveryTimingText: nonEmpty.optional(),
  deliveryOrRightsTransferTiming: nonEmpty.optional(),
  refundPolicyText: nonEmpty.optional(),
  legalDisplayVersion: nonEmpty,
  legalTermsTemplateId: nonEmpty,
  legalDisplaySnapshotHash: nonEmpty,
  confirmationTextVersion: nonEmpty,
  sellerLegalProfileRef: nonEmpty.optional(),
  legalProfileReferenceId: nonEmpty.optional(),
});

const marketScopeSchema = z.object({
  schemaVersion: z.literal("gohotoken_purchase_market_scope_v1"),
  ready: z.literal(true),
  buyerCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).nullable().optional(),
  notSellableNowCountries: z.array(z.string().regex(/^[A-Z]{2}$/)).optional(),
});

const buyQuoteSchema = z.object({
  chainId: intLike,
  saleAddress: addressText,
  rawAmount: uintText,
  paymentAmount: uintText,
  source: z.literal("read_only_rpc_eth_call"),
  quoteBuyBreakdown: z.object({
    creatorNetAmount: uintText,
    protocolFeeGross: uintText,
    affiliateFeeGross: uintText,
    refundReserveDeposit: uintText,
  }),
});

const residenceSchema = z.object({
  countryCode: z.string().regex(/^[A-Z]{2}$/),
  subdivisionCode: z.string().nullish(),
  status: z.enum(["active", "review_required", "expired", "revoked"]),
  expiresAt: z.string(),
});

const eligibilitySchema = z.object({
  allowed: z.boolean(),
  reason: z.string().max(200).optional(),
  intentId: z.string().min(1).max(200).optional(),
  taxQuoteAuthorization: z.unknown().optional(),
  taxQuoteApproval: z
    .object({
      status: z.literal("pending"),
      statusToken: z.string().min(1).max(4000),
      expiresAt: z.string(),
      pollAfterMs: z.number().int().min(250).max(60_000),
    })
    .optional(),
});

const approvalStatusSchema = z.object({
  status: z.enum(["pending", "approved", "rejected", "cancelled", "expired", "unavailable", "not_cancellable"]),
  pollAfterMs: z.number().int().min(250).max(60_000).optional(),
});

const challengeSchema = z.object({ nonce: z.string().min(8).max(200), expiresAt: z.string() });

// ---------- 公開する型 ----------

export type SaleInfo = {
  chainId: number;
  saleAddress: `0x${string}`;
  tokenAddress: `0x${string}`;
  creatorWallet: `0x${string}`;
  paymentToken: `0x${string}`;
  paymentDecimals: number;
  paymentSymbol?: string;
  /** 販売するトークン自身の名前と記号（販売 API の tokenName / tokenSymbol）。 */
  tokenName?: string;
  tokenSymbol?: string;
  taxDisplayMode?: string;
  /** epoch 秒。0 は期限なし。 */
  buyEnd?: number;
};

export type SellerInfo = {
  name: string;
  address?: string;
  contact?: string;
  /** 売り手情報の表示文（購入確認 API の本文に使う。無ければ undefined）。 */
  paymentTiming?: string;
  deliveryTiming?: string;
  refundPolicyText?: string;
  /** 購入確認 API に送る法定表示の写し。 */
  legal: {
    legalDisplayVersion: string;
    legalTermsTemplateId: string;
    legalDisplaySnapshotHash: string;
    confirmationTextVersion: string;
    sellerLegalProfileRef: string;
  };
};

export type MarketScope = { buyerCountries: string[] | null; notSellableNowCountries: string[] };

export type BuyQuote = {
  rawAmount: bigint;
  paymentAmount: bigint;
  breakdown: {
    creatorNetAmount: bigint;
    protocolFeeGross: bigint;
    affiliateFeeGross: bigint;
    refundReserveDeposit: bigint;
  };
};

export type ResidenceProfile = { countryCode: string; subdivisionCode?: string; status: string; expiresAt: string };

export type EligibilityRequest = {
  buyerWallet: string;
  sale: SaleRef;
  residenceCountryCode: string;
  termsAcceptedAt: string;
  tokenAmount: bigint;
  quote: BuyQuote;
  paymentMethod: string;
  paymentTiming: string;
  deliveryTiming: string;
  applicationDeadline: string;
  legal: SellerInfo["legal"];
  taxQuoteApprovalToken?: string;
};

export type EligibilityResult = {
  allowed: boolean;
  reason: string;
  intentId?: string;
  /** 形は未検証。使う前に validateTaxQuoteAuthorization を通す。 */
  taxQuoteAuthorization?: unknown;
  taxQuoteApproval?: { statusToken: string; expiresAt: string; pollAfterMs: number };
};

export type ApprovalStatus = { status: z.infer<typeof approvalStatusSchema>["status"]; pollAfterMs?: number };

export type PurchaseRecord = {
  buyerWallet: string;
  chainId: number;
  saleAddress: string;
  intentId: string;
  transactionHash: string;
  logIndex: number;
};

export interface GohoTokenPurchaseApi {
  getSale(sale: SaleRef): Promise<ApiResult<SaleInfo>>;
  getSeller(creatorWallet: string): Promise<ApiResult<SellerInfo>>;
  getMarketScope(): Promise<ApiResult<MarketScope>>;
  /** buyer を渡すと API は購入内訳（quoteBuyBreakdown）を付ける。V3 の購入ではこれが無いと見積りにならない。 */
  getBuyQuote(sale: SaleRef, rawAmount: bigint, buyer?: string): Promise<ApiResult<BuyQuote>>;
  getResidence(signer: WalletSigner): Promise<ApiResult<ResidenceProfile | null>>;
  declareResidence(signer: WalletSigner, input: { countryCode: string; subdivisionCode?: string }): Promise<ApiResult<ResidenceProfile>>;
  checkEligibility(signer: WalletSigner, request: EligibilityRequest): Promise<ApiResult<EligibilityResult>>;
  getApprovalStatus(statusToken: string): Promise<ApiResult<ApprovalStatus>>;
  recordPurchase(signer: WalletSigner, record: PurchaseRecord): Promise<ApiResult<{ recorded: true }>>;
}

export function residenceIsActive(profile: ResidenceProfile | null, now = Date.now()): profile is ResidenceProfile {
  return Boolean(profile && profile.status === "active" && /^[A-Z]{2}$/.test(profile.countryCode) && Date.parse(profile.expiresAt) > now);
}

// ---------- 実装 ----------

type ClientOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  now?: () => number;
};

const unavailable = (reason: string): Unavailable => ({ status: "unavailable", reason });

async function sha256Hex(value: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** api/src/auth.js buildSigningMessage と1文字でも違うと署名が合わない。 */
export function buildSigningMessage(input: {
  method: string;
  path: string;
  wallet: string;
  chainId: string;
  bodyHash: string;
  timestamp: string;
  nonce: string;
  expiresAt: string;
}): string {
  const residenceDeclaration = input.path === "/api/purchase-eligibility";
  return [
    residenceDeclaration ? "GohoToken Residence Declaration" : "GohoToken API Request",
    ...(residenceDeclaration
      ? [
          "declaration: I declare that my usual place of residence is the country stated in this request.",
          "networkCheck: I understand that the server separately verifies the connection country.",
        ]
      : []),
    `method: ${input.method}`,
    `path: ${input.path}`,
    `wallet: ${input.wallet.toLowerCase()}`,
    `chainId: ${input.chainId}`,
    `bodyHash: ${input.bodyHash}`,
    `timestamp: ${input.timestamp}`,
    `nonce: ${input.nonce}`,
    `expiresAt: ${input.expiresAt}`,
  ].join("\n");
}

export function createGohoTokenApi(options: ClientOptions = {}): GohoTokenPurchaseApi {
  const base = (options.baseUrl ?? GOHOTOKEN_API_ORIGIN).replace(/\/$/, "");
  const now = options.now ?? Date.now;
  const doFetch: typeof fetch = (input, init) => (options.fetchImpl ?? globalThis.fetch)(input, init);

  async function http(
    path: string,
    init: { method: "GET" | "POST" | "PUT"; body?: string; headers?: Record<string, string> },
  ): Promise<{ status: number; json: unknown } | null> {
    try {
      const response = await doFetch(`${base}${path}`, {
        method: init.method,
        credentials: "omit",
        headers: {
          accept: "application/json",
          ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
        body: init.body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json = await response.json().catch(() => null);
      return { status: response.status, json };
    } catch {
      return null;
    }
  }

  const ok = (response: { status: number } | null) => response !== null && response.status >= 200 && response.status < 300;

  /** 署名付きの書き込み。番号は1回限りなので呼び出しごとに取り直す。 */
  async function signedRequest(
    signer: WalletSigner,
    method: "GET" | "POST" | "PUT",
    path: string,
    payload?: Record<string, unknown>,
  ): Promise<{ status: number; json: unknown } | null> {
    if (!isAddress(signer.address, { strict: false })) return null;
    const wallet = getAddress(signer.address.toLowerCase());
    const chainId = String(AVALANCHE_CHAIN_ID);
    const body = payload === undefined ? "" : JSON.stringify(payload);
    const bodyHash = await sha256Hex(body);
    const challengeResponse = await http("/api/auth/challenge", {
      method: "POST",
      body: JSON.stringify({ wallet, method, path, bodyHash }),
    });
    if (!ok(challengeResponse)) return null;
    const challenge = challengeSchema.safeParse(challengeResponse!.json);
    if (!challenge.success) return null;
    const expiresMs = Date.parse(challenge.data.expiresAt);
    if (!Number.isFinite(expiresMs) || expiresMs <= now()) return null;
    const timestamp = new Date(now()).toISOString();
    const message = buildSigningMessage({
      method,
      path,
      wallet,
      chainId,
      bodyHash,
      timestamp,
      nonce: challenge.data.nonce,
      expiresAt: challenge.data.expiresAt,
    });
    let signature: string;
    try {
      signature = await signer.signMessage(message);
    } catch {
      return null;
    }
    if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) return null;
    return http(path, {
      method,
      body: payload === undefined ? undefined : body,
      headers: {
        "x-goho-wallet": wallet,
        "x-goho-chain-id": chainId,
        "x-goho-timestamp": timestamp,
        "x-goho-body-hash": bodyHash,
        "x-goho-nonce": challenge.data.nonce,
        "x-goho-expires-at": challenge.data.expiresAt,
        "x-goho-signature": signature,
      },
    });
  }

  const checkedSale = (sale: SaleRef): `0x${string}` | null =>
    sale.chainId === AVALANCHE_CHAIN_ID && isAddress(sale.saleAddress, { strict: false })
      ? getAddress(sale.saleAddress.toLowerCase())
      : null;

  return {
    async getSale(sale) {
      const saleAddress = checkedSale(sale);
      if (!saleAddress) return unavailable("unsupported_sale");
      const response = await http(`/api/sales/${sale.chainId}/${saleAddress}`, { method: "GET" });
      if (!ok(response)) return unavailable("sale_unavailable");
      const parsed = saleSchema.safeParse(response!.json);
      if (!parsed.success) return unavailable("sale_shape");
      const data = parsed.data;
      if (data.chainId !== sale.chainId || getAddress(data.saleAddress.toLowerCase()) !== saleAddress) {
        return unavailable("sale_mismatch");
      }
      // V2 の GOHO は購入の対象外。版は名乗りと工場の住所の両方が V3 のときだけ認める。
      if (
        data.contractVersion !== "v3" ||
        !data.factoryAddress ||
        getAddress(data.factoryAddress.toLowerCase()) !== getAddress(GOHOTOKEN_V3_FACTORY_AVALANCHE)
      ) {
        return unavailable("sale_not_purchasable");
      }
      return {
        status: "ok",
        value: {
          chainId: data.chainId,
          saleAddress,
          tokenAddress: getAddress(data.tokenAddress.toLowerCase()),
          creatorWallet: getAddress(data.creatorWallet.toLowerCase()),
          paymentToken: getAddress(data.paymentToken.toLowerCase()),
          paymentDecimals: data.paymentDecimals,
          paymentSymbol: data.paymentSymbol,
          tokenName: data.tokenName?.trim() || undefined,
          tokenSymbol: data.tokenSymbol?.trim() || undefined,
          taxDisplayMode: data.taxDisplayMode,
          buyEnd: data.buyEnd,
        },
      };
    },

    async getSeller(creatorWallet) {
      if (!isAddress(creatorWallet, { strict: false })) return unavailable("invalid_creator");
      const creator = getAddress(creatorWallet.toLowerCase());
      const response = await http(`/api/creator/${creator}/legal-profile`, { method: "GET" });
      if (!ok(response)) return unavailable("seller_unavailable");
      const parsed = sellerSchema.safeParse(response!.json);
      if (!parsed.success) return unavailable("seller_shape");
      const data = parsed.data;
      if (data.creatorWallet && getAddress(data.creatorWallet.toLowerCase()) !== creator) return unavailable("seller_mismatch");
      const ref = data.sellerLegalProfileRef ?? data.legalProfileReferenceId;
      // 参照実装 resolvePurchaseLegalEvidence と同じく、参照IDは作成者のウォレットを含むこと。
      if (!ref || !ref.toLowerCase().includes(creator.toLowerCase())) return unavailable("seller_reference");
      return {
        status: "ok",
        value: {
          name: data.legalSellerName ?? data.sellerDisplayName,
          address: data.legalAddress,
          contact: data.contactEmail ?? data.inquiryUrl ?? data.contactMethod,
          paymentTiming: data.paymentTiming,
          deliveryTiming: data.deliveryTimingText ?? data.deliveryOrRightsTransferTiming,
          refundPolicyText: data.refundPolicyText,
          legal: {
            legalDisplayVersion: data.legalDisplayVersion,
            legalTermsTemplateId: data.legalTermsTemplateId,
            legalDisplaySnapshotHash: data.legalDisplaySnapshotHash,
            confirmationTextVersion: data.confirmationTextVersion,
            sellerLegalProfileRef: ref,
          },
        },
      };
    },

    async getMarketScope() {
      const response = await http("/api/purchase-market-scope", { method: "GET" });
      if (!ok(response)) return unavailable("scope_unavailable");
      const parsed = marketScopeSchema.safeParse(response!.json);
      if (!parsed.success) return unavailable("scope_shape");
      return {
        status: "ok",
        value: {
          buyerCountries: parsed.data.buyerCountries ?? null,
          notSellableNowCountries: parsed.data.notSellableNowCountries ?? [],
        },
      };
    },

    async getBuyQuote(sale, rawAmount, buyer) {
      const saleAddress = checkedSale(sale);
      if (!saleAddress || typeof rawAmount !== "bigint" || rawAmount <= 0n) return unavailable("unsupported_quote");
      const search = new URLSearchParams({
        chainId: String(sale.chainId),
        saleAddress,
        rawAmount: rawAmount.toString(),
      });
      if (buyer !== undefined) {
        if (!/^0x[0-9a-fA-F]{40}$/.test(buyer)) return unavailable("unsupported_quote");
        search.set("buyer", getAddress(buyer.toLowerCase()));
      }
      const response = await http(`/api/quotes/buy?${search.toString()}`, { method: "GET" });
      if (!ok(response)) return unavailable("quote_unavailable");
      const parsed = buyQuoteSchema.safeParse(response!.json);
      if (!parsed.success) return unavailable("quote_shape");
      const data = parsed.data;
      if (data.chainId !== sale.chainId || getAddress(data.saleAddress.toLowerCase()) !== saleAddress) return unavailable("quote_mismatch");
      const paymentAmount = BigInt(data.paymentAmount);
      const breakdown = {
        creatorNetAmount: BigInt(data.quoteBuyBreakdown.creatorNetAmount),
        protocolFeeGross: BigInt(data.quoteBuyBreakdown.protocolFeeGross),
        affiliateFeeGross: BigInt(data.quoteBuyBreakdown.affiliateFeeGross),
        refundReserveDeposit: BigInt(data.quoteBuyBreakdown.refundReserveDeposit),
      };
      const sum = breakdown.creatorNetAmount + breakdown.protocolFeeGross + breakdown.affiliateFeeGross + breakdown.refundReserveDeposit;
      if (BigInt(data.rawAmount) !== rawAmount || paymentAmount <= 0n || sum !== paymentAmount) return unavailable("quote_inconsistent");
      return { status: "ok", value: { rawAmount, paymentAmount, breakdown } };
    },

    async getResidence(signer) {
      if (!isAddress(signer.address, { strict: false })) return unavailable("invalid_wallet");
      const path = `/api/wallet/${getAddress(signer.address.toLowerCase())}/residence-profile`;
      // 本人の分だけ読めるため署名が要る。宣言が無いときは 200 で null。
      const response = await signedRequest(signer, "GET", path);
      if (!ok(response)) return unavailable("residence_unavailable");
      if (response!.json === null) return { status: "ok", value: null };
      const parsed = residenceSchema.safeParse(response!.json);
      if (!parsed.success) return unavailable("residence_shape");
      return {
        status: "ok",
        value: {
          countryCode: parsed.data.countryCode,
          subdivisionCode: parsed.data.subdivisionCode ?? undefined,
          status: parsed.data.status,
          expiresAt: parsed.data.expiresAt,
        },
      };
    },

    async declareResidence(signer, input) {
      if (!/^[A-Z]{2}$/.test(input.countryCode)) return unavailable("invalid_country");
      if (!isAddress(signer.address, { strict: false })) return unavailable("invalid_wallet");
      const path = `/api/wallet/${getAddress(signer.address.toLowerCase())}/residence-profile`;
      const payload: Record<string, unknown> = { countryCode: input.countryCode };
      if (input.subdivisionCode) payload.subdivisionCode = input.subdivisionCode;
      const response = await signedRequest(signer, "PUT", path, payload);
      if (!ok(response)) return unavailable("residence_declare_failed");
      const parsed = residenceSchema.safeParse(response!.json);
      if (!parsed.success) return unavailable("residence_shape");
      return {
        status: "ok",
        value: {
          countryCode: parsed.data.countryCode,
          subdivisionCode: parsed.data.subdivisionCode ?? undefined,
          status: parsed.data.status,
          expiresAt: parsed.data.expiresAt,
        },
      };
    },

    async checkEligibility(signer, request) {
      const saleAddress = checkedSale(request.sale);
      if (!saleAddress || !isAddress(request.buyerWallet, { strict: false })) return unavailable("unsupported_sale");
      const payload: Record<string, unknown> = {
        buyerWallet: getAddress(request.buyerWallet.toLowerCase()),
        chainId: String(request.sale.chainId),
        saleAddress,
        buyerCountry: request.residenceCountryCode === "JP" ? "JP" : "OTHER",
        residenceCountryCode: request.residenceCountryCode,
        residencyAssertion: "residence_declared",
        jurisdictionPolicyVersion: JURISDICTION_POLICY_VERSION,
        privacyPolicyVersion: PRIVACY_POLICY_VERSION,
        termsAccepted: true,
        termsAcceptedAt: request.termsAcceptedAt,
        tokenAmount: request.tokenAmount.toString(),
        grossCost: request.quote.paymentAmount.toString(),
        creatorNetAmount: request.quote.breakdown.creatorNetAmount.toString(),
        protocolFeeGross: request.quote.breakdown.protocolFeeGross.toString(),
        affiliateFeeGross: request.quote.breakdown.affiliateFeeGross.toString(),
        refundReserveDeposit: request.quote.breakdown.refundReserveDeposit.toString(),
        paymentMethod: request.paymentMethod,
        paymentTiming: request.paymentTiming,
        deliveryTiming: request.deliveryTiming,
        returnCancellationTerms: PURCHASE_CANCELLATION_REFUND_TERMS,
        applicationDeadline: request.applicationDeadline,
        termsVersion: SITE_TERMS_VERSION,
        legalDisplayVersion: request.legal.legalDisplayVersion,
        legalTermsTemplateId: request.legal.legalTermsTemplateId,
        legalDisplaySnapshotHash: request.legal.legalDisplaySnapshotHash,
        confirmationTextVersion: request.legal.confirmationTextVersion,
        sellerLegalProfileRef: request.legal.sellerLegalProfileRef,
        purchaseConfirmationVersion: request.legal.confirmationTextVersion,
      };
      if (request.taxQuoteApprovalToken) payload.taxQuoteApprovalToken = request.taxQuoteApprovalToken;
      const response = await signedRequest(signer, "POST", "/api/purchase-eligibility", payload);
      if (!response) return unavailable("eligibility_unavailable");
      // 403 の { allowed: false, reason } は正規の拒否。それ以外の失敗は準備中へ閉じる。
      if (!ok(response) && response.status !== 403) return unavailable("eligibility_unavailable");
      const parsed = eligibilitySchema.safeParse(response.json);
      if (!parsed.success) return unavailable("eligibility_shape");
      const data = parsed.data;
      if (!ok(response) && data.allowed) return unavailable("eligibility_inconsistent");
      if (data.allowed && !data.taxQuoteApproval && !data.intentId) return unavailable("eligibility_intent_missing");
      return {
        status: "ok",
        value: {
          allowed: data.allowed,
          reason: data.reason ?? "",
          intentId: data.intentId,
          taxQuoteAuthorization: data.taxQuoteAuthorization,
          taxQuoteApproval: data.taxQuoteApproval,
        },
      };
    },

    async getApprovalStatus(statusToken) {
      const response = await http("/api/tax-quote-approval-status", {
        method: "POST",
        body: JSON.stringify({ statusToken }),
      });
      if (!ok(response)) return unavailable("approval_unavailable");
      const parsed = approvalStatusSchema.safeParse(response!.json);
      if (!parsed.success) return unavailable("approval_shape");
      return { status: "ok", value: parsed.data };
    },

    async recordPurchase(signer, record) {
      if (!isAddress(record.buyerWallet, { strict: false }) || !isAddress(record.saleAddress, { strict: false })) {
        return unavailable("invalid_record");
      }
      if (!/^0x[0-9a-fA-F]{64}$/.test(record.transactionHash) || !Number.isInteger(record.logIndex) || record.logIndex < 0) {
        return unavailable("invalid_record");
      }
      const response = await signedRequest(signer, "POST", "/api/purchase-confirmations", {
        buyerWallet: getAddress(record.buyerWallet.toLowerCase()),
        chainId: String(record.chainId),
        saleAddress: getAddress(record.saleAddress.toLowerCase()),
        intentId: record.intentId,
        txHash: record.transactionHash,
        logIndex: record.logIndex,
        confirmed: true,
      });
      if (!ok(response)) return unavailable("record_failed");
      return { status: "ok", value: { recorded: true } };
    },
  };
}

export function getGohoTokenPurchaseApi(): GohoTokenPurchaseApi {
  return createGohoTokenApi();
}
