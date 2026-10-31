import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getPersonalNodeState, startPersonalNodeChallenge, completePersonalNodeRegistration } from "@/lib/server/federation-gateway";
import { opaqueId, safeExternalUrl } from "../../../../../../federation/src/validation";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) => Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
class InvalidRequest extends Error {}

function base64url(value: unknown, size: number): value is string {
  if (typeof value !== "string" || value.length !== Math.ceil(size * 4 / 3) || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const bytes = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return bytes.length === size && btoa(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "") === value;
  } catch { return false; }
}
function origin(value: unknown): string | null {
  if (!safeExternalUrl(value)) return null;
  const url = new URL(value);
  return url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
}
async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) throw new InvalidRequest();
  const reader = request.body.getReader(), buffer = new Uint8Array(8192);
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value.length > buffer.length - length) { await reader.cancel(); throw new InvalidRequest(); }
      buffer.set(value, length); length += value.length;
    }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)));
    if (!record(body)) throw new InvalidRequest();
    return body;
  } catch { throw new InvalidRequest(); }
  finally { reader.releaseLock(); }
}
async function publicKey(value: unknown): Promise<{ kty: "EC"; crv: "P-256"; x: string; y: string } | null> {
  if (!record(value) || !keys(value, ["kty", "crv", "x", "y"]) || value.kty !== "EC" || value.crv !== "P-256" || !base64url(value.x, 32) || !base64url(value.y, 32)) return null;
  const key = { kty: "EC" as const, crv: "P-256" as const, x: value.x, y: value.y };
  try { await crypto.subtle.importKey("jwk", key, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]); return key; }
  catch { return null; }
}
async function thumbprint(key: { kty: string; crv: string; x: string; y: string }) {
  const canonical = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function POST(request: Request) {
  try {
    const profile = await requireDesktopHubProfile(request, getHubD1());
    if (!opaqueId(profile.id)) throw new Error("invalid_actor");
    const body = await readBody(request);
    if (body.action !== "challenge" && body.action !== "register") throw new InvalidRequest();
    let nodeUrl: string | null = null, key: Awaited<ReturnType<typeof publicKey>> = null;
    if (body.action === "challenge") {
      if (!keys(body, ["action", "nodeUrl", "publicKeyJwk"]) || !(nodeUrl = origin(body.nodeUrl)) || !(key = await publicKey(body.publicKeyJwk))) throw new InvalidRequest();
    } else if (!keys(body, ["action", "challengeId", "signature"]) || !uuid(body.challengeId) || !base64url(body.signature, 64)) throw new InvalidRequest();
    const state = await getPersonalNodeState(profile.id);
    if (!state || !Object.hasOwn(state, "node") || state.node === undefined) throw new Error("invalid_state");
    if (state.node !== null) return response({ error: "personal_node_already_registered" }, 409);
    if (body.action === "challenge") {
      const result = await startPersonalNodeChallenge({ profileId: profile.id, nodeUrl: nodeUrl!, publicKeyJwk: key! });
      if (!result) return response({ error: "personal_node_request_failed" }, 409);
      const expires = Date.parse(result.expiresAt), now = Date.now();
      const nonce = typeof result.challenge === "string" ? result.challenge.split("\n")[3]?.slice(6) : undefined;
      if (!uuid(result.challengeId) || !Number.isFinite(expires) || new Date(expires).toISOString() !== result.expiresAt || expires <= now || expires > now + 600_000 || !base64url(nonce, 32)
        || result.challenge !== `hub.personal-node.register.v1\nprofile=${profile.id}\nnode=${nodeUrl}\nnonce=${nonce}\nexpires=${result.expiresAt}`) throw new Error("invalid_challenge");
      return response({ viewerId: profile.id, nodeUrl, keyThumbprint: await thumbprint(key!), challengeId: result.challengeId, challenge: result.challenge, expiresAt: result.expiresAt });
    }
    const result = await completePersonalNodeRegistration({ profileId: profile.id, challengeId: body.challengeId as string, signature: body.signature as string });
    if (!result) return response({ error: "personal_node_request_failed" }, 409);
    const registeredOrigin = origin(result.nodeUrl);
    if (result.registered !== true || !registeredOrigin || registeredOrigin !== result.nodeUrl || typeof result.keyThumbprint !== "string" || !/^[0-9a-f]{64}$/.test(result.keyThumbprint)) throw new Error("invalid_registration");
    return response({ viewerId: profile.id, registered: true, nodeUrl: registeredOrigin, keyThumbprint: result.keyThumbprint });
  } catch (error) {
    if (error instanceof InvalidRequest) return response({ error: "invalid_request" }, 400);
    if (error instanceof DesktopHubAuthenticationError) return response({ error: "desktop_authentication_failed" }, 401);
    if (error instanceof HubSuspendedError) return response({ error: "suspended" }, 403);
    if (error instanceof HubD1UnavailableError) return response({ error: "unavailable" }, 503);
    return response({ error: "personal_node_unavailable" }, 503);
  }
}
