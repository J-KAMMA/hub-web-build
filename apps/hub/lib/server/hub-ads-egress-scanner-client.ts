import "server-only";

const DEFAULT_LOCAL_ENDPOINT = "http://127.0.0.1:43129";
const MAX_RESPONSE_BYTES = 8 * 1024;
const REQUEST_TIMEOUT_MS = 12_000;
const PROOF_LIFETIME_SECONDS = 30;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

type ScannerFailureResult = "failed" | "error";
type ScannerSuccess = { ok: true; status: number; headers: Record<string, string> };

export type HubAdEgressBinding = { creativeVersionId: string; initialUrlHash: string };

const SAFE_FAILURE_CODES = new Set([
  "unsafe_url", "unsafe_dns", "dns_resolution_failed", "fetch_failed", "invalid_egress_response",
]);

export class HubAdsEgressScannerError extends Error {
  constructor(public readonly result: ScannerFailureResult, public readonly reasonCode: string) {
    super(reasonCode);
    this.name = "HubAdsEgressScannerError";
  }
}

function base64Url(bytes: Uint8Array) {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function scannerConfig() {
  const secret = process.env.HUB_ADS_EGRESS_SCANNER_SECRET ?? "";
  const keyId = process.env.HUB_ADS_EGRESS_SIGNING_KEY_ID?.trim() ?? "";
  const privateKey = process.env.HUB_ADS_EGRESS_SIGNING_PRIVATE_KEY_PKCS8?.trim() ?? "";
  const configured = process.env.HUB_ADS_EGRESS_SCANNER_URL?.trim();
  const endpoint = configured || (typeof navigator === "undefined" ? DEFAULT_LOCAL_ENDPOINT : "");
  if (secret.length < 32 || !KEY_ID_PATTERN.test(keyId) || !privateKey || !endpoint) {
    throw new HubAdsEgressScannerError("error", "egress_scanner_unavailable");
  }
  let url: URL;
  try { url = new URL(endpoint); } catch {
    throw new HubAdsEgressScannerError("error", "egress_scanner_unavailable");
  }
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(loopback && url.protocol === "http:"))
    || url.username || url.password || url.search || url.hash) {
    throw new HubAdsEgressScannerError("error", "egress_scanner_unavailable");
  }
  url.pathname = `${url.pathname.replace(/\/$/, "")}/v1/fetch`;
  return { endpoint: url, secret, keyId, privateKey };
}

async function signRequestProof(
  target: string,
  binding: HubAdEgressBinding,
  keyId: string,
  privateKeyPkcs8: string,
  nowSeconds = Math.floor(Date.now() / 1000),
) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(binding.creativeVersionId)
    || !/^[a-f0-9]{64}$/.test(binding.initialUrlHash)) throw new Error("invalid_egress_binding");
  if (!KEY_ID_PATTERN.test(keyId)) throw new Error("invalid_egress_key_id");
  const header = base64Url(new TextEncoder().encode(JSON.stringify({ alg: "EdDSA", typ: "JWT", kid: keyId })));
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    version: 1, iss: "jkamma-hub", aud: "jkamma-hub-ads-egress", purpose: "landing_fetch",
    jti: crypto.randomUUID(), creative_version_id: binding.creativeVersionId,
    initial_url_hash: binding.initialUrlHash, requested_url: target, requested_url_hash: await sha256(target),
    iat: nowSeconds, exp: nowSeconds + PROOF_LIFETIME_SECONDS,
  })));
  const key = await crypto.subtle.importKey(
    "pkcs8", Uint8Array.from(atob(privateKeyPkcs8), (character) => character.charCodeAt(0)),
    { name: "Ed25519" }, false, ["sign"],
  );
  const signature = await crypto.subtle.sign("Ed25519", key, new TextEncoder().encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

async function readBoundedJson(response: Response) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("oversized_response");
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error("oversized_response");
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}

function parseSuccess(value: unknown): ScannerSuccess | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || !Number.isInteger(record.status)
    || Number(record.status) < 100 || Number(record.status) > 599
    || !record.headers || typeof record.headers !== "object" || Array.isArray(record.headers)) return null;
  const headers: Record<string, string> = {};
  for (const name of ["location", "content-type", "content-disposition"] as const) {
    const field = (record.headers as Record<string, unknown>)[name];
    if (field !== undefined && typeof field !== "string") return null;
    if (typeof field === "string") headers[name] = field;
  }
  return { ok: true, status: Number(record.status), headers };
}

export function createHubAdLandingEgressFetcher(binding: HubAdEgressBinding): typeof fetch {
  return async (input) => {
    const target = input instanceof Request ? input.url : String(input);
    try {
      const { endpoint, secret, keyId, privateKey } = scannerConfig();
      const proof = await signRequestProof(target, binding, keyId, privateKey);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
        body: JSON.stringify({ url: target, proof }), cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (response.status !== 200) throw new Error("scanner_http_status");
      const value = await readBoundedJson(response);
      if (value && typeof value === "object" && (value as { ok?: unknown }).ok === false) {
        const failure = value as { result?: unknown; reasonCode?: unknown };
        if ((failure.result === "failed" || failure.result === "error")
          && typeof failure.reasonCode === "string" && SAFE_FAILURE_CODES.has(failure.reasonCode)) {
          throw new HubAdsEgressScannerError(failure.result, failure.reasonCode);
        }
        throw new Error("invalid_failure_envelope");
      }
      const success = parseSuccess(value);
      if (!success) throw new Error("invalid_success_envelope");
      return new Response(null, { status: success.status, headers: success.headers });
    } catch (error) {
      if (error instanceof HubAdsEgressScannerError) throw error;
      throw new HubAdsEgressScannerError("error", "egress_scanner_unavailable");
    }
  };
}
