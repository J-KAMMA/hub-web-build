import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getPersonalNodeState, startPersonalNodeReactivation, completePersonalNodeReactivation } from "@/lib/server/federation-gateway";
import { opaqueId, safeExternalUrl } from "../../../../../../federation/src/validation";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const response = (value: unknown, status = 200) => NextResponse.json(value, { status, headers });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exact = (value: unknown, names: string[]): value is Record<string, unknown> => record(value) && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const uuid = (value: unknown): value is string => typeof value === "string" && value.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fingerprint = (value: unknown): value is string => typeof value === "string" && value.length === 64 && /^[0-9a-f]{64}$/.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && value.length === 24 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function origin(value: unknown): value is string {
  if (!safeExternalUrl(value)) return false;
  const url = new URL(value); return value === url.origin;
}
function base64(value: unknown, size: number): value is string {
  if (typeof value !== "string" || value.length !== Math.ceil(size * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try { const bytes = atob(value.replace(/-/g, "+").replace(/_/g, "/")); return bytes.length === size && btoa(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === value; } catch { return false; }
}
async function publicKey(value: unknown) {
  if (!exact(value, ["kty", "crv", "x", "y"]) || value.kty !== "EC" || value.crv !== "P-256" || !base64(value.x, 32) || !base64(value.y, 32)) return null;
  const key = { kty: "EC", crv: "P-256", x: value.x, y: value.y };
  try { await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); return key; } catch { return null; }
}
async function thumbprint(key: { kty: string; crv: string; x: string; y: string }) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y })));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
}
class InvalidRequest extends Error {}
async function readBody(request: Request) {
  if (!request.body || request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") throw new InvalidRequest();
  const reader = request.body.getReader(), bytes = new Uint8Array(8192); let length = 0;
  try {
    while (true) { const chunk = await reader.read(); if (chunk.done) break; if (chunk.value.byteLength > bytes.length - length) throw new InvalidRequest(); bytes.set(chunk.value, length); length += chunk.value.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)));
    if (!record(value)) throw new InvalidRequest(); return value;
  } catch { throw new InvalidRequest(); } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return response({ error: "invalid_origin" }, 403);
  const expected = request.headers.get("x-hub-expected-viewer");
  if (!opaqueId(expected) || /[^A-Za-z0-9._:-]/.test(expected) || new URL(request.url).search) return response({ error: "invalid_request" }, 400);
  try {
    const profile = await requireDesktopHubProfile(request, getHubD1());
    if (profile.id !== expected) return response({ error: "personal_node_reactivation_scope_changed" }, 409);
    const body = await readBody(request);
    if (body.action !== "challenge" && body.action !== "reactivate") throw new InvalidRequest();
    let key: Awaited<ReturnType<typeof publicKey>> = null;
    if (body.action === "challenge") {
      if (!exact(body, ["action", "nodeUrl", "publicKeyJwk"]) || !origin(body.nodeUrl) || !(key = await publicKey(body.publicKeyJwk))) throw new InvalidRequest();
    } else if (!exact(body, ["action", "challengeId", "signature"]) || !uuid(body.challengeId) || !base64(body.signature, 64)) throw new InvalidRequest();
    const state = await getPersonalNodeState(profile.id), node = state?.node;
    if (!state || !(node === null || record(node)) || node && (!origin(node.nodeUrl) || !fingerprint(node.keyThumbprint) || !iso(node.updatedAt) || !["active", "revoked"].includes(node.status))) throw Error("invalid_state");
    if (!node || body.action === "challenge" && node.status !== "revoked") return response({ error: "personal_node_not_revoked" }, 409);
    if (body.action === "challenge") {
      if (body.nodeUrl !== node.nodeUrl || await thumbprint(key!) !== node.keyThumbprint) return response({ error: "personal_node_reactivation_mismatch" }, 409);
      const value = await startPersonalNodeReactivation({ profileId: profile.id, nodeUrl: node.nodeUrl, publicKeyJwk: key! });
      if (!value) return response({ error: "personal_node_reactivation_failed" }, 409);
      const nonce = value.challenge?.split("\n")[5]?.slice(6), expires = Date.parse(value.expiresAt);
      if (!exact(value, ["challengeId", "challenge", "expiresAt", "revokedAt"]) || !uuid(value.challengeId) || !iso(value.expiresAt) || expires <= Date.now() || expires > Date.now() + 600_000
        || value.revokedAt !== node.updatedAt || !base64(nonce, 32) || value.challenge !== `hub.personal-node.reactivate.v1\nprofile=${profile.id}\nnode=${node.nodeUrl}\nkey=${node.keyThumbprint}\nrevoked=${node.updatedAt}\nnonce=${nonce}\nexpires=${value.expiresAt}`) throw Error("invalid_challenge");
      return response({ viewerId: profile.id, nodeUrl: node.nodeUrl, keyThumbprint: node.keyThumbprint, ...value });
    }
    const value = await completePersonalNodeReactivation({ profileId: profile.id, challengeId: body.challengeId as string, signature: body.signature as string });
    if (!value) return response({ error: "personal_node_reactivation_failed" }, 409);
    if (!exact(value, ["reactivated", "nodeUrl", "keyThumbprint"]) || value.reactivated !== true || value.nodeUrl !== node.nodeUrl || value.keyThumbprint !== node.keyThumbprint) throw Error("invalid_receipt");
    return response({ viewerId: profile.id, reactivated: true, nodeUrl: node.nodeUrl, keyThumbprint: node.keyThumbprint });
  } catch (error) {
    if (error instanceof InvalidRequest) return response({ error: "invalid_request" }, 400);
    if (error instanceof DesktopHubAuthenticationError) return response({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return response({ error: "suspended" }, 403);
    if (error instanceof HubD1UnavailableError) return response({ error: "unavailable" }, 503);
    return response({ error: "personal_node_unavailable" }, 503);
  }
}
