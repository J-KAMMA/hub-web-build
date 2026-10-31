/*
 * 持ち運べる身元（docs/hub-decentralization/DESIGN.md 2・3）。外部に依存しない純粋なモジュール。
 * ブラウザ・Workers・Node（--experimental-strip-types）の全部で同じ物が動く。import を足さないこと。
 *
 *   - 根鍵は利用者の P-256 鍵。公開鍵は did:key（multicodec p256-pub 0x1200、圧縮点）で表す。
 *   - 署名は W3C Data Integrity の ecdsa-jcs-2019（FEP-8b32）。RFC 8785 の正規化 JSON を使う。
 *   - Hub のサーバーは秘密鍵を作らず・預からず・回復しない。ここの sign* は利用者の端末（ブラウザ・Desktop）で呼ぶ。
 *     サーバー側は verify* と公開鍵の取り扱いだけを使う。
 *   - apps/federation/src/identity.ts に同じ検証の写しがある。両方が同じ試験ベクトルを通ることで、1バイトの違いも出さない。
 */

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export type P256PublicJwk = { kty: "EC"; crv: "P-256"; x: string; y: string };

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const P256_PRIME = 2n ** 256n - 2n ** 224n + 2n ** 192n + 2n ** 96n - 1n;
const P256_B = 0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604bn;
const MULTICODEC_P256_PUB = [0x80, 0x24];
export const DID_KEY_PREFIX = "did:key:";
export const AS_CONTEXT = "https://www.w3.org/ns/activitystreams";
export const DATA_INTEGRITY_CONTEXT = "https://w3id.org/security/data-integrity/v2";
export const CRYPTOSUITE = "ecdsa-jcs-2019";

const encoder = new TextEncoder();

export function bytesToB64u(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function b64uToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function base58btcEncode(bytes: Uint8Array): string {
  let leadingZeros = 0;
  while (leadingZeros < bytes.length && bytes[leadingZeros] === 0) leadingZeros += 1;
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);
  let out = "";
  while (number > 0n) {
    out = ALPHABET[Number(number % 58n)] + out;
    number /= 58n;
  }
  return "1".repeat(leadingZeros) + out;
}

export function base58btcDecode(value: string): Uint8Array {
  let number = 0n;
  for (const character of value) {
    const index = ALPHABET.indexOf(character);
    if (index < 0) throw new Error("invalid_base58");
    number = number * 58n + BigInt(index);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 0xffn));
    number >>= 8n;
  }
  let leadingOnes = 0;
  while (leadingOnes < value.length && value[leadingOnes] === "1") leadingOnes += 1;
  return Uint8Array.from([...new Array(leadingOnes).fill(0), ...bytes]);
}

function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n;
  let b = base % modulus;
  let e = exponent;
  while (e > 0n) {
    if (e & 1n) result = (result * b) % modulus;
    b = (b * b) % modulus;
    e >>= 1n;
  }
  return result;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let number = 0n;
  for (const byte of bytes) number = (number << 8n) | BigInt(byte);
  return number;
}

function bigIntTo32(number: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let rest = number;
  for (let index = 31; index >= 0; index -= 1) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

/** 圧縮点（0x02/0x03 + x）から JWK を作る。曲線上に無い点は拒む。 */
function jwkFromCompressedPoint(point: Uint8Array): P256PublicJwk {
  if (point.length !== 33 || (point[0] !== 2 && point[0] !== 3)) throw new Error("invalid_p256_point");
  const x = bytesToBigInt(point.slice(1));
  if (x >= P256_PRIME) throw new Error("invalid_p256_point");
  const rhs = (((x * x) % P256_PRIME) * x - 3n * x + P256_B) % P256_PRIME;
  const right = (rhs + P256_PRIME) % P256_PRIME;
  let y = modPow(right, (P256_PRIME + 1n) / 4n, P256_PRIME);
  if ((y * y) % P256_PRIME !== right) throw new Error("invalid_p256_point");
  if (Number(y & 1n) !== (point[0] & 1)) y = P256_PRIME - y;
  return { kty: "EC", crv: "P-256", x: bytesToB64u(bigIntTo32(x)), y: bytesToB64u(bigIntTo32(y)) };
}

function compressedPointFromJwk(jwk: { x?: string; y?: string }): Uint8Array {
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string") throw new Error("invalid_jwk");
  const x = b64uToBytes(jwk.x);
  const y = b64uToBytes(jwk.y);
  if (x.length !== 32 || y.length !== 32) throw new Error("invalid_jwk");
  return Uint8Array.from([y[31] & 1 ? 3 : 2, ...x]);
}

/** actor の assertionMethod（Multikey）に載せる文字列。did:key の `did:key:` を除いた部分と同じ。 */
export function multibaseFromJwk(jwk: { x?: string; y?: string }): string {
  return `z${base58btcEncode(Uint8Array.from([...MULTICODEC_P256_PUB, ...compressedPointFromJwk(jwk)]))}`;
}

export function didKeyFromJwk(jwk: { x?: string; y?: string }): string {
  return `${DID_KEY_PREFIX}${multibaseFromJwk(jwk)}`;
}

export function jwkFromMultibase(value: string): P256PublicJwk {
  if (!value.startsWith("z")) throw new Error("invalid_multibase");
  const bytes = base58btcDecode(value.slice(1));
  if (bytes.length !== 35 || bytes[0] !== MULTICODEC_P256_PUB[0] || bytes[1] !== MULTICODEC_P256_PUB[1]) {
    throw new Error("unsupported_key_type");
  }
  return jwkFromCompressedPoint(bytes.slice(2));
}

export function jwkFromDidKey(did: string): P256PublicJwk {
  if (!isDidKey(did)) throw new Error("invalid_did_key");
  return jwkFromMultibase(did.slice(DID_KEY_PREFIX.length));
}

export function isDidKey(value: unknown): value is string {
  return typeof value === "string" && /^did:key:zDn[1-9A-HJ-NP-Za-km-z]{40,60}$/.test(value);
}

/* ---------------------------------------------------------------- RFC 8785 */

export function jcs(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("jcs_non_finite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => jcs(entry)).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${jcs(entry)}`).join(",")}}`;
  }
  throw new Error("jcs_unsupported_value");
}

/* ---------------------------------------------------------------- Data Integrity ecdsa-jcs-2019 */

type Proof = {
  type: "DataIntegrityProof";
  cryptosuite: typeof CRYPTOSUITE;
  created: string;
  verificationMethod: string;
  proofPurpose: "assertionMethod";
  proofValue: string;
  "@context"?: unknown;
};

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

async function hashData(documentWithoutProof: JsonRecord, proofConfig: JsonRecord): Promise<Uint8Array> {
  const configHash = await sha256(jcs(proofConfig));
  const documentHash = await sha256(jcs(documentWithoutProof));
  return Uint8Array.from([...configHash, ...documentHash]);
}

function proofConfigFor(document: JsonRecord, did: string, created: string): JsonRecord {
  return {
    ...(document["@context"] !== undefined ? { "@context": document["@context"] } : {}),
    type: "DataIntegrityProof",
    cryptosuite: CRYPTOSUITE,
    created,
    verificationMethod: `${did}#${did.slice(DID_KEY_PREFIX.length)}`,
    proofPurpose: "assertionMethod",
  };
}

export async function generateRootKey(extractable = true): Promise<{ privateKey: CryptoKey; publicKey: CryptoKey; publicJwk: P256PublicJwk; did: string }> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, extractable, ["sign", "verify"]) as CryptoKeyPair;
  const exported = await crypto.subtle.exportKey("jwk", pair.publicKey) as JsonWebKey;
  const publicJwk: P256PublicJwk = { kty: "EC", crv: "P-256", x: String(exported.x), y: String(exported.y) };
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, publicJwk, did: didKeyFromJwk(publicJwk) };
}

/** 端末で呼ぶ。document に proof を付けた新しい物を返す（元は変えない）。 */
export async function signDocument<T extends JsonRecord>(document: T, privateKey: CryptoKey, did: string, created = new Date().toISOString()): Promise<T & { proof: Proof }> {
  const { proof: _ignored, ...plain } = document as JsonRecord;
  void _ignored;
  const config = proofConfigFor(plain, did, created);
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    await hashData(plain, config),
  ));
  const proof = { ...config, proofValue: `z${base58btcEncode(signature)}` } as unknown as Proof;
  return { ...(plain as T), proof };
}

export type VerifyResult = { ok: true; did: string } | { ok: false; reason: string };

export async function verifyDocument(document: unknown, options: { expectedDid?: string } = {}): Promise<VerifyResult> {
  if (!document || typeof document !== "object" || Array.isArray(document)) return { ok: false, reason: "not_an_object" };
  const { proof, ...plain } = document as JsonRecord;
  if (!proof || typeof proof !== "object" || Array.isArray(proof)) return { ok: false, reason: "proof_missing" };
  const p = proof as JsonRecord;
  if (p.type !== "DataIntegrityProof" || p.cryptosuite !== CRYPTOSUITE || p.proofPurpose !== "assertionMethod") return { ok: false, reason: "proof_unsupported" };
  if (typeof p.verificationMethod !== "string" || typeof p.proofValue !== "string" || typeof p.created !== "string") return { ok: false, reason: "proof_malformed" };
  const [did, fragment, ...extra] = p.verificationMethod.split("#");
  if (extra.length || !isDidKey(did) || (fragment !== undefined && fragment !== did.slice(DID_KEY_PREFIX.length))) return { ok: false, reason: "verification_method_invalid" };
  if (options.expectedDid && did !== options.expectedDid) return { ok: false, reason: "key_mismatch" };
  if (!p.proofValue.startsWith("z")) return { ok: false, reason: "proof_malformed" };
  try {
    const signature = base58btcDecode(p.proofValue.slice(1));
    if (signature.length !== 64) return { ok: false, reason: "proof_malformed" };
    const key = await crypto.subtle.importKey("jwk", jwkFromDidKey(did), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    const config: JsonRecord = {
      ...(p["@context"] !== undefined ? { "@context": p["@context"] as JsonValue } : {}),
      type: p.type, cryptosuite: p.cryptosuite, created: p.created,
      verificationMethod: p.verificationMethod, proofPurpose: p.proofPurpose,
    };
    const valid = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, await hashData(plain as JsonRecord, config));
    return valid ? { ok: true, did } : { ok: false, reason: "signature_invalid" };
  } catch {
    return { ok: false, reason: "proof_malformed" };
  }
}

/* ---------------------------------------------------------------- 文書の作り方 */

export function buildRootKeyRegistration(input: { actor: string; did: string; issuedAt?: string }): JsonRecord {
  return {
    "@context": [AS_CONTEXT, DATA_INTEGRITY_CONTEXT],
    type: "HubRootKeyRegistration",
    actor: input.actor,
    rootKey: input.did,
    issuedAt: input.issuedAt ?? new Date().toISOString(),
  };
}

export function buildMoveStatement(input: { oldActor: string; newActor: string; published?: string; id?: string }): JsonRecord {
  return {
    "@context": [AS_CONTEXT, DATA_INTEGRITY_CONTEXT],
    id: input.id ?? `${input.oldActor}/moves/${crypto.randomUUID()}`,
    type: "Move",
    actor: input.oldActor,
    object: input.oldActor,
    target: input.newActor,
    published: input.published ?? new Date().toISOString(),
  };
}

/* ---------------------------------------------------------------- 書き出しの束 hub.account.bundle v2 */

export const BUNDLE_PROTOCOL = "hub.account.bundle";
export const BUNDLE_VERSION = 2;
export const BUNDLE_MAX_POSTS = 20_000;
export const BUNDLE_MAX_CONTACTS = 20_000;

export type BundlePost = {
  originalId: string;
  published: string;
  content: string;
  inReplyTo: string | null;
  attachments: Array<{ sha256: string; path: string }>;
  /** Who could read the post on the exporting Hub. Absent or unrecognised means `followers` on import: an importer never widens. */
  audience?: "public" | "followers";
  proof?: Proof;
};

export type AccountBundle = {
  protocol: typeof BUNDLE_PROTOCOL;
  version: typeof BUNDLE_VERSION;
  exportedAt: string;
  subject: { actor: string; rootKey: string | null };
  profile: { handle: string; displayName: string; summary: string; avatar: { sha256: string; path: string } | null };
  following: Array<{ actor: string; since: string | null }>;
  followers: Array<{ actor: string; inbox: string | null }>;
  posts: BundlePost[];
  communities: Array<{ group: string; role: "member" }>;
  settings: { lists: JsonValue[]; bookmarks: JsonValue[]; mutedTerms: string[] };
  nodeEvents: JsonValue[];
  bundleProof?: Proof;
};

/*
 * 束に入れてはいけない物の鍵名（AGENTS.md の移転の規則）。見つかれば書き出しも取り込みも失敗させる。
 * 本文・要約・表示名の「文字列の中身」は利用者の文章なので、鍵名だけを調べる。
 */
const FORBIDDEN_KEYS = new Set([
  "profileid", "profile_id", "sourceprofileid", "hubprofileid", "localprofileid", "authorprofileid",
  "accountid", "account_id", "accountsubject", "account_subject", "pairwisesubject", "pairwise_subject", "subjectid",
  "wallet", "wallets", "walletaddress", "wallet_address", "walletlinks", "address", "addresses",
  "email", "emailaddress", "email_address", "emails", "phone", "phonenumber", "phone_number",
  "dm", "dms", "directmessages", "direct_messages", "conversations", "conversationid", "messages", "inbox_messages",
  "vault", "vaultid", "music", "musicid", "mail", "mailbox", "ai", "aimemories", "commerce", "commerceid", "identity", "identityid",
  "kyc", "legalname", "legal_name", "passkey", "passkeys", "session", "sessions", "password", "privatekey", "private_key", "mnemonic", "seed",
]);
const PROSE_KEYS = new Set(["content", "summary", "displayname", "name", "bio"]);

function structuralValueProblem(value: string): string | null {
  if (/^0x[0-9a-fA-F]{40}$/.test(value)) return "wallet_address_value";
  if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(value)) return "email_value";
  return null;
}

/** 禁止の鍵名・値が入っていれば、その場所を返す。無ければ null。 */
export function findForbiddenContent(value: unknown, path = "$"): string | null {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenContent(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const lower = key.toLowerCase();
      if (FORBIDDEN_KEYS.has(lower)) return `${path}.${key}`;
      if (typeof entry === "string" && !PROSE_KEYS.has(lower) && key !== "inbox") {
        const problem = structuralValueProblem(entry);
        if (problem) return `${path}.${key}:${problem}`;
      }
      const found = findForbiddenContent(entry, `${path}.${key}`);
      if (found) return found;
    }
  }
  return null;
}

function isHttpUrl(value: unknown, max = 2048): value is string {
  if (typeof value !== "string" || value.length > max) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

function isIso(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));
}

export type BundleCheck =
  | { ok: true; signed: boolean; rootKey: string | null; postsSigned: number }
  | { ok: false; error: string; detail?: string };

/** 構造・禁止項目・署名を検査する。1か所でも不正なら束全体を拒む（一部だけ取り込まない）。 */
export async function verifyBundle(input: unknown): Promise<BundleCheck> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "bundle_malformed" };
  const bundle = input as Record<string, unknown>;
  if (bundle.protocol !== BUNDLE_PROTOCOL) return { ok: false, error: "bundle_protocol_unsupported" };
  if (bundle.version !== BUNDLE_VERSION) return { ok: false, error: "bundle_version_unsupported" };
  const forbidden = findForbiddenContent(bundle);
  if (forbidden) return { ok: false, error: "bundle_contains_forbidden_data", detail: forbidden };
  if (!isIso(bundle.exportedAt)) return { ok: false, error: "bundle_malformed", detail: "exportedAt" };

  const subject = bundle.subject as Record<string, unknown> | undefined;
  if (!subject || !isHttpUrl(subject.actor) || (subject.rootKey !== null && !isDidKey(subject.rootKey))) {
    return { ok: false, error: "bundle_malformed", detail: "subject" };
  }
  const profile = bundle.profile as Record<string, unknown> | undefined;
  if (!profile || typeof profile.handle !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(profile.handle) ||
      typeof profile.displayName !== "string" || profile.displayName.length > 200 ||
      typeof profile.summary !== "string" || profile.summary.length > 5000) {
    return { ok: false, error: "bundle_malformed", detail: "profile" };
  }
  for (const [name, limit] of [["following", BUNDLE_MAX_CONTACTS], ["followers", BUNDLE_MAX_CONTACTS], ["posts", BUNDLE_MAX_POSTS]] as const) {
    if (!Array.isArray(bundle[name]) || (bundle[name] as unknown[]).length > limit) return { ok: false, error: "bundle_malformed", detail: name };
  }
  for (const entry of bundle.following as unknown[]) {
    const item = entry as Record<string, unknown> | null;
    if (!item || !isHttpUrl(item.actor)) return { ok: false, error: "bundle_malformed", detail: "following" };
  }
  for (const entry of bundle.followers as unknown[]) {
    const item = entry as Record<string, unknown> | null;
    if (!item || !isHttpUrl(item.actor) || (item.inbox != null && !isHttpUrl(item.inbox))) return { ok: false, error: "bundle_malformed", detail: "followers" };
  }
  const rootKey = subject.rootKey as string | null;
  const seen = new Set<string>();
  let postsSigned = 0;
  for (const entry of bundle.posts as unknown[]) {
    const post = entry as Record<string, unknown> | null;
    if (!post || !isHttpUrl(post.originalId) || !isIso(post.published) || typeof post.content !== "string" ||
        post.content.length > 20_000 || (post.inReplyTo != null && !isHttpUrl(post.inReplyTo)) ||
        !Array.isArray(post.attachments) || post.attachments.length > 16) {
      return { ok: false, error: "bundle_malformed", detail: "posts" };
    }
    if (seen.has(post.originalId)) return { ok: false, error: "bundle_malformed", detail: "duplicate_post" };
    seen.add(post.originalId);
    if (post.proof !== undefined) {
      if (!rootKey) return { ok: false, error: "post_proof_without_root_key" };
      const result = await verifyDocument(post, { expectedDid: rootKey });
      if (!result.ok) return { ok: false, error: "post_proof_invalid", detail: `${post.originalId}:${result.reason}` };
      postsSigned += 1;
    }
  }
  if (bundle.bundleProof !== undefined) {
    if (!rootKey) return { ok: false, error: "bundle_proof_without_root_key" };
    const { bundleProof, ...rest } = bundle;
    const result = await verifyDocument({ ...rest, proof: bundleProof }, { expectedDid: rootKey });
    if (!result.ok) return { ok: false, error: "bundle_proof_invalid", detail: result.reason };
    return { ok: true, signed: true, rootKey, postsSigned };
  }
  return { ok: true, signed: false, rootKey: null, postsSigned };
}

/** 端末で呼ぶ。各投稿に証明を付け、束全体にも署名する。 */
export async function signBundle(draft: Omit<AccountBundle, "bundleProof">, privateKey: CryptoKey, did: string): Promise<AccountBundle> {
  const posts: BundlePost[] = [];
  for (const post of draft.posts) {
    const { proof: _old, ...plain } = post;
    void _old;
    posts.push(await signDocument(plain as unknown as JsonRecord, privateKey, did) as unknown as BundlePost);
  }
  const body = { ...draft, subject: { ...draft.subject, rootKey: did }, posts } as unknown as JsonRecord;
  const signed = await signDocument(body, privateKey, did);
  const { proof, ...rest } = signed;
  return { ...(rest as unknown as Omit<AccountBundle, "bundleProof">), bundleProof: proof } as AccountBundle;
}

/* ---------------------------------------------------------------- 回復ファイル・包み（端末だけで使う） */

export type WrappedKey = { v: 1; kind: "passkey-prf" | "recovery-passphrase"; salt: string; iv: string; ciphertext: string; did: string; kdf?: { name: "PBKDF2"; iterations: number } };

async function aesKeyFromSecret(secret: Uint8Array, salt: Uint8Array, usage: "wrap" | "unwrap", iterations?: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", secret as BufferSource, iterations ? "PBKDF2" : "HKDF", false, ["deriveKey"]);
  const algorithm = iterations
    ? { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }
    : { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: encoder.encode("hub.root-key.wrap.v1") };
  return crypto.subtle.deriveKey(algorithm, material, { name: "AES-GCM", length: 256 }, false, usage === "wrap" ? ["encrypt"] : ["decrypt"]);
}

/** 秘密鍵（pkcs8）を AES-GCM で包む。secret はパスキー PRF の出力、またはパスフレーズ。サーバーへは送らない。 */
export async function wrapPrivateKey(privateKey: CryptoKey, did: string, secret: Uint8Array, kind: WrappedKey["kind"], iterations = 600_000): Promise<WrappedKey> {
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", privateKey) as ArrayBuffer);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const usePassphrase = kind === "recovery-passphrase";
  const key = await aesKeyFromSecret(secret, salt, "wrap", usePassphrase ? iterations : undefined);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(did) }, key, pkcs8));
  return {
    v: 1, kind, salt: bytesToB64u(salt), iv: bytesToB64u(iv), ciphertext: bytesToB64u(ciphertext), did,
    ...(usePassphrase ? { kdf: { name: "PBKDF2" as const, iterations } } : {}),
  };
}

export async function unwrapPrivateKey(wrapped: WrappedKey, secret: Uint8Array): Promise<CryptoKey> {
  const key = await aesKeyFromSecret(secret, b64uToBytes(wrapped.salt), "unwrap", wrapped.kdf?.iterations);
  const pkcs8 = new Uint8Array(await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: b64uToBytes(wrapped.iv) as BufferSource, additionalData: encoder.encode(wrapped.did) },
    key,
    b64uToBytes(wrapped.ciphertext) as BufferSource,
  ));
  return crypto.subtle.importKey("pkcs8", pkcs8 as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
}

export function passphraseBytes(passphrase: string): Uint8Array {
  return encoder.encode(passphrase.normalize("NFKC"));
}
