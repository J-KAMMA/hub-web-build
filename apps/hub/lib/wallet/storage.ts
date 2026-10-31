// Web版Hubウォレットの状態永続化（拡張機能の chrome.storage 相当を
// localStorage に置き換えたもの）。パスキー本体は認証器にのみ存在し、
// ここに保存されるのは credentialId・公開鍵・導出済みアドレスだけ。

import { DEFAULT_CHAIN_ID, normalizeChainId } from "./networks";

const STORAGE_KEY = "hub.native-wallet.v1";
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BYTES32 = /^0x[0-9a-fA-F]{64}$/;

export type ActiveSmartAccount = {
  address: string;
  activatedAt: string;
  userOperationHash?: string;
  transactionHash?: string;
};

// 送信済み・有効化済みの操作履歴（この端末ローカルの記録。口座の全履歴ではない）。
export type WalletActivity = {
  kind: "send" | "activate";
  chainId: string;
  transactionHash: string;
  to?: string;
  amount?: string;
  symbol?: string;
  at: string;
};

const ACTIVITY_LIMIT = 20;

export function recordWalletActivity(state: NativeWalletState, entry: WalletActivity): NativeWalletState {
  const list = [entry, ...(state.activity ?? [])]
    .filter((item) => item && typeof item.transactionHash === "string" && BYTES32.test(item.transactionHash))
    .slice(0, ACTIVITY_LIMIT);
  return { ...state, activity: list };
}

export type NativeWalletState = {
  version: 1;
  chainId: string;
  passkeyCredentialId: string;
  passkeyQx: string;
  passkeyQy: string;
  passkeySalt: string;
  createdAt: string;
  smartAccountAddresses: Record<string, string>;
  activeSmartAccounts: Record<string, ActiveSmartAccount>;
  bundlerUrls: Record<string, string>;
  activity?: WalletActivity[];
  gasPolicies?: Record<string, { preset?: string }>;
  // エンジンの署名器が参照するオプション（リカバリー署名は未使用）。
  allowRecoverySignature?: boolean;
};

export type StoredPasskey = {
  credentialId: string;
  qx: string;
  qy: string;
  createdAt: string;
};

function storageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readRaw(): Record<string, unknown> | null {
  if (!storageAvailable()) return null;
  try {
    const text = window.localStorage.getItem(STORAGE_KEY);
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function validHex32(value: unknown): value is string {
  return typeof value === "string" && BYTES32.test(value);
}

export function loadNativeWalletState(): NativeWalletState | null {
  const raw = readRaw();
  if (!raw || raw.version !== 1) return null;
  if (typeof raw.passkeyCredentialId !== "string" || raw.passkeyCredentialId.length < 8 || !validHex32(raw.passkeyQx) || !validHex32(raw.passkeyQy)) return null;
  let chainId: string;
  try {
    chainId = normalizeChainId(raw.chainId as string ?? DEFAULT_CHAIN_ID);
  } catch {
    return null;
  }
  const smartAccountAddresses: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.smartAccountAddresses as Record<string, unknown> ?? {})) {
    if (typeof value === "string" && ADDRESS.test(value)) {
      try { smartAccountAddresses[normalizeChainId(key)] = value.toLowerCase(); } catch { /* skip */ }
    }
  }
  const activeSmartAccounts: Record<string, ActiveSmartAccount> = {};
  for (const [key, value] of Object.entries(raw.activeSmartAccounts as Record<string, unknown> ?? {})) {
    const record = value as ActiveSmartAccount;
    if (record && typeof record.address === "string" && ADDRESS.test(record.address)) {
      try {
        activeSmartAccounts[normalizeChainId(key)] = { ...record, address: record.address.toLowerCase() };
      } catch { /* skip */ }
    }
  }
  const bundlerUrls: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw.bundlerUrls as Record<string, unknown> ?? {})) {
    if (typeof value === "string" && value.length <= 2048) {
      try { bundlerUrls[normalizeChainId(key)] = value; } catch { /* skip */ }
    }
  }
  const activity: WalletActivity[] = [];
  for (const item of (raw.activity as unknown[] ?? [])) {
    const entry = item as WalletActivity;
    if (entry && typeof entry.transactionHash === "string" && BYTES32.test(entry.transactionHash)
      && (entry.kind === "send" || entry.kind === "activate") && typeof entry.at === "string") {
      try {
        activity.push({ ...entry, chainId: normalizeChainId(entry.chainId) });
      } catch { /* skip */ }
    }
  }
  return {
    version: 1,
    chainId,
    passkeyCredentialId: raw.passkeyCredentialId,
    passkeyQx: raw.passkeyQx,
    passkeyQy: raw.passkeyQy,
    passkeySalt: typeof raw.passkeySalt === "string" ? raw.passkeySalt : "0x0",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : new Date().toISOString(),
    smartAccountAddresses,
    activeSmartAccounts,
    bundlerUrls,
    activity: activity.slice(0, ACTIVITY_LIMIT),
    gasPolicies: raw.gasPolicies as NativeWalletState["gasPolicies"],
  };
}

export function saveNativeWalletState(state: NativeWalletState) {
  if (!storageAvailable()) throw new Error("wallet_storage_unavailable");
  const persist = { ...state };
  delete persist.allowRecoverySignature;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persist));
}

export function clearNativeWalletState() {
  if (!storageAvailable()) return;
  window.localStorage.removeItem(STORAGE_KEY);
}

export function createInitialWalletState(passkey: StoredPasskey, chainId = DEFAULT_CHAIN_ID): NativeWalletState {
  return {
    version: 1,
    chainId,
    passkeyCredentialId: passkey.credentialId,
    passkeyQx: passkey.qx,
    passkeyQy: passkey.qy,
    passkeySalt: "0x0",
    createdAt: passkey.createdAt,
    smartAccountAddresses: {},
    activeSmartAccounts: {},
    bundlerUrls: {},
  };
}
