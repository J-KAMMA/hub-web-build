import { getAddress, isAddress } from "viem";

import {
  ACCESS_GATE_CHAIN_IDS,
  ACCESS_GATE_MAX_DESCRIPTION_LENGTH,
  ACCESS_GATE_MAX_MIN_RAW_DIGITS,
  type AccessGateConditionKind,
  type AccessGateInput,
} from "@/lib/access-gates/types";
import { getGohoTokenPurchaseApi, type GohoTokenPurchaseApi } from "@/lib/gohotoken/api";
import { AVALANCHE_CHAIN_ID, GOHO_TOKEN_DECIMALS } from "@/lib/gohotoken/vending";

/*
 * 「トークンを鍵にする」かんたん設定の純粋な部分（ブラウザでもテストでも動く）。
 *  (a) gohotokenで作ったトークン: 販売ページのURL → 既存の販売API（/api/sales/{chain}/{address}）で解決。
 *      保存する形は Avalanche(43114) の ERC20 最小保有 + 入手先リンク=販売ページ。ハブ内の購入は GohoToken だけ。
 *  (b) ほかのトークン: チェーンとコントラクトを入れ、名前などはハブのサーバーが門の確認と同じRPCで読む。
 *      入手先は任意のhttps外部リンク1つ。ハブ内の購入は出ない。
 * 解決・読み取りに失敗したら何も保存しない（日本語の理由を返す）。
 */

const SALE_PAGE = /^https:\/\/(?:www\.)?gohotoken\.com\/token\/(\d+)\/(0x[0-9a-fA-F]{40})\/?$/;

export type PassError = { ok: false; code: string; message: string };

export function parseGohoSaleUrl(text: string): { ok: true; chainId: number; saleAddress: `0x${string}`; url: string } | PassError {
  const value = text.trim();
  if (!value) return { ok: false, code: "empty", message: "gohotokenの販売ページのURLを入力してください。" };
  let candidate = value;
  try {
    const parsed = new URL(value);
    if (parsed.protocol === "https:" && !parsed.username && !parsed.password) {
      // 検索や#以降は付いていても同じ販売ページとして扱う（保存する形は正規のURLだけ）。
      candidate = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
    }
  } catch {
    return { ok: false, code: "invalid_url", message: "URLの形が正しくありません。gohotoken.comの販売ページのURLを貼ってください。" };
  }
  const match = SALE_PAGE.exec(candidate);
  if (!match) {
    return { ok: false, code: "invalid_url", message: "gohotoken.comの販売ページのURL（https://gohotoken.com/token/…）を貼ってください。" };
  }
  if (Number(match[1]) !== AVALANCHE_CHAIN_ID) {
    return { ok: false, code: "not_avalanche", message: "Avalanche上のトークンだけが鍵にできます。" };
  }
  const saleAddress = getAddress(match[2]!.toLowerCase());
  return { ok: true, chainId: AVALANCHE_CHAIN_ID, saleAddress, url: `https://gohotoken.com/token/${AVALANCHE_CHAIN_ID}/${saleAddress}` };
}

export type GohoPass = {
  tokenName: string;
  tokenSymbol: string | null;
  tokenAddress: string;
  saleAddress: string;
  saleUrl: string;
};

export async function resolveGohoPass(
  urlText: string,
  api: GohoTokenPurchaseApi = getGohoTokenPurchaseApi(),
): Promise<{ ok: true; pass: GohoPass } | PassError> {
  const parsed = parseGohoSaleUrl(urlText);
  if (!parsed.ok) return parsed;
  const sale = await api.getSale({ chainId: parsed.chainId, saleAddress: parsed.saleAddress });
  if (sale.status !== "ok") {
    if (sale.reason === "sale_not_purchasable") {
      return { ok: false, code: "not_purchasable", message: "この販売はハブでは使えません（gohotokenの現行の販売だけが対象です）。" };
    }
    if (sale.reason === "sale_unavailable" || sale.reason === "sale_shape") {
      return { ok: false, code: "sale_not_found", message: "この販売ページが見つかりませんでした。URLを確かめてください（公開されている販売だけが使えます）。" };
    }
    return { ok: false, code: "unavailable", message: "gohotokenの販売情報を読み取れませんでした。しばらくしてからお試しください。" };
  }
  const info = sale.value;
  if (info.chainId !== AVALANCHE_CHAIN_ID) {
    return { ok: false, code: "not_avalanche", message: "Avalanche上のトークンだけが鍵にできます。" };
  }
  if (!isAddress(info.tokenAddress, { strict: false })) {
    return { ok: false, code: "sale_not_found", message: "この販売のトークンを確認できませんでした。" };
  }
  const symbol = info.tokenSymbol ?? null;
  return {
    ok: true,
    pass: {
      tokenName: info.tokenName ?? symbol ?? "",
      tokenSymbol: symbol,
      tokenAddress: info.tokenAddress.toLowerCase(),
      saleAddress: info.saleAddress,
      saleUrl: parsed.url,
    },
  };
}

/** 「必要な枚数」の入力 → 生の整数。整数部の桁と0を確かめる。表せなければ null。 */
export function passAmountToRaw(amount: string, decimals: number): string | null {
  const text = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) return null;
  const raw = (whole + fraction.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
  if (/^0+$/.test(raw) || raw.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS) return null;
  return raw;
}

const AMOUNT_ERROR = "必要な枚数は0より大きい数字で入力してください。";
export const PASS_AMOUNT_ERROR = AMOUNT_ERROR;

function describe(name: string, amount: string): string {
  const text = `${name} を ${amount.trim()} 枚持っている人`;
  return text.slice(0, ACCESS_GATE_MAX_DESCRIPTION_LENGTH);
}

export function buildGohoPassInput(pass: GohoPass, amount: string): { ok: true; input: AccessGateInput } | PassError {
  const raw = passAmountToRaw(amount, GOHO_TOKEN_DECIMALS);
  if (raw === null) return { ok: false, code: "amount", message: AMOUNT_ERROR };
  return {
    ok: true,
    input: {
      match: "any",
      description: describe(pass.tokenName || "gohotokenのトークン", amount),
      acquisitionUrl: pass.saleUrl,
      conditions: [
        { kind: "erc20", chainId: AVALANCHE_CHAIN_ID, contract: pass.tokenAddress, minRaw: raw, decimals: GOHO_TOKEN_DECIMALS },
      ],
    },
  };
}

/* ---- (b) ほかのトークン ---- */

export type OtherTokenMeta = {
  kind: AccessGateConditionKind;
  chainId: number;
  contract: string;
  name: string | null;
  symbol: string | null;
  decimals: number | null;
};

export function tokenDisplayName(meta: { name: string | null; symbol: string | null; contract: string }): string {
  return meta.name || meta.symbol || `${meta.contract.slice(0, 6)}…${meta.contract.slice(-4)}`;
}

export async function fetchTokenMeta(
  input: { kind: AccessGateConditionKind; chainId: number; contract: string },
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; meta: OtherTokenMeta } | PassError> {
  if (!(ACCESS_GATE_CHAIN_IDS as readonly number[]).includes(input.chainId)) {
    return { ok: false, code: "unsupported_chain", message: "このチェーンは閲覧条件に使えません。" };
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(input.contract.trim())) {
    return { ok: false, code: "invalid_address", message: "コントラクトアドレスは0xで始まる42文字で入力してください。" };
  }
  try {
    const response = await fetchImpl("/api/access-gates/token-meta", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: input.kind, chainId: input.chainId, contract: input.contract.trim() }),
    });
    const payload = (await response.json().catch(() => null)) as { meta?: OtherTokenMeta; error?: unknown; reason?: unknown } | null;
    if (response.ok && payload?.meta && payload.meta.contract.toLowerCase() === input.contract.trim().toLowerCase()) {
      return { ok: true, meta: payload.meta };
    }
    if (response.status === 401) return { ok: false, code: "login", message: "ログインするとトークンを確かめられます。" };
    return {
      ok: false,
      code: typeof payload?.reason === "string" ? payload.reason : "unavailable",
      message: typeof payload?.error === "string" && payload.error ? payload.error : "トークンの情報を読み取れませんでした。",
    };
  } catch {
    return { ok: false, code: "unavailable", message: "通信できませんでした。" };
  }
}

function validAcquisitionLink(link: string): PassError | { ok: true; url: string | null } {
  const text = link.trim();
  if (!text) return { ok: true, url: null };
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("bad");
    return { ok: true, url: text };
  } catch {
    return { ok: false, code: "link", message: "入手先リンクはhttpsのURLだけ指定できます。" };
  }
}

export function buildOtherPassInput(
  meta: OtherTokenMeta,
  options: { amount: string; tokenId: string; link: string },
): { ok: true; input: AccessGateInput } | PassError {
  const link = validAcquisitionLink(options.link);
  if (!link.ok) return link;
  const name = tokenDisplayName(meta);
  const base = { match: "any" as const, acquisitionUrl: link.url };
  if (meta.kind === "erc20") {
    if (meta.decimals === null) return { ok: false, code: "unavailable", message: "トークンの桁数を読み取れませんでした。" };
    const raw = passAmountToRaw(options.amount, meta.decimals);
    if (raw === null) return { ok: false, code: "amount", message: AMOUNT_ERROR };
    return {
      ok: true,
      input: {
        ...base,
        description: describe(name, options.amount),
        conditions: [{ kind: "erc20", chainId: meta.chainId, contract: meta.contract, minRaw: raw, decimals: meta.decimals }],
      },
    };
  }
  const amount = options.amount.trim() || "1";
  if (!/^\d+$/.test(amount) || /^0+$/.test(amount) || amount.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS) {
    return { ok: false, code: "amount", message: "必要な枚数は1以上の整数で入力してください。" };
  }
  const tokenId = options.tokenId.trim();
  if (meta.kind === "erc1155") {
    if (!/^\d+$/.test(tokenId) || tokenId.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS) {
      return { ok: false, code: "token_id", message: "ERC-1155ではトークンIDを数字で1つ入力してください。" };
    }
    return {
      ok: true,
      input: {
        ...base,
        description: describe(name, amount),
        conditions: [{ kind: "erc1155", chainId: meta.chainId, contract: meta.contract, minRaw: amount.replace(/^0+(?=\d)/, ""), tokenIds: [tokenId] }],
      },
    };
  }
  // ERC-721: 持っている数ではなく「1つ以上持っている」だけを条件にできる（既存の門の形）。
  if (amount !== "1") {
    return { ok: false, code: "amount", message: "NFT（ERC-721）は「1枚以上持っている」だけが条件にできます。必要な枚数は1にしてください。" };
  }
  if (tokenId && (!/^\d+$/.test(tokenId) || tokenId.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS)) {
    return { ok: false, code: "token_id", message: "トークンIDは数字だけで入力してください。" };
  }
  return {
    ok: true,
    input: {
      ...base,
      description: describe(name, "1"),
      conditions: [{ kind: "erc721", chainId: meta.chainId, contract: meta.contract, tokenIds: tokenId ? [tokenId] : [] }],
    },
  };
}

/* ---- 鍵付きカードの文言 ---- */

export function passHeadline(tokenName: string, amount: string): string {
  return `この内容は${tokenName}を${amount}枚持っている人が見られます`;
}

export function gohoBuyLabel(tokenName: string): string {
  return `gohotokenで${tokenName}を買う`;
}

export const EXTERNAL_ACQUISITION_LABEL = "入手先を開く（Hubの外へ移動します）";
