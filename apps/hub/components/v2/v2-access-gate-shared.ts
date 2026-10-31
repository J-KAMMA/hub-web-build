import {
  ACCESS_GATE_CHAIN_IDS,
  ACCESS_GATE_MAX_CONDITIONS,
  ACCESS_GATE_MAX_DESCRIPTION_LENGTH,
  ACCESS_GATE_MAX_MIN_RAW_DIGITS,
  ACCESS_GATE_MAX_TOKEN_IDS,
  type AccessGateCondition,
  type AccessGateConditionInput,
  type AccessGateConditionKind,
  type AccessGateInput,
  type AccessGateMatch,
  type AccessGateTargetType,
  isSolanaGateKind,
} from "@/lib/access-gates/types";
import { evmChainLabel } from "@/lib/chains/evm-chain-registry";
import { SOLANA_DEVNET_REF, SOLANA_MAINNET_REF } from "@/lib/chains/solana-chain-registry";

/* 門の画面で共有する純粋関数。サーバー側の検証は lib/server/access-gates.ts が正本で、ここは入力時の早期の知らせ。 */

export const ACCESS_GATE_CHAIN_NAMES: Record<number, string> = Object.fromEntries(
  ACCESS_GATE_CHAIN_IDS.map((chainId) => [chainId, evmChainLabel(chainId)]),
);

export const ACCESS_GATE_KIND_LABELS: Record<AccessGateConditionKind, string> = {
  erc20: "ERC-20（代替性トークン）",
  erc721: "ERC-721（NFT）",
  erc1155: "ERC-1155（マルチトークン）",
  sol_native: "SOL（Solanaのネイティブ）",
  spl: "SPLトークン（Solana）",
  spl_mints: "SPL NFT（Solana・いずれか）",
  btc_native: "BTC（Bitcoinのネイティブ・承認済み残高）",
};

function bitcoinNetworkLabel(chainRef: string | undefined): string {
  if (chainRef?.startsWith("bip122:00000000da84f2bafbbc53dee25a72ae")) return "Bitcoin Testnet4";
  if (chainRef?.startsWith("bip122:00000008819873e925422c1ff0f99f7c")) return "Bitcoin Signet";
  return "Bitcoin";
}

function solanaNetworkLabel(chainRef: string | undefined): string {
  return chainRef?.startsWith("solana:EtWTRABZ") ? "Solana Devnet" : "Solana";
}

/** Solana networks a gate editor offers. The server still refuses mainnet until its RPC is configured. */
export const SOLANA_GATE_NETWORK_OPTIONS: ReadonlyArray<{ chainRef: string; name: string }> = [
  { chainRef: SOLANA_DEVNET_REF, name: "Solana Devnet（テストネット）" },
  { chainRef: SOLANA_MAINNET_REF, name: "Solana（メインネット）" },
];

const SOLANA_ADDRESS_TEXT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function chainName(chainId: number): string {
  return ACCESS_GATE_CHAIN_NAMES[chainId] ?? `チェーン ${chainId}（未対応）`;
}

export function chainOptions(): { chainId: number; name: string }[] {
  return ACCESS_GATE_CHAIN_IDS.map((chainId) => ({ chainId, name: chainName(chainId) }));
}

/** 「1.5」と 18 桁 → "1500000000000000000"。表せない入力は null。 */
export function humanToRaw(amount: string, decimals: number): string | null {
  const text = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > decimals) return null;
  return (whole + fraction.padEnd(decimals, "0")).replace(/^0+(?=\d)/, "");
}

/** 生の整数文字列 → 人が読む量。decimals が無ければそのまま。 */
export function rawToHuman(minRaw: string, decimals: number | null): string {
  if (decimals === null || decimals <= 0 || !/^\d+$/.test(minRaw)) return minRaw;
  const padded = minRaw.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function shortContract(contract: string): string {
  return contract.length > 12 ? `${contract.slice(0, 6)}…${contract.slice(-4)}` : contract;
}

/** 鍵付きカードと一覧で使う、条件1つの平文。 */
export function summarizeCondition(condition: AccessGateCondition): string {
  if (condition.kind === "btc_native") {
    return `${bitcoinNetworkLabel(condition.chainRef)} の BTC を ${rawToHuman(condition.minRaw, 8)} 以上持っている（承認済みの残高のみ）`;
  }
  if (condition.kind === "sol_native") {
    return `${solanaNetworkLabel(condition.chainRef)} の SOL を ${rawToHuman(condition.minRaw, 9)} 以上持っている`;
  }
  if (condition.kind === "spl") {
    return `${solanaNetworkLabel(condition.chainRef)} の ${shortContract(condition.contract)} を ${rawToHuman(condition.minRaw, condition.decimals)} 以上持っている`;
  }
  if (condition.kind === "spl_mints") {
    return `${solanaNetworkLabel(condition.chainRef)} の ${condition.tokenIds.length} 件のNFTのどれかを持っている`;
  }
  const chain = chainName(condition.chainId);
  const contract = shortContract(condition.contract);
  if (condition.kind === "erc20") {
    return `${chain} の ${contract} を ${rawToHuman(condition.minRaw, condition.decimals)} 以上持っている`;
  }
  if (condition.kind === "erc721") {
    return condition.tokenIds.length > 0
      ? `${chain} の ${contract} のトークンID ${condition.tokenIds.join("・")} のどれかを持っている`
      : `${chain} の ${contract} を1つ以上持っている`;
  }
  return `${chain} の ${contract} のトークンID ${condition.tokenIds[0] ?? "?"} を ${condition.minRaw} 個以上持っている`;
}

export function matchLabel(match: AccessGateMatch): string {
  return match === "all" ? "次の条件をすべて満たす" : "次の条件のどれか1つを満たす";
}

/* ---- 編集フォーム ---- */

export type ConditionDraft = {
  key: string;
  kind: AccessGateConditionKind;
  chainId: number;
  /** Solana の種類だけ使う（CAIP-2）。空なら Devnet。 */
  chainRef?: string;
  /** erc*: コントラクト。spl: ミントアドレス */
  contract: string;
  /** erc20 と sol_native と spl: 人が読む量。erc1155: 個数。erc721: 未使用 */
  amount: string;
  decimals: string;
  /** 区切りは空白・読点・カンマ */
  tokenIds: string;
};

export type GateDraft = {
  match: AccessGateMatch;
  description: string;
  acquisitionUrl: string;
  conditions: ConditionDraft[];
};

let draftKey = 0;
export function emptyCondition(): ConditionDraft {
  draftKey += 1;
  return { key: `c${draftKey}`, kind: "erc20", chainId: ACCESS_GATE_CHAIN_IDS[0], contract: "", amount: "", decimals: "18", tokenIds: "" };
}

export function emptyGateDraft(): GateDraft {
  return { match: "any", description: "", acquisitionUrl: "", conditions: [emptyCondition()] };
}

export function parseTokenIds(text: string): string[] {
  return text.split(/[\s,、]+/u).map((value) => value.trim()).filter(Boolean);
}

export type GateDraftResult =
  | { ok: true; input: AccessGateInput }
  | { ok: false; errors: string[] };

export function validateGateDraft(draft: GateDraft): GateDraftResult {
  const errors: string[] = [];
  const description = draft.description.trim();
  if (description.length > ACCESS_GATE_MAX_DESCRIPTION_LENGTH) {
    errors.push(`説明は${ACCESS_GATE_MAX_DESCRIPTION_LENGTH}字までです。`);
  }
  const link = draft.acquisitionUrl.trim();
  if (link) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(link);
    } catch {
      parsed = null;
    }
    if (!parsed || parsed.protocol !== "https:") errors.push("入手先リンクはhttpsのURLだけ指定できます。");
    else if (parsed.username || parsed.password) errors.push("入手先リンクに認証情報は含められません。");
  }
  if (draft.conditions.length === 0) errors.push("条件を1つ以上追加してください。");
  if (draft.conditions.length > ACCESS_GATE_MAX_CONDITIONS) errors.push(`条件は${ACCESS_GATE_MAX_CONDITIONS}つまでです。`);

  const conditions: AccessGateConditionInput[] = [];
  draft.conditions.forEach((condition, index) => {
    const label = `条件${index + 1}`;
    if (isSolanaGateKind(condition.kind)) {
      const chainRef = condition.chainRef || SOLANA_DEVNET_REF;
      if (!SOLANA_GATE_NETWORK_OPTIONS.some((option) => option.chainRef === chainRef)) {
        errors.push(`${label}: 未対応のネットワークです。`);
        return;
      }
      if (condition.kind === "spl_mints") {
        const mints = parseTokenIds(condition.tokenIds);
        if (mints.length === 0 || mints.length > ACCESS_GATE_MAX_TOKEN_IDS || mints.some((mint) => !SOLANA_ADDRESS_TEXT.test(mint))) {
          errors.push(`${label}: ミントアドレスを1〜${ACCESS_GATE_MAX_TOKEN_IDS}件、空白かカンマで区切って入力してください。`);
          return;
        }
        if (new Set(mints).size !== mints.length) {
          errors.push(`${label}: ミントが重複しています。`);
          return;
        }
        conditions.push({ kind: "spl_mints", chainId: 0, chainRef, contract: mints[0], minRaw: "1", tokenIds: mints });
        return;
      }
      const decimals = condition.kind === "sol_native" ? 9 : Number(condition.decimals);
      if (condition.kind === "spl" && (!/^\d+$/.test(condition.decimals.trim()) || decimals > 36)) {
        errors.push(`${label}: 小数桁数は0〜36の整数で入力してください。`);
        return;
      }
      if (condition.kind === "spl" && !SOLANA_ADDRESS_TEXT.test(condition.contract.trim())) {
        errors.push(`${label}: ミントアドレスを入力してください。`);
        return;
      }
      const raw = humanToRaw(condition.amount, decimals);
      if (raw === null || /^0+$/.test(raw) || raw.length > 20) {
        errors.push(`${label}: 量は0より大きく、小数桁数以内の数字で入力してください。`);
        return;
      }
      if (condition.kind === "sol_native") conditions.push({ kind: "sol_native", chainId: 0, chainRef, contract: "", minRaw: raw, decimals: 9 });
      else conditions.push({ kind: "spl", chainId: 0, chainRef, contract: condition.contract.trim(), minRaw: raw, decimals });
      return;
    }
    if (!(ACCESS_GATE_CHAIN_IDS as readonly number[]).includes(condition.chainId)) {
      errors.push(`${label}: 未対応のチェーンです。`);
      return;
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(condition.contract.trim())) {
      errors.push(`${label}: コントラクトアドレスは0xで始まる42文字で入力してください。`);
      return;
    }
    const contract = condition.contract.trim().toLowerCase();
    const tokenIds = condition.kind === "erc20" ? [] : parseTokenIds(condition.tokenIds);
    if (tokenIds.some((id) => !/^\d+$/.test(id) || id.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS)) {
      errors.push(`${label}: トークンIDは数字だけで入力してください。`);
      return;
    }
    if (new Set(tokenIds).size !== tokenIds.length) {
      errors.push(`${label}: トークンIDが重複しています。`);
      return;
    }
    if (tokenIds.length > ACCESS_GATE_MAX_TOKEN_IDS) {
      errors.push(`${label}: トークンIDは${ACCESS_GATE_MAX_TOKEN_IDS}件までです。`);
      return;
    }
    if (condition.kind === "erc20") {
      const decimals = Number(condition.decimals);
      if (!/^\d+$/.test(condition.decimals.trim()) || decimals > 36) {
        errors.push(`${label}: 小数桁数は0〜36の整数で入力してください。`);
        return;
      }
      const raw = humanToRaw(condition.amount, decimals);
      if (raw === null) {
        errors.push(`${label}: 量は小数桁数以内の数字で入力してください。`);
        return;
      }
      if (/^0+$/.test(raw)) {
        errors.push(`${label}: 量は0より大きくしてください。`);
        return;
      }
      if (raw.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS) {
        errors.push(`${label}: 量が大きすぎます。`);
        return;
      }
      conditions.push({ kind: "erc20", chainId: condition.chainId, contract, minRaw: raw, decimals });
    } else if (condition.kind === "erc721") {
      conditions.push({ kind: "erc721", chainId: condition.chainId, contract, tokenIds });
    } else {
      if (tokenIds.length !== 1) {
        errors.push(`${label}: ERC-1155はトークンIDを1つだけ指定してください。`);
        return;
      }
      const amount = condition.amount.trim() || "1";
      if (!/^\d+$/.test(amount) || /^0+$/.test(amount) || amount.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS) {
        errors.push(`${label}: 個数は1以上の整数で入力してください。`);
        return;
      }
      conditions.push({ kind: "erc1155", chainId: condition.chainId, contract, minRaw: amount.replace(/^0+(?=\d)/, ""), tokenIds });
    }
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, input: { match: draft.match, description, acquisitionUrl: link || null, conditions } };
}

/* ---- 付け外し（保存のあとに呼ぶ） ---- */

export type AttachResult = { ok: true } | { ok: false; message: string };

export async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof payload?.error === "string" && payload.error ? payload.error : fallback;
}

/** gateId があれば付け、null なら外す。コンテンツの保存が成功したあとに呼ぶ。 */
export async function applyAccessGate(targetType: AccessGateTargetType, targetId: string, gateId: string | null): Promise<AttachResult> {
  try {
    const response = await fetch("/api/access-gates/attach", {
      method: gateId ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(gateId ? { targetType, targetId, gateId } : { targetType, targetId }),
    });
    if (!response.ok) return { ok: false, message: await readApiError(response, "閲覧条件を設定できませんでした。") };
    return { ok: true };
  } catch {
    return { ok: false, message: "通信できませんでした。" };
  }
}

export const VIDEO_REFERENCE_NOTE =
  "ハブの動画は外部サイト（YouTubeなど）への参照です。閲覧条件で隠せるのはハブ上の参照だけで、動画そのものは元のサイトのURLを知っている人なら見られます。";
export const STALE_ACCESS_NOTE = "トークンを手放してから閉じるまで、最大10分かかることがあります。";
