import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import type { D1Database } from "@cloudflare/workers-types";

/*
 * Rights Desk（apps/rights）との境界を、この 1 ファイルに閉じる。署名する側と検証する側が同居する。
 * 形は PLAN 6.5 と共通ベクトル contracts/vectors/rights-request.v1.json に従う（Music・Rights Desk と同じ）。
 *
 *   Authorization: Bearer <JWT>、header は {"alg":"EdDSA","typ":"JWT"}、Ed25519。
 *   claims：iss / aud / purpose("rights.<action>") / jti(UUID) / iat / exp(整数・寿命 120 秒まで・ずれ 30 秒まで)
 *   / case / target、操作ごとに route・due(open)・outcome(close)・reason(500 字まで)。
 *   本文は認可に使わない。申告者の連絡先は claims にも本文にも入らない。
 *
 * 受け取り（Rights Desk → Hub）  POST /api/rights/cases  対象 1 件につき 1 要求、Music・Vault の対象も含む
 *   iss "jkamma-rights" → aud "jkamma-hub"、purpose は rights.open だけ。検証鍵は環境変数 RIGHTS_DESK_PUBLIC_KEY_SPKI
 *   （無ければ 503）。jti は 1 回きり（ハッシュで保存。保存先が使えなければ拒む）。route / due は受け取らない。
 *   本文 {v, caseId, targetId, service, targetUrl, claimantDisplayName, receivedAt, workDescription, claimBasis}。
 *
 * 出し（Hub → Rights Desk）  Hub 自身の Ed25519 鍵（HUB_RIGHTS_SIGNING_KEY_PKCS8）で署名、iss "jkamma-hub" → aud "jkamma-rights"
 *   - rights.outcome：Hub の対象が閉じたとき  POST {RIGHTS_DESK_URL}/rights/api/v1/cases/{case}/outcome
 *   - rights.<action>：Music・Vault の対象についての運営の判断  POST .../cases/{case}/decisions（本文なし）
 *   Hub は Music を直接呼ばない。判断のトークンは、運営の権限を確かめたあとに Hub が署名し、運営のブラウザ（または
 *   Hub の定期処理）が Rights Desk に送る。Rights Desk が署名し直して Music に出す。
 */

export const RIGHTS_ACTIONS = ["open", "hide", "object", "restore", "finalize", "close", "read"] as const;
export type RightsAction = (typeof RIGHTS_ACTIONS)[number];
export type RightsOutcome = "final" | "restored" | "kept" | "rejected" | "withdrawn";
export type RightsService = "hub" | "music" | "vault";

export const RIGHTS_ISSUER = "jkamma-rights";
export const HUB_AUDIENCE = "jkamma-hub";
export const HUB_ISSUER = "jkamma-hub";
export const RIGHTS_AUDIENCE = "jkamma-rights";
export const MAX_RIGHTS_REQUEST_LIFETIME_SECONDS = 120;
export const MAX_CLOCK_SKEW_SECONDS = 30;
const MAX_TOKEN_CHARACTERS = 4096;
const MAX_PUBLIC_KEY_CHARACTERS = 2048;
const CANONICAL_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CASE_ID = /^[A-Za-z0-9_-]{8,64}$/;
const TARGET_ID = /^[A-Za-z0-9_-]{1,128}$/;

/** 受け取る申告の本文のキー（共通ベクトルの hub.intakeBodyKeys と一致させる）。 */
export const INTAKE_BODY_KEYS = [
  "caseId", "claimBasis", "claimantDisplayName", "receivedAt", "service", "targetId", "targetUrl", "v", "workDescription",
] as const;

export type RightsClaims = {
  iss: string;
  aud: string;
  jti: string;
  iat: number;
  exp: number;
  action: string;
  caseId: string;
  target: string;
  route: "inquiry" | "immediate" | null;
  due: string | null;
  outcome: string | null;
  reason: string;
};
export type RightsDeskClaims = RightsClaims;

/** Rights Desk が対象 1 件ごとに送る申告の本文。認可には使わない。連絡先は含めない。 */
export type RightsDeskOpenBody = {
  v: 1;
  caseId: string;
  targetId: string;
  service: RightsService;
  targetUrl: string;
  claimantDisplayName: string;
  receivedAt: string;
  workDescription: string;
  claimBasis: string;
};

function base64(value: string) {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}
function base64Url(value: string) {
  return base64(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
}
function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type VerifyExpectation = {
  issuer: string;
  audience: string;
  /** 受け付ける操作。Hub の受付は ["open"] だけ。 */
  actions: readonly string[];
  /** purpose が rights.outcome のとき受け付ける結果。 */
  outcomePurposeOutcomes?: readonly string[];
};

/** Bearer の中身（JWT）を確かめて claims にする。どれか 1 つでも満たさなければ null。 */
export async function verifyRightsToken(
  token: string,
  publicKeySpkiBase64: string,
  expect: VerifyExpectation,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<RightsClaims | null> {
  try {
    if (!Number.isSafeInteger(nowSeconds) || token.length === 0 || token.length > MAX_TOKEN_CHARACTERS
      || publicKeySpkiBase64.length === 0 || publicKeySpkiBase64.length > MAX_PUBLIC_KEY_CHARACTERS) return null;
    const parts = token.split(".");
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return null;
    const header = JSON.parse(new TextDecoder().decode(base64Url(parts[0]))) as Record<string, unknown>;
    const claims = JSON.parse(new TextDecoder().decode(base64Url(parts[1]))) as Record<string, unknown>;
    if (Object.keys(header).sort().join() !== "alg,typ" || header.alg !== "EdDSA" || header.typ !== "JWT") return null;
    const key = await crypto.subtle.importKey("spki", base64(publicKeySpkiBase64) as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    const valid = await crypto.subtle.verify("Ed25519", key, base64Url(parts[2]) as BufferSource, new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    if (!valid || claims.iss !== expect.issuer || claims.aud !== expect.audience) return null;
    if (typeof claims.purpose !== "string" || !claims.purpose.startsWith("rights.")) return null;
    const action = claims.purpose.slice("rights.".length);
    if (!expect.actions.includes(action)) return null;
    if (typeof claims.jti !== "string" || !CANONICAL_UUID.test(claims.jti)) return null;
    if (typeof claims.iat !== "number" || typeof claims.exp !== "number") return null;
    const { iat, exp } = claims;
    if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)
      || iat > nowSeconds + MAX_CLOCK_SKEW_SECONDS || exp <= nowSeconds
      || exp <= iat || exp - iat > MAX_RIGHTS_REQUEST_LIFETIME_SECONDS) return null;
    if (typeof claims.case !== "string" || !CASE_ID.test(claims.case)) return null;
    if (typeof claims.target !== "string" || !TARGET_ID.test(claims.target)) return null;
    const route = claims.route === undefined ? null : claims.route;
    if (route !== null && route !== "inquiry" && route !== "immediate") return null;
    const outcome = claims.outcome === undefined ? null : claims.outcome;
    if (outcome !== null) {
      const allowed = action === "close" ? ["rejected", "kept"] : (expect.outcomePurposeOutcomes ?? []);
      if (typeof outcome !== "string" || !allowed.includes(outcome)) return null;
    }
    const due = claims.due === undefined ? null : claims.due;
    if (due !== null && (typeof due !== "string" || !Number.isFinite(Date.parse(due)))) return null;
    const reason = claims.reason === undefined ? "" : claims.reason;
    if (typeof reason !== "string" || reason.length > 500) return null;
    return {
      iss: claims.iss as string, aud: claims.aud as string, jti: claims.jti, iat, exp, action, caseId: claims.case, target: claims.target, route,
      due: due === null ? null : new Date(Date.parse(due)).toISOString(), outcome: outcome as string | null, reason,
    };
  } catch {
    return null;
  }
}

/** Hub の受付（Rights Desk → Hub）の検証。操作は open だけ。 */
export function verifyRightsDeskRequest(token: string, publicKeySpkiBase64: string, audience = HUB_AUDIENCE, nowSeconds?: number) {
  return verifyRightsToken(token, publicKeySpkiBase64, { issuer: RIGHTS_ISSUER, audience, actions: ["open"] }, nowSeconds);
}

export type SignInput = {
  privateKeyPkcs8Base64: string;
  issuer: string;
  audience: string;
  /** 例 "rights.hide" */
  purpose: string;
  caseId: string;
  target: string;
  route?: "inquiry" | "immediate";
  due?: string;
  outcome?: string;
  reason?: string;
  lifetimeSeconds?: number;
  now?: number;
  jti?: string;
};

/** 署名する。claims は必要なものだけ。寿命は 120 秒まで、jti は毎回新しい。 */
export async function signRightsToken(input: SignInput): Promise<string> {
  const now = input.now ?? Math.floor(Date.now() / 1000);
  const claims: Record<string, unknown> = {
    iss: input.issuer, aud: input.audience, purpose: input.purpose, jti: input.jti ?? crypto.randomUUID(),
    iat: now, exp: now + Math.min(input.lifetimeSeconds ?? 60, MAX_RIGHTS_REQUEST_LIFETIME_SECONDS),
    case: input.caseId, target: input.target,
  };
  if (input.route !== undefined) claims.route = input.route;
  if (input.due !== undefined) claims.due = input.due;
  if (input.outcome !== undefined) claims.outcome = input.outcome;
  if (input.reason !== undefined && input.reason !== "") claims.reason = input.reason;
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "EdDSA", typ: "JWT" })));
  const payload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(claims)));
  const key = await crypto.subtle.importKey("pkcs8", base64(input.privateKeyPkcs8Base64) as BufferSource, { name: "Ed25519" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

/** Hub 自身の鍵で、Rights Desk 宛のトークンを作る。鍵が無ければ null。 */
export async function signHubToken(input: Omit<SignInput, "privateKeyPkcs8Base64" | "issuer" | "audience">): Promise<string | null> {
  const key = readEnv().HUB_RIGHTS_SIGNING_KEY_PKCS8;
  if (!key) return null;
  return signRightsToken({ ...input, privateKeyPkcs8Base64: key, issuer: HUB_ISSUER, audience: RIGHTS_AUDIENCE });
}

/** 要求の jti を 1 回だけ使う。保存先が使えないときは閉じる。 */
export async function consumeRightsRequest(
  db: D1Database,
  jti: string,
  expiresAtSeconds: number,
  nowMilliseconds = Date.now(),
): Promise<"consumed" | "replayed" | "unavailable"> {
  try {
    const hash = await sha256Hex(`hub-rights-jti:${jti}`);
    const results = await db.batch([
      db.prepare("DELETE FROM copyright_rights_desk_jti WHERE jti_hash IN (SELECT jti_hash FROM copyright_rights_desk_jti WHERE expires_at <= ? LIMIT 100)")
        .bind(Math.floor(nowMilliseconds / 1000)),
      db.prepare("INSERT INTO copyright_rights_desk_jti (jti_hash, expires_at) VALUES (?, ?) ON CONFLICT(jti_hash) DO NOTHING")
        .bind(hash, expiresAtSeconds),
    ]);
    if (results.length !== 2) return "unavailable";
    const changes = (results[1] as { meta?: { changes?: number } } | undefined)?.meta?.changes;
    if (Number(changes) === 1) return "consumed";
    if (Number(changes) === 0) return "replayed";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

// ---------------------------------------------------------------------------
// 設定（環境変数）。試験では installRightsDeskBoundary で差し替える。
// ---------------------------------------------------------------------------

export type RightsDeskEnv = {
  RIGHTS_DESK_PUBLIC_KEY_SPKI?: string;
  HUB_RIGHTS_SIGNING_KEY_PKCS8?: string;
  RIGHTS_DESK_URL?: string;
};

let envOverride: (() => RightsDeskEnv) | null = null;
let fetchOverride: typeof fetch | null = null;

function readEnv(): RightsDeskEnv {
  if (envOverride) return envOverride();
  try {
    const env = getCloudflareContext().env as unknown as Record<string, unknown>;
    const pick = (name: keyof RightsDeskEnv) => (typeof env[name] === "string" && env[name] ? (env[name] as string) : undefined);
    return {
      RIGHTS_DESK_PUBLIC_KEY_SPKI: pick("RIGHTS_DESK_PUBLIC_KEY_SPKI"),
      HUB_RIGHTS_SIGNING_KEY_PKCS8: pick("HUB_RIGHTS_SIGNING_KEY_PKCS8"),
      RIGHTS_DESK_URL: pick("RIGHTS_DESK_URL"),
    };
  } catch {
    return {};
  }
}

/** 試験用の差し替え。引数を省くと元に戻る。 */
export function installRightsDeskBoundary(next: { env?: () => RightsDeskEnv; fetch?: typeof fetch } = {}): void {
  envOverride = next.env ?? null;
  fetchOverride = next.fetch ?? null;
}

export type VerifiedRequest =
  | { ok: true; claims: RightsDeskClaims }
  | { ok: false; status: 401 | 503 };

/**
 * 受付の Authorization: Bearer を確かめて jti を使い切る。鍵が無ければ 503、署名・寿命・用途の失敗や再利用は 401。
 * 署名が通らない要求は jti を記録しない（偽の要求で表を埋められないように）。記録できないときは拒む。
 */
export async function authenticateRightsDeskRequest(
  db: D1Database,
  headers: Headers,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifiedRequest> {
  const publicKey = readEnv().RIGHTS_DESK_PUBLIC_KEY_SPKI;
  if (!publicKey) return { ok: false, status: 503 };
  const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(headers.get("authorization") ?? "");
  if (!match) return { ok: false, status: 401 };
  const claims = await verifyRightsDeskRequest(match[1], publicKey, HUB_AUDIENCE, nowSeconds);
  if (!claims) return { ok: false, status: 401 };
  const consumed = await consumeRightsRequest(db, claims.jti, claims.exp + MAX_CLOCK_SKEW_SECONDS, nowSeconds * 1000);
  if (consumed === "unavailable") return { ok: false, status: 503 };
  if (consumed === "replayed") return { ok: false, status: 401 };
  return { ok: true, claims };
}

// ---------------------------------------------------------------------------
// 返し・判断の送信（Hub → Rights Desk）
// ---------------------------------------------------------------------------

export function rightsDeskConfigured(): boolean {
  const env = readEnv();
  return Boolean(env.HUB_RIGHTS_SIGNING_KEY_PKCS8 && env.RIGHTS_DESK_URL);
}

function rightsDeskUrl(path: string): URL | null {
  const raw = readEnv().RIGHTS_DESK_URL;
  if (!raw) return null;
  try {
    const base = new URL(raw);
    if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") return null;
    return new URL(path, base);
  } catch {
    return null;
  }
}

/** 対象の結果を Rights Desk に知らせる。設定が無ければ送らない。失敗しても例外にしない。 */
export async function reportOutcomeToRightsDesk(caseId: string, target: string, outcome: RightsOutcome): Promise<{ delivered: boolean }> {
  if (!CASE_ID.test(caseId) || !TARGET_ID.test(target)) return { delivered: false };
  try {
    const token = await signHubToken({ purpose: "rights.outcome", caseId, target, outcome });
    const url = rightsDeskUrl(`/rights/api/v1/cases/${encodeURIComponent(caseId)}/outcome`);
    if (!token || !url) return { delivered: false };
    const response = await (fetchOverride ?? fetch)(url.href, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ v: 1, outcome }),
    });
    return { delivered: response.ok };
  } catch {
    return { delivered: false };
  }
}

export type DecisionResponse = {
  status: number;
  body: {
    caseNumber?: string;
    targetId?: string;
    service?: string;
    case?: {
      status?: string; route?: string | null; inquiryDueAt?: string | null; hiddenAt?: string | null;
      finalAt?: string | null; restoredAt?: string | null; closedAt?: string | null;
    };
    error?: string;
  } | null;
};

/** Hub の Worker が判断を Rights Desk に送る（定期処理のやり直しと rights.read）。接続できなければ 502、未設定なら 503。 */
export async function postDecisionToRightsDesk(caseId: string, token: string): Promise<DecisionResponse> {
  const url = rightsDeskUrl(`/rights/api/v1/cases/${encodeURIComponent(caseId)}/decisions`);
  if (!url) return { status: 503, body: null };
  try {
    const response = await (fetchOverride ?? fetch)(url.href, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    let body: DecisionResponse["body"] = null;
    try { body = await response.json() as DecisionResponse["body"]; } catch { /* no body */ }
    return { status: response.status, body };
  } catch {
    return { status: 502, body: null };
  }
}

/** Rights Desk は対象を URL で渡す。Hub の公開 URL の形から (種類, ID) を取る。分からなければ null。 */
export function parseTargetUrl(href: string): { kind: string; id: string } | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean).map((part) => decodeURIComponent(part));
  if (parts[0] === "api" && parts[1] === "media" && parts[2] === "images" && parts[3]) return { kind: "social_image", id: parts[3] };
  const rest = parts[0] === "v2" ? parts.slice(1) : parts;
  const [section, id, third] = rest;
  if (!section || !id || third) return null;
  if (section === "posts" || section === "post") return { kind: "social_post", id };
  if (section === "articles") return { kind: "article", id };
  if (section === "hubpedia") return { kind: "hubpedia_revision", id };
  if (section === "videos" || section === "video") return { kind: "video_embed", id };
  return null;
}
