// GohoToken V3（2026-10-15 から本番の GOHO の購入先は V3 だけ）。V2 は購入の対象外。
// 最小限のABI断片。出典（読み取り専用の参照）:
//   .codex-work/gohotoken-latest-network-console/frontend/src/abi/vendingV3.ts
//     "function buyWithTaxQuote((uint256 tokenAmount,uint256 baseCost,bytes32 breakdownHash,uint256 taxAmount,
//        bytes32 policyId,bool platformRemits,uint64 deadline) quote,bytes signature,uint256 maxPayment,address referrer) payable"
//     "event Purchased(address indexed buyer,address indexed referrer,bytes32 indexed quoteDigest,uint256 tokenAmount,
//        uint256 grossCost,uint256 reserveContribution,uint256 protocolFee,uint256 affiliateFee,uint256 creatorFee,
//        uint256 taxAmount,uint8 taxMode,bytes32 policyId,uint64 expiry,uint256 deferredAmount)"
//   税見積（EIP-712）: 同 frontend/src/hooks/useQuote.ts V3_TAX_QUOTE_TYPES / taxQuoteV3Domain
// 決済トークンは固定しない。販売ごとに GohoToken の販売 API の paymentToken / paymentDecimals を読む（2026-10-13）。

export const AVALANCHE_CHAIN_ID = 43114;
export const AVALANCHE_CHAIN_ID_HEX = "0xa86a";

export const GOHO_TOKEN_DECIMALS = 18;

/** 購入を受け付ける唯一の工場（Avalanche, V3）。版は名乗りでなく工場の住所で決める。 */
export const GOHOTOKEN_V3_FACTORY_AVALANCHE = "0x3254D8556C6f503391771d1a53EBd823A23d148D" as const;

/** 販売 API が返す paymentToken の例（表示用の会計通貨の判定にだけ使う。許可の判断には使わない）。 */
export const KNOWN_PAYMENT_TOKENS_AVALANCHE: Readonly<Record<string, { symbol: string; decimals: number; accountingCurrency: string }>> = {
  "0xe7c3d8c9a439fede00d2600032d5db0be71c3c29": { symbol: "JPYC", decimals: 18, accountingCurrency: "JPY" },
  "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": { symbol: "USDC", decimals: 6, accountingCurrency: "USD" },
};

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export const TAX_QUOTE_SCHEME_V3 = "gohotoken-v3-eip712" as const;
export const TAX_QUOTE_V3_PRIMARY_TYPE = "GohoTokenTaxQuoteV3" as const;
export const TAX_QUOTE_V3_DOMAIN_NAME = "GohoToken";
export const TAX_QUOTE_V3_DOMAIN_VERSION = "3";

export const TAX_QUOTE_V3_TYPES = {
  GohoTokenTaxQuoteV3: [
    { name: "buyer", type: "address" },
    { name: "referrer", type: "address" },
    { name: "tokenAmount", type: "uint256" },
    { name: "baseCost", type: "uint256" },
    { name: "breakdownHash", type: "bytes32" },
    { name: "taxAmount", type: "uint256" },
    { name: "policyId", type: "bytes32" },
    { name: "platformRemits", type: "bool" },
    { name: "recipient", type: "address" },
    { name: "policyEpoch", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const ERC20_APPROVE_ABI = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const VENDING_V3_BUY_WITH_TAX_QUOTE_ABI = [
  {
    type: "function",
    name: "buyWithTaxQuote",
    stateMutability: "payable",
    inputs: [
      {
        name: "quote",
        type: "tuple",
        components: [
          { name: "tokenAmount", type: "uint256" },
          { name: "baseCost", type: "uint256" },
          { name: "breakdownHash", type: "bytes32" },
          { name: "taxAmount", type: "uint256" },
          { name: "policyId", type: "bytes32" },
          { name: "platformRemits", type: "bool" },
          { name: "deadline", type: "uint64" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "maxPayment", type: "uint256" },
      { name: "referrer", type: "address" },
    ],
    outputs: [],
  },
] as const;

export const PURCHASED_EVENT_ABI = [
  {
    type: "event",
    name: "Purchased",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "referrer", type: "address", indexed: true },
      { name: "quoteDigest", type: "bytes32", indexed: true },
      { name: "tokenAmount", type: "uint256", indexed: false },
      { name: "grossCost", type: "uint256", indexed: false },
      { name: "reserveContribution", type: "uint256", indexed: false },
      { name: "protocolFee", type: "uint256", indexed: false },
      { name: "affiliateFee", type: "uint256", indexed: false },
      { name: "creatorFee", type: "uint256", indexed: false },
      { name: "taxAmount", type: "uint256", indexed: false },
      { name: "taxMode", type: "uint8", indexed: false },
      { name: "policyId", type: "bytes32", indexed: false },
      { name: "expiry", type: "uint64", indexed: false },
      { name: "deferredAmount", type: "uint256", indexed: false },
    ],
  },
] as const;

/** 販売のチェーン上の状態。税政策（platformTaxRecipient / taxPolicyEpoch）と版の確認に使う。出典: vendingV3.ts saleView()。 */
export const VENDING_V3_SALE_VIEW_ABI = [
  {
    type: "function",
    name: "saleView",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "v",
        type: "tuple",
        components: [
          { name: "viewVersion", type: "uint8" },
          { name: "factory", type: "address" },
          { name: "token", type: "address" },
          { name: "paymentToken", type: "address" },
          { name: "creator", type: "address" },
          { name: "pendingCreator", type: "address" },
          { name: "protocolFeeRecipient", type: "address" },
          { name: "curveKind", type: "uint8" },
          { name: "sellReturnBps", type: "uint16" },
          { name: "protocolFeeBps", type: "uint16" },
          { name: "affiliateEnabled", type: "bool" },
          { name: "affiliateFeeBps", type: "uint16" },
          { name: "accessDuration", type: "uint64" },
          { name: "saleStart", type: "uint64" },
          { name: "buyEnd", type: "uint64" },
          { name: "powerExponent", type: "uint256" },
          { name: "basePricePaymentToken", type: "uint256" },
          { name: "slopePaymentTokenPerToken", type: "uint256" },
          { name: "quadraticCoeffPaymentToken", type: "uint256" },
          { name: "powerCoeffPaymentToken", type: "uint256" },
          { name: "stepSizeTokens", type: "uint256" },
          { name: "stepPricePaymentToken", type: "uint256" },
          { name: "maxPricePaymentToken", type: "uint256" },
          { name: "maxSupplyTokens", type: "uint256" },
          { name: "minTradeUnitTokens", type: "uint256" },
          { name: "breakpointCount", type: "uint256" },
          { name: "totalSupply", type: "uint256" },
          { name: "reserveSell", type: "uint256" },
          { name: "totalClaimableOutstanding", type: "uint256" },
          { name: "cumulativeGrossBuyVolume", type: "uint256" },
          { name: "buyPricePerToken", type: "uint256" },
          { name: "sellPricePerToken", type: "uint256" },
          { name: "buyPriceForMinTradeUnit", type: "uint256" },
          { name: "sellPriceForMinTradeUnit", type: "uint256" },
          { name: "paymentAssetSolvent", type: "bool" },
          { name: "paymentAssetShortfall", type: "uint256" },
          { name: "hidden", type: "bool" },
          { name: "metadataURI", type: "string" },
          { name: "tokenName", type: "string" },
          { name: "tokenSymbol", type: "string" },
          { name: "tokenDecimals", type: "uint8" },
          { name: "paymentTokenDecimals", type: "uint8" },
          { name: "taxQuoteRequired", type: "bool" },
          { name: "taxQuoteSigner", type: "address" },
          { name: "platformTaxRecipient", type: "address" },
          { name: "taxPolicyEpoch", type: "uint256" },
        ],
      },
    ],
  },
] as const;
