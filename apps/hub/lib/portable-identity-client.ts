/*
 * 根鍵の端末側の扱い（DESIGN.md 2.3）。ブラウザだけで動く。サーバーへは公開鍵と、根鍵が署名した文書しか送らない。
 *
 *  - 鍵はブラウザで作る。秘密鍵（pkcs8）は、パスキーの PRF 出力で AES-GCM に包んで localStorage に置く。
 *    PRF が使えない端末は、パスフレーズで包む（毎回パスフレーズを入れる）。
 *  - 回復ファイル（パスフレーズで暗号化）の書き出しは必須。作った直後にダウンロードさせ、保存したと答えるまで公開できない。
 *  - Hub のサーバーは、この鍵を作らず・預からず・回復しない。端末と回復ファイルを失えば、鍵は戻らない。
 *  - 名前空間は hub. （AGENTS.md の保存キーの規則）。
 */

import {
  buildMoveStatement,
  buildRootKeyRegistration,
  generateRootKey,
  passphraseBytes,
  signBundle,
  signDocument,
  unwrapPrivateKey,
  wrapPrivateKey,
  b64uToBytes,
  bytesToB64u,
  type AccountBundle,
  type JsonRecord,
  type WrappedKey,
} from "@/lib/portable-identity";

const STORAGE_KEY = "hub.rootKey.v1";
const PRF_SALT = new TextEncoder().encode("hub.root-key.prf.v1");

export type StoredRootKey = {
  v: 1;
  did: string;
  wrapped: WrappedKey;
  credentialId?: string;
  /** 回復ファイルを書き出したか。false の間は公開できない。 */
  recoverySaved: boolean;
};

export type RecoveryFile = {
  format: "hub.root-key.recovery";
  v: 1;
  did: string;
  wrapped: WrappedKey;
  createdAt: string;
};

export function readStoredRootKey(): StoredRootKey | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRootKey;
    return parsed?.v === 1 && typeof parsed.did === "string" && parsed.wrapped ? parsed : null;
  } catch {
    return null;
  }
}

function writeStoredRootKey(value: StoredRootKey | null) {
  try {
    if (value) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error("storage_unavailable");
  }
}

export function forgetStoredRootKey() {
  writeStoredRootKey(null);
}

export function markRecoverySaved() {
  const stored = readStoredRootKey();
  if (stored) writeStoredRootKey({ ...stored, recoverySaved: true });
}

/* ---------------------------------------------------------------- パスキー PRF */

type PrfResults = { first?: ArrayBuffer };
type PrfExtensionOutput = { enabled?: boolean; results?: PrfResults };

function randomChallenge(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function passkeyPrfSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential !== "undefined" && Boolean(navigator.credentials?.create);
}

async function prfFromAssertion(credentialId: Uint8Array): Promise<Uint8Array> {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge() as BufferSource,
      allowCredentials: [{ type: "public-key", id: credentialId as BufferSource }],
      userVerification: "required",
      extensions: { prf: { eval: { first: PRF_SALT as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;
  const output = (assertion?.getClientExtensionResults() as { prf?: PrfExtensionOutput } | undefined)?.prf;
  if (!output?.results?.first) throw new Error("prf_unavailable");
  return new Uint8Array(output.results.first);
}

/** PRF を評価できるパスキーを新しく作る。ログイン用の資格ではない（サーバーには何も送らない）。 */
async function createPrfPasskey(label: string): Promise<{ credentialId: Uint8Array; prf: Uint8Array }> {
  const created = await navigator.credentials.create({
    publicKey: {
      rp: { name: "Hub root key" },
      user: { id: crypto.getRandomValues(new Uint8Array(16)) as BufferSource, name: label, displayName: label },
      challenge: randomChallenge() as BufferSource,
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      extensions: { prf: { eval: { first: PRF_SALT as BufferSource } } } as AuthenticationExtensionsClientInputs,
    },
  }) as PublicKeyCredential | null;
  if (!created) throw new Error("passkey_cancelled");
  const output = (created.getClientExtensionResults() as { prf?: PrfExtensionOutput }).prf;
  if (!output?.enabled) throw new Error("prf_unavailable");
  const credentialId = new Uint8Array(created.rawId);
  const prf = output.results?.first ? new Uint8Array(output.results.first) : await prfFromAssertion(credentialId);
  return { credentialId, prf };
}

/* ---------------------------------------------------------------- 作る・開ける */

export type CreateResult = { did: string; stored: StoredRootKey; recovery: RecoveryFile; protection: "passkey" | "passphrase" };

/**
 * 根鍵を作り、端末に包んで保存し、回復ファイルの中身を返す（呼び出し側がダウンロードさせる）。
 * passphrase は回復ファイルの暗号化に必ず使う。PRF が使えなければ端末内の包みにも同じパスフレーズを使う。
 */
export async function createRootKeyOnDevice(input: { passphrase: string; label: string; preferPasskey?: boolean }): Promise<CreateResult> {
  if (input.passphrase.length < 12) throw new Error("passphrase_too_short");
  const key = await generateRootKey(true);
  const recoveryWrap = await wrapPrivateKey(key.privateKey, key.did, passphraseBytes(input.passphrase), "recovery-passphrase");
  let stored: StoredRootKey;
  let protection: "passkey" | "passphrase" = "passphrase";
  if (input.preferPasskey !== false && passkeyPrfSupported()) {
    try {
      const passkey = await createPrfPasskey(input.label);
      stored = {
        v: 1, did: key.did, recoverySaved: false,
        credentialId: bytesToB64u(passkey.credentialId),
        wrapped: await wrapPrivateKey(key.privateKey, key.did, passkey.prf, "passkey-prf"),
      };
      protection = "passkey";
    } catch {
      stored = { v: 1, did: key.did, recoverySaved: false, wrapped: recoveryWrap };
    }
  } else {
    stored = { v: 1, did: key.did, recoverySaved: false, wrapped: recoveryWrap };
  }
  writeStoredRootKey(stored);
  return {
    did: key.did, stored, protection,
    recovery: { format: "hub.root-key.recovery", v: 1, did: key.did, wrapped: recoveryWrap, createdAt: new Date().toISOString() },
  };
}

/** 保存済みの鍵を開く。パスキーならそれを求め、パスフレーズ包みなら passphrase を使う。 */
export async function unlockRootKey(passphrase?: string): Promise<{ privateKey: CryptoKey; did: string }> {
  const stored = readStoredRootKey();
  if (!stored) throw new Error("no_root_key");
  if (stored.wrapped.kind === "passkey-prf") {
    if (!stored.credentialId) throw new Error("no_root_key");
    const prf = await prfFromAssertion(b64uToBytes(stored.credentialId));
    return { privateKey: await unwrapPrivateKey(stored.wrapped, prf), did: stored.did };
  }
  if (!passphrase) throw new Error("passphrase_required");
  return { privateKey: await unwrapPrivateKey(stored.wrapped, passphraseBytes(passphrase)), did: stored.did };
}

/** 回復ファイルから鍵を戻し、この端末に包み直す。 */
export async function restoreRootKeyFromRecovery(file: unknown, passphrase: string, label: string): Promise<{ did: string; protection: "passkey" | "passphrase" }> {
  const recovery = file as RecoveryFile;
  if (!recovery || recovery.format !== "hub.root-key.recovery" || recovery.v !== 1 || !recovery.wrapped) throw new Error("recovery_file_invalid");
  // 包み直しには抽出可能な鍵が要る。パスフレーズが違えば、ここで復号に失敗する。
  const pkcs8 = await rewrapSource(recovery, passphrase);
  const extractable = await crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, true, ["sign"]);
  let stored: StoredRootKey;
  let protection: "passkey" | "passphrase" = "passphrase";
  if (passkeyPrfSupported()) {
    try {
      const passkey = await createPrfPasskey(label);
      stored = { v: 1, did: recovery.did, recoverySaved: true, credentialId: bytesToB64u(passkey.credentialId), wrapped: await wrapPrivateKey(extractable, recovery.did, passkey.prf, "passkey-prf") };
      protection = "passkey";
    } catch {
      stored = { v: 1, did: recovery.did, recoverySaved: true, wrapped: recovery.wrapped };
    }
  } else {
    stored = { v: 1, did: recovery.did, recoverySaved: true, wrapped: recovery.wrapped };
  }
  writeStoredRootKey(stored);
  return { did: recovery.did, protection };
}

async function rewrapSource(recovery: RecoveryFile, passphrase: string): Promise<Uint8Array> {
  const wrapped = recovery.wrapped;
  const material = await crypto.subtle.importKey("raw", passphraseBytes(passphrase) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  const aes = await crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: b64uToBytes(wrapped.salt) as BufferSource, iterations: wrapped.kdf?.iterations ?? 600_000 },
    material, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  return new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64uToBytes(wrapped.iv) as BufferSource, additionalData: new TextEncoder().encode(wrapped.did) },
    aes, b64uToBytes(wrapped.ciphertext) as BufferSource,
  ));
}

/* ---------------------------------------------------------------- サーバーとのやり取り（公開鍵と署名済み文書だけ） */

async function api<T>(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: T & { error?: string; code?: string } }> {
  const response = await fetch(path, {
    cache: "no-store", credentials: "same-origin",
    ...init,
    headers: { ...(init?.body ? { "content-type": "application/json" } : {}), ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as T & { error?: string; code?: string };
  return { ok: response.ok, status: response.status, body };
}

export type ServerIdentity = {
  actorUrl: string | null;
  rootKey: string | null;
  alsoKnownAs: string[];
  movedTo: string | null;
  moves: Array<{ newActor: string; movedAt: string; redirectUntil: string }>;
  importHints: { oldActor: string; followers: number; movedAt: string | null } | null;
};

export const portabilityApi = {
  identity: () => api<ServerIdentity>("/api/core/portability/identity"),
  draft: () => api<{ draft: Omit<AccountBundle, "bundleProof"> }>("/api/core/portability/bundle"),
  importBundle: (bundle: unknown, refollow: boolean) =>
    api<Record<string, unknown>>("/api/core/portability/import", { method: "POST", body: JSON.stringify({ bundle, refollow }) }),
  registerRootKey: (statement: unknown) =>
    api<{ rootKey: string }>("/api/core/portability/root-key", { method: "PUT", body: JSON.stringify({ statement }) }),
  removeRootKey: () => api<{ removed: boolean }>("/api/core/portability/root-key", { method: "DELETE" }),
  move: (target: string, move?: unknown) =>
    api<{ movedTo: string; notified: number; redirectUntil: string }>("/api/core/portability/move", { method: "POST", body: JSON.stringify({ target, ...(move ? { move } : {}) }) }),
  selfMove: (move: unknown) => api<{ delivered: number }>("/api/core/portability/self-move", { method: "POST", body: JSON.stringify({ move }) }),
};

/** 端末の鍵で公開鍵の登録文に署名して送る。回復ファイルの書き出しを済ませていなければ拒む。 */
export async function publishRootKey(unlock: { privateKey: CryptoKey; did: string }, actorUrl: string) {
  const stored = readStoredRootKey();
  if (!stored?.recoverySaved) throw new Error("recovery_file_not_saved");
  const statement = await signDocument(buildRootKeyRegistration({ actor: actorUrl, did: unlock.did }), unlock.privateKey, unlock.did);
  return portabilityApi.registerRootKey(statement);
}

/** 下書きを取り、端末の鍵で各投稿と束に署名して、保存用の JSON 文字列を返す。 */
export async function exportSignedBundle(unlock: { privateKey: CryptoKey; did: string }): Promise<{ json: string; posts: number } | { error: string }> {
  const draft = await portabilityApi.draft();
  if (!draft.ok) return { error: draft.body.code ?? draft.body.error ?? "draft_failed" };
  const signed = await signBundle(draft.body.draft, unlock.privateKey, unlock.did);
  return { json: JSON.stringify(signed), posts: signed.posts.length };
}

export async function signMoveFor(unlock: { privateKey: CryptoKey; did: string }, oldActor: string, newActor: string): Promise<JsonRecord> {
  return signDocument(buildMoveStatement({ oldActor, newActor }), unlock.privateKey, unlock.did) as unknown as Promise<JsonRecord>;
}
