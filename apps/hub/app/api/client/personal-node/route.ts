import { NextResponse } from "next/server";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { requireDesktopHubProfile, DesktopHubAuthenticationError } from "@/lib/server/desktop-hub-auth";
import { HubSuspendedError } from "@/lib/server/hub-session";
import { getPersonalNodeState, setPersonalNodeRelays, revokePersonalNodeDevice, type PersonalNodeState } from "@/lib/server/federation-gateway";
import { opaqueId, safeExternalUrl } from "../../../../../federation/src/validation";

const headers = { "cache-control": "private, no-store", vary: "Authorization" };
const response = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
function relayOrigin(value: unknown): string | null {
  if (!safeExternalUrl(value)) return null;
  const url = new URL(value);
  return url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
}
function publicState(state: PersonalNodeState) {
  const string = (value: unknown, limit: number) => typeof value === "string" && value.length <= limit;
  const date = (value: unknown) => string(value, 64) && Number.isFinite(Date.parse(value as string));
  if (!state || !Array.isArray(state.relays) || state.relays.length > 3 || !Array.isArray(state.devices) || state.devices.length > 256
    || state.node !== null && (!state.node || !relayOrigin(state.node.nodeUrl) || !string(state.node.keyThumbprint, 128) || !["active", "revoked"].includes(state.node.status) || !date(state.node.registeredAt) || !date(state.node.updatedAt))
    || state.relays.some(relay => !relayOrigin(relay.relayUrl) || !Number.isSafeInteger(relay.priority) || relay.priority < 0 || relay.priority > 2 || ![0, 1].includes(relay.enabled) || !date(relay.updatedAt))
    || state.devices.some(device => !opaqueId(device.deviceId) || !string(device.label, 80) || !string(device.keyThumbprint, 128) || !["active", "revoked"].includes(device.status)
      || !["mobile", "computer", "server", "backup", "agent"].includes(device.deviceType) || !Array.isArray(device.scopes) || device.scopes.length > 7 || device.scopes.some(scope => !["profile:write", "post:write", "content:write", "follow:write", "preference:write", "agent:delegate", "relay:receive"].includes(scope))
      || !date(device.registeredAt) || !date(device.updatedAt) || device.revokedAt !== null && !date(device.revokedAt))) throw new Error("invalid_state");
  // Select metadata explicitly: never return recovery material or key objects.
  return {
    node: state.node ? { nodeUrl: state.node.nodeUrl, keyThumbprint: state.node.keyThumbprint, status: state.node.status, registeredAt: state.node.registeredAt, updatedAt: state.node.updatedAt } : null,
    relays: state.relays.map(({ relayUrl, priority, enabled, updatedAt }) => ({ relayUrl, priority, enabled, updatedAt })),
    devices: state.devices.map(({ deviceId, label, deviceType, keyThumbprint, scopes, status, registeredAt, updatedAt, revokedAt }) => ({ deviceId, label, deviceType, keyThumbprint, scopes, status, registeredAt, updatedAt, revokedAt })),
  };
}
function failure(error: unknown) {
  if (error instanceof DesktopHubAuthenticationError) return response({ error: "desktop_authentication_failed" }, 401);
  if (error instanceof HubSuspendedError) return response({ error: "suspended" }, 403);
  if (error instanceof HubD1UnavailableError) return response({ error: "unavailable" }, 503);
  return response({ error: "personal_node_unavailable" }, 503);
}

export async function GET(request: Request) {
  try {
    const profile = await requireDesktopHubProfile(request, getHubD1());
    const state = await getPersonalNodeState(profile.id);
    return state ? response({ viewerId: profile.id, ...publicState(state) }) : response({ error: "personal_node_unavailable" }, 503);
  } catch (error) { return failure(error); }
}

export async function PUT(request: Request) {
  try {
    const profile = await requireDesktopHubProfile(request, getHubD1());
    const text = await request.text();
    if (new TextEncoder().encode(text).length > 8192) return response({ error: "invalid_request" }, 400);
    const body = JSON.parse(text) as { relays?: unknown };
    if (!body || Array.isArray(body) || Object.keys(body).length !== 1 || !Array.isArray(body.relays) || body.relays.length > 3) return response({ error: "invalid_request" }, 400);
    const relays = body.relays.map(relayOrigin);
    if (relays.some(url => !url) || new Set(relays).size !== relays.length) return response({ error: "invalid_relay" }, 400);
    const result = await setPersonalNodeRelays(profile.id, relays.map(url => ({ url: url! })));
    if (!result) return response({ error: "personal_node_request_failed" }, 409);
    if (!Array.isArray(result.relays) || result.relays.length !== relays.length || result.relays.some((url, index) => relayOrigin(url) !== relays[index])) return response({ error: "personal_node_unavailable" }, 503);
    return response({ relays: result.relays });
  } catch (error) { return error instanceof SyntaxError ? response({ error: "invalid_request" }, 400) : failure(error); }
}

export async function DELETE(request: Request) {
  try {
    const profile = await requireDesktopHubProfile(request, getHubD1());
    const values = new URL(request.url).searchParams.getAll("deviceId");
    if (values.length !== 1 || !opaqueId(values[0])) return response({ error: "invalid_device" }, 400);
    return await revokePersonalNodeDevice(profile.id, values[0]) ? response({ revoked: true, deviceId: values[0] }) : response({ error: "device_not_found" }, 404);
  } catch (error) { return failure(error); }
}
