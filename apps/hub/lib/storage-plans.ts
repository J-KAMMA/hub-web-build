// 保存容量プランの画面で使う、描画に依存しない部品（PLAN.md §6）。
// 使用量の読み出しに失敗したら null を返す。0 や無料の上限を代わりに作らない。

export const STORAGE_NEAR_LIMIT_RATIO = 0.8;
/** Commerce は同じオリジンの `/shopping/api/commerce/*` で受ける。ブラウザが直接呼ぶ（Hub は中継しない）。 */
export const COMMERCE_STORAGE_PLANS_BASE = "/shopping/api/commerce/api/v1/storage-plans";
export const ACCOUNT_STORAGE_PURCHASE_ASSERTION = "/account/api/v1/assertions/payment-storage-plan";
export const STORAGE_STATUS_PATH = "/api/account/storage";
export const COMMERCE_LEGAL_PATH = "/legal/commerce";
/** 自動更新（AUTOPAY.md §2）。ブラウザが Commerce を直接呼ぶ。Hub は中継しない。 */
export const COMMERCE_STORAGE_AUTOPAY_BASE = "/shopping/api/commerce/api/v1/storage-autopay";
/** 自動更新は Fuji（テストネット）だけ。メインネットは開かない。 */
export const STORAGE_AUTOPAY_ALLOWED_CHAIN_IDS: readonly number[] = [43113];

export type StorageServiceUsage = { service: string; committedBytes: number; reservedBytes: number };
export type StorageMeterStatus = {
  planCode: string;
  state: string;
  planUntil: string | null;
  /** Account が持つ更新の方式と次の更新時刻。額・トークン・アドレスは載らない。 */
  renewal: "manual" | "auto";
  nextRenewalAt: string | null;
  limitBytes: number;
  usedBytes: number;
  remainingBytes: number;
  byService: StorageServiceUsage[];
};
export type StorageLevel = "normal" | "near" | "full";

const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** 形が崩れていたら null。部分的に読めた値で 0 を埋めない。 */
export function parseStorageStatus(value: unknown): StorageMeterStatus | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const limitBytes = count(v.limitBytes);
  const usedBytes = count(v.usedBytes);
  if (typeof v.planCode !== "string" || typeof v.state !== "string" || limitBytes === null || usedBytes === null || limitBytes <= 0) return null;
  const autoNext = v.renewal === "auto" && typeof v.nextRenewalAt === "string" && Number.isFinite(Date.parse(v.nextRenewalAt)) ? v.nextRenewalAt : null;
  const rows = Array.isArray(v.byService) ? v.byService : [];
  const byService: StorageServiceUsage[] = [];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    const committed = count(r?.committedBytes);
    const reserved = count(r?.reservedBytes);
    if (typeof r?.service === "string" && committed !== null && reserved !== null) byService.push({ service: r.service, committedBytes: committed, reservedBytes: reserved });
  }
  return {
    planCode: v.planCode,
    state: v.state,
    planUntil: typeof v.planUntil === "string" ? v.planUntil : null,
    renewal: autoNext ? "auto" : "manual",
    nextRenewalAt: autoNext,
    limitBytes,
    usedBytes,
    remainingBytes: Math.max(0, limitBytes - usedBytes),
    byService,
  };
}

export function storageLevel(usedBytes: number, limitBytes: number): StorageLevel {
  if (limitBytes <= 0) return "full";
  const ratio = usedBytes / limitBytes;
  return ratio >= 1 ? "full" : ratio >= STORAGE_NEAR_LIMIT_RATIO ? "near" : "normal";
}

export function formatStorageBytes(bytes: number, locale: "ja" | "en" | string): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = safe > 0 ? Math.min(Math.floor(Math.log(safe) / Math.log(1024)), units.length - 1) : 0;
  const value = safe / 1024 ** index;
  return `${new Intl.NumberFormat(locale === "ja" ? "ja-JP" : "en", { maximumFractionDigits: index === 0 ? 0 : value >= 10 ? 1 : 2 }).format(value)} ${units[index]}`;
}

export type StoragePlanCard = { code: string; bytes: number; priceJpy: number; termDays: number };
export type StoragePlanListing = {
  available: boolean;
  chainId?: number;
  chainName?: string;
  plans: StoragePlanCard[];
  tokens?: { JPYC: { available: boolean }; USDC: { available: boolean; rate: { rateDate: string; source: string } | null } };
};

export function parsePlanListing(value: unknown): StoragePlanListing | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, any>;
  if (!Array.isArray(v.plans)) return null;
  const plans: StoragePlanCard[] = [];
  for (const p of v.plans) {
    if (typeof p?.code === "string" && count(p.bytes) && count(p.priceJpy) && p.termDays === 30) plans.push({ code: p.code, bytes: p.bytes, priceJpy: p.priceJpy, termDays: 30 });
  }
  if (!plans.length) return null;
  return {
    available: v.available === true,
    chainId: typeof v.chainId === "number" ? v.chainId : undefined,
    chainName: typeof v.chainName === "string" ? v.chainName : undefined,
    plans,
    tokens: v.tokens && typeof v.tokens === "object"
      ? {
          JPYC: { available: v.tokens.JPYC?.available === true },
          USDC: {
            available: v.tokens.USDC?.available === true,
            rate: v.tokens.USDC?.rate && typeof v.tokens.USDC.rate.rateDate === "string" ? { rateDate: v.tokens.USDC.rate.rateDate, source: String(v.tokens.USDC.rate.source ?? "") } : null,
          },
        }
      : undefined,
  };
}

/** ERC-20 transfer(address,uint256) の calldata。送金は利用者のウォレットが署名する。 */
export function erc20TransferData(to: string, atomic: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(to) || !/^[1-9][0-9]*$/u.test(atomic)) throw new Error("invalid_transfer");
  const amount = BigInt(atomic).toString(16);
  if (amount.length > 64) throw new Error("amount_overflow");
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${amount.padStart(64, "0")}`;
}

export function planBytesLabel(bytes: number): string {
  return `${Math.round(bytes / 1024 ** 3)}GB`;
}

export function planUntilLabel(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Intl.DateTimeFormat(locale === "ja" ? "ja-JP" : "en", { year: "numeric", month: "numeric", day: "numeric" }).format(time);
}

const word = (hex: string) => hex.replace(/^0x/u, "").toLowerCase().padStart(64, "0");

/** ERC-20 approve(address,uint256) の calldata。許可の相手は Commerce の引き落としコントラクトだけ。 */
export function erc20ApproveData(spender: string, atomic: string): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/u.test(spender) || !/^(0|[1-9][0-9]*)$/u.test(atomic)) throw new Error("invalid_approve");
  const amount = BigInt(atomic).toString(16);
  if (amount.length > 64) throw new Error("amount_overflow");
  return `0x095ea7b3${word(spender)}${amount.padStart(64, "0")}`;
}

/** CommerceStorageAutopayV1.subscribe(planCodeHash, token, amount, ref, firstDue=0)。firstDue=0 は最初の 1 回をその場で引き落とす。 */
export function autopaySubscribeData(input: { planCodeHash: string; tokenAddress: string; amountAtomic: string; ref: string }): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{64}$/u.test(input.planCodeHash) || !/^0x[0-9a-fA-F]{64}$/u.test(input.ref)) throw new Error("invalid_subscribe");
  if (!/^0x[0-9a-fA-F]{40}$/u.test(input.tokenAddress) || !/^[1-9][0-9]*$/u.test(input.amountAtomic)) throw new Error("invalid_subscribe");
  const amount = BigInt(input.amountAtomic).toString(16);
  if (amount.length > 32) throw new Error("amount_overflow");
  return `0xf503ef11${word(input.planCodeHash)}${word(input.tokenAddress)}${amount.padStart(64, "0")}${word(input.ref)}${"0".repeat(64)}`;
}

export type AutopayOffer = {
  subscriptionId: string;
  subscriptionToken: string;
  chainId: number;
  contractAddress: string;
  tokenAddress: string;
  token: "JPYC" | "USDC";
  amountAtomic: string;
  displayAmount: string;
  approveAtomic: string;
  planCode: string;
  planCodeHash: string;
  ref: string;
  maxPulls: number;
  confirmScreenVersion: string;
};

const isHex = (v: unknown, n: number) => typeof v === "string" && new RegExp(`^0x[0-9a-fA-F]{${n}}$`, "u").test(v);
const isAtomic = (v: unknown) => typeof v === "string" && /^[1-9][0-9]*$/u.test(v);

/** Commerce の申込みの返事。形が崩れていたら null（部分的な値で画面を作らない）。メインネットのチェーンも null。 */
export function parseAutopayOffer(value: unknown): AutopayOffer | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v.subscriptionId !== "string" || typeof v.subscriptionToken !== "string" || typeof v.confirmScreenVersion !== "string") return null;
  if (typeof v.chainId !== "number" || !STORAGE_AUTOPAY_ALLOWED_CHAIN_IDS.includes(v.chainId)) return null;
  if (!isHex(v.contractAddress, 40) || !isHex(v.tokenAddress, 40) || !isHex(v.ref, 64) || !isHex(v.planCodeHash, 64)) return null;
  if (v.token !== "JPYC" && v.token !== "USDC") return null;
  if (!isAtomic(v.amountAtomic) || !isAtomic(v.approveAtomic) || typeof v.displayAmount !== "string" || typeof v.planCode !== "string") return null;
  if (v.maxPulls !== 3) return null;
  return {
    subscriptionId: v.subscriptionId, subscriptionToken: v.subscriptionToken, chainId: v.chainId,
    contractAddress: v.contractAddress as string, tokenAddress: v.tokenAddress as string, token: v.token,
    amountAtomic: v.amountAtomic as string, displayAmount: v.displayAmount, approveAtomic: v.approveAtomic as string,
    planCode: v.planCode, planCodeHash: v.planCodeHash as string, ref: v.ref as string, maxPulls: 3, confirmScreenVersion: v.confirmScreenVersion,
  };
}
