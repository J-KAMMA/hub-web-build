import type { Profile } from "@/lib/domain";

export type FederationSettings = {
  enabled: boolean;
  discoverable: boolean;
  actorUrl: string | null;
  updatedAt?: string;
};

export type DomainAliasState = {
  aliasId: string;
  domain: string;
  status: "pending" | "verified" | "unavailable";
  challengeExpiresAt: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  federationReady?: boolean;
  publicHandle?: string;
  verificationUrl?: string;
  webFingerUrl?: string;
};

export type AtprotoConnection = {
  connected: boolean;
  did?: string;
  handle?: string;
  connectedAt?: string;
  updatedAt?: string;
};

export type PersonalNodeState = {
  node: {
    nodeUrl: string;
    keyThumbprint: string;
    status: "active" | "revoked";
    registeredAt: string;
    updatedAt: string;
  } | null;
  relays: Array<{
    relayUrl: string;
    priority: number;
    enabled: number;
    updatedAt: string;
  }>;
  devices: Array<{
    deviceId: string;
    label: string;
    deviceType: "mobile" | "computer" | "server" | "backup" | "agent";
    keyThumbprint: string;
    scopes: string[];
    status: "active" | "revoked";
    registeredAt: string;
    updatedAt: string;
    revokedAt: string | null;
  }>;
  recovery: {
    config: {
      threshold: number;
      version: number;
      status: "active" | "consumed" | "disabled";
      configuredAt: string;
      updatedAt: string;
    };
    keys: Array<{
      recoveryKeyId: string;
      label: string;
      keyThumbprint: string;
      status: "active" | "consumed" | "revoked";
    }>;
  } | null;
};

export type FederatedServiceOperation = {
  activityId: string;
  requestId: string;
  remoteActorId: string;
  activityType: "ServiceRequest" | "ServiceResult" | "ServiceStatusUpdate" | "Cancel";
  capability: "social" | "knowledge" | "commerce" | "payment" | "delivery" | "vault" | "media" | "ai" | "secure-data";
  action: string;
  resourceUrl: string | null;
  inputRefUrl: string | null;
  callbackUrl: string | null;
  remoteStatus: "pending" | "accepted" | "running" | "completed" | "failed" | "cancelled";
  direction: "inbound" | "outbound";
  deliveryState: "received" | "awaiting_confirmation" | "queued" | "delivered" | "retrying" | "completed" | "failed" | "cancelled";
  targetInboxUrl: string | null;
  expiresAt: string | null;
  confirmedAt: string | null;
  completedAt: string | null;
  retryCount: number;
  lastErrorCategory: string | null;
  receivedAt: string;
  updatedAt: string;
};

export async function listFederatedServiceOperations(profileId: string) {
  const result = await gatewayJson<{ operations: FederatedServiceOperation[] }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/service-operations`, "GET",
  );
  return result?.operations ?? [];
}

export async function prepareFederatedServiceOperation(profileId: string, input: {
  remoteActorId: string; targetInboxUrl: string; capability: FederatedServiceOperation["capability"];
  action: string; resource?: string; inputRef?: string; callback?: string; idempotencyKey: string; expiresAt?: string;
}) {
  return gatewayJson<{ operation: { requestId: string; state: string; reused: boolean } }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/service-operations`, "POST", input,
  );
}

export async function mutateFederatedServiceOperation(
  profileId: string, requestId: string, action: "confirm" | "cancel" | "retry",
) {
  return gatewayJson<{ operation: { requestId: string; state: string } }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/service-operations/${encodeURIComponent(requestId)}/${action}`,
    "POST", {},
  );
}

export function federationConfiguration() {
  return configuration();
}

function configuration() {
  const baseUrl = process.env.FEDERATION_SERVICE_URL?.trim();
  const secret = process.env.HUB_FEDERATION_SECRET?.trim();
  if (!baseUrl || !secret || secret.length < 32) return null;
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return null;
    return { baseUrl: url.toString().replace(/\/$/, ""), secret };
  } catch {
    return null;
  }
}

export async function getFederationSettings(profileId: string): Promise<FederationSettings | null> {
  const config = configuration();
  if (!config) return null;
  const response = await fetch(
    `${config.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/federation`,
    {
      headers: { authorization: `Bearer ${config.secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    },
  );
  if (!response.ok) return null;
  return response.json() as Promise<FederationSettings>;
}

export async function getPersonalNodeState(profileId: string): Promise<PersonalNodeState | null> {
  return gatewayJson<PersonalNodeState>(
    `/v1/profiles/${encodeURIComponent(profileId)}/personal-node`,
    "GET",
  );
}

export async function startPersonalNodeChallenge(input: {
  profileId: string;
  nodeUrl: string;
  publicKeyJwk: unknown;
}): Promise<{ challengeId: string; challenge: string; expiresAt: string } | null> {
  return gatewayJson("/v1/personal-nodes/challenges", "POST", input);
}

export async function completePersonalNodeRegistration(input: {
  profileId: string;
  challengeId: string;
  signature: string;
}): Promise<{ registered: boolean; nodeUrl: string; keyThumbprint: string } | null> {
  return gatewayJson("/v1/personal-nodes/registrations", "POST", input);
}

export async function startPersonalNodeReactivation(input: { profileId: string; nodeUrl: string; publicKeyJwk: unknown }): Promise<{ challengeId: string; challenge: string; expiresAt: string; revokedAt: string } | null> {
  return gatewayJson("/v1/personal-nodes/reactivation/challenges", "POST", input);
}
export async function completePersonalNodeReactivation(input: { profileId: string; challengeId: string; signature: string }): Promise<{ reactivated: boolean; nodeUrl: string; keyThumbprint: string } | null> {
  return gatewayJson("/v1/personal-nodes/reactivations", "POST", input);
}

export async function setPersonalNodeRelays(
  profileId: string,
  relays: Array<{ url: string }>,
): Promise<{ relays: string[] } | null> {
  return gatewayJson("/v1/personal-nodes/relays", "PUT", { profileId, relays });
}

export async function appendPersonalNodeEvent(
  profileId: string,
  event: unknown,
  signature: string,
  keyId = "root",
): Promise<{ accepted: boolean; eventHash: string; sequence: number } | null> {
  return gatewayJson("/v1/personal-nodes/events", "POST", { profileId, event, signature, keyId });
}

export async function getPersonalNodeEventHead(
  profileId: string,
): Promise<{ sequence: number; eventHash: string | null } | null> {
  return gatewayJson(
    `/v1/profiles/${encodeURIComponent(profileId)}/personal-node/events/head`,
    "GET",
  );
}

export async function startPersonalNodeDeviceChallenge(input: {
  profileId: string;
  label: string;
  deviceType: string;
  publicKeyJwk: unknown;
  scopes: string[];
}): Promise<{ challengeId: string; deviceId: string; challenge: string; expiresAt: string } | null> {
  return gatewayJson("/v1/personal-nodes/devices/challenges", "POST", input);
}

export async function completePersonalNodeDeviceRegistration(input: {
  profileId: string;
  challengeId: string;
  signature: string;
}): Promise<{ registered: boolean; deviceId: string; keyThumbprint: string } | null> {
  return gatewayJson("/v1/personal-nodes/devices/registrations", "POST", input);
}

export async function revokePersonalNodeDevice(
  profileId: string,
  deviceId: string,
): Promise<boolean> {
  const result = await gatewayJson<{ revoked: boolean }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/personal-node/devices/${encodeURIComponent(deviceId)}`,
    "DELETE",
  );
  return result?.revoked === true;
}

export async function startPersonalNodeRootKeyRotation(input: {
  profileId: string;
  idempotencyKey: string;
  newPublicKeyJwk: unknown;
}): Promise<{
  rotationId: string;
  challenge: string;
  expiresAt: string;
  status: string;
  oldKeyThumbprint: string;
  newKeyThumbprint: string;
  revokedDeviceCount: number;
} | null> {
  return gatewayJson("/v1/personal-nodes/root-key/rotations", "POST", input);
}

export async function completePersonalNodeRootKeyRotation(input: {
  profileId: string;
  rotationId: string;
  oldSignature: string;
  newSignature: string;
}): Promise<{
  rotationId: string;
  status: string;
  oldKeyThumbprint: string;
  newKeyThumbprint: string;
  revokedDeviceCount: number;
  completedAt: string;
} | null> {
  return gatewayJson("/v1/personal-nodes/root-key/rotations/complete", "POST", input);
}

export async function startPersonalNodeRecoverySetup(input: {
  profileId: string;
  idempotencyKey: string;
  threshold: number;
  keys: Array<{ label: string; publicKeyJwk: unknown }>;
}): Promise<unknown | null> {
  return gatewayJson("/v1/personal-nodes/recovery/setups", "POST", input);
}

export async function completePersonalNodeRecoverySetup(input: {
  profileId: string;
  setupId: string;
  signature: string;
}): Promise<unknown | null> {
  return gatewayJson("/v1/personal-nodes/recovery/setups/complete", "POST", input);
}

export async function startPersonalNodeRootKeyRecovery(input: {
  profileId: string;
  idempotencyKey: string;
  newPublicKeyJwk: unknown;
}): Promise<unknown | null> {
  return gatewayJson("/v1/personal-nodes/recoveries", "POST", input);
}

export async function completePersonalNodeRootKeyRecovery(input: {
  profileId: string;
  recoveryId: string;
  newSignature: string;
  signatures: Array<{ recoveryKeyId: string; signature: string }>;
}): Promise<unknown | null> {
  return gatewayJson("/v1/personal-nodes/recoveries/complete", "POST", input);
}

export async function revokePersonalNode(profileId: string): Promise<boolean> {
  const result = await gatewayJson<{ revoked: boolean }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/personal-node`,
    "DELETE",
  );
  return result?.revoked === true;
}

export async function exportPersonalNodeBundle(profileId: string): Promise<unknown | null> {
  return gatewayJson(
    `/v1/profiles/${encodeURIComponent(profileId)}/personal-node/export`,
    "GET",
  );
}

export async function validatePersonalNodeBundle(bundle: unknown): Promise<{
  valid: true;
  sourceProfileId: string;
  eventCount: number;
  headHash: string | null;
  events: Array<{
    id: string;
    sequence: number;
    previousHash?: string;
    eventHash: string;
    type: string;
    payload: Record<string, unknown>;
    createdAt: string;
    signerKeyId: string;
  }>;
} | null> {
  return gatewayJson("/v1/personal-nodes/import/validate", "POST", { bundle });
}

export async function putFederationSettings(
  profile: Profile,
  settings: Pick<FederationSettings, "enabled" | "discoverable">,
): Promise<FederationSettings | null> {
  const config = configuration();
  if (!config) return null;
  const response = await fetch(`${config.baseUrl}/v1/profiles/federation`, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${config.secret}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      profileId: profile.id,
      handle: profile.handle,
      displayName: profile.displayName,
      summary: profile.bio,
      avatarUrl: profile.avatarUrl ?? null,
      enabled: settings.enabled,
      discoverable: settings.enabled && settings.discoverable,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return null;
  const payload = await response.json() as { actorUrl?: unknown; enabled?: unknown };
  return {
    enabled: payload.enabled === true,
    discoverable: settings.enabled && settings.discoverable,
    actorUrl: typeof payload.actorUrl === "string" ? payload.actorUrl : null,
  };
}

export async function getDomainAlias(profileId: string): Promise<DomainAliasState | null | undefined> {
  const result = await gatewayJson<{ alias: DomainAliasState | null }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/domain-alias`,
    "GET",
  );
  return result ? result.alias : undefined;
}

export async function startDomainAliasChallenge(profile: Profile, domain: string): Promise<{
  alias: DomainAliasState;
  verificationFile: { service: string; domain: string; token: string };
} | null> {
  const current = await getFederationSettings(profile.id);
  const prepared = await putFederationSettings(profile, {
    enabled: current?.enabled ?? false,
    discoverable: current?.discoverable ?? false,
  });
  if (!prepared) return null;
  return gatewayJson("/v1/domain-aliases/challenges", "POST", { profileId: profile.id, domain });
}

export async function verifyDomainAlias(profileId: string): Promise<DomainAliasState | null> {
  const result = await gatewayJson<{ alias: DomainAliasState }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/domain-alias`,
    "POST",
  );
  return result?.alias ?? null;
}

export async function unlinkDomainAlias(profileId: string): Promise<boolean> {
  const result = await gatewayJson<{ deleted: boolean }>(
    `/v1/profiles/${encodeURIComponent(profileId)}/domain-alias`,
    "DELETE",
  );
  return result?.deleted === true;
}

export async function getAtprotoConnection(
  profileId: string,
): Promise<AtprotoConnection | null> {
  const config = configuration();
  if (!config) return null;
  try {
    const response = await fetch(
      `${config.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/atproto`,
      {
        headers: { authorization: `Bearer ${config.secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!response.ok) return null;
    return response.json() as Promise<AtprotoConnection>;
  } catch {
    return null;
  }
}

export async function authorizeAtprotoConnection(
  profileId: string,
  identifier: string,
): Promise<string | null> {
  const config = configuration();
  if (!config) return null;
  try {
    const response = await fetch(`${config.baseUrl}/v1/atproto/authorize`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ profileId, identifier }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as { authorizationUrl?: unknown };
    if (typeof payload.authorizationUrl !== "string") return null;
    const url = new URL(payload.authorizationUrl);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export async function unlinkAtprotoConnection(profileId: string): Promise<boolean> {
  const config = configuration();
  if (!config) return false;
  try {
    const response = await fetch(
      `${config.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/atproto`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${config.secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      },
    );
    return response.ok;
  } catch {
    return false;
  }
}

export async function followAtprotoActor(
  profileId: string,
  actor: string,
): Promise<{ did: string; handle: string } | null> {
  const config = configuration();
  if (!config) return null;
  try {
    const response = await fetch(`${config.baseUrl}/v1/atproto/follows`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ profileId, actor }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = await response.json() as {
      did?: unknown;
      handle?: unknown;
    };
    return typeof payload.did === "string" && typeof payload.handle === "string"
      ? { did: payload.did, handle: payload.handle }
      : null;
  } catch {
    return null;
  }
}

export async function getAtprotoFeed(
  profileId: string,
  cursor?: string | null,
): Promise<unknown | null> {
  const config = configuration();
  if (!config) return null;
  try {
    const url = new URL(
      `${config.baseUrl}/v1/profiles/${encodeURIComponent(profileId)}/atproto/feed`,
    );
    url.searchParams.set("limit", "20");
    if (cursor) url.searchParams.set("cursor", cursor.slice(0, 1000));
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${config.secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    return response.ok ? response.json() : null;
  } catch {
    return null;
  }
}

export async function publishFederatedPost(input: {
  profileId: string;
  hubPostId: string;
  text: string;
  inReplyToHubPostId?: string | null;
  attachments?: Array<{ url: string; mediaType: string; name?: string }>;
}): Promise<void> {
  const { remoteReplyTarget } = await import("@/lib/server/federation-reply-target");
  const remoteParent = await remoteReplyTarget(input.inReplyToHubPostId);
  const { inReplyToHubPostId, ...rest } = input;
  const federationInput = remoteParent
    ? { ...rest, inReplyTo: remoteParent }
    : { ...rest, ...(inReplyToHubPostId ? { inReplyToHubPostId } : {}) };
  await Promise.allSettled([
    sendPostRequest("/v1/posts", "POST", federationInput),
    sendPostRequest("/v1/atproto/posts", "POST", {
      profileId: input.profileId,
      hubPostId: input.hubPostId,
      text: input.text,
    }),
  ]);
}

export async function updateFederatedPost(hubPostId: string, text: string): Promise<void> {
  await sendPostRequest(`/v1/posts/${encodeURIComponent(hubPostId)}`, "PUT", { text });
}

/** Hub self-made video (docs/hub-video/PLAN.md 4.3): metadata and a watch-page link only. */
export async function syncFederatedVideo(videoId: string, body: object): Promise<void> {
  await sendPostRequest(`/v1/videos/${encodeURIComponent(videoId)}`, "PUT", body);
}

export async function deleteFederatedVideo(videoId: string): Promise<void> {
  await sendPostRequest(`/v1/videos/${encodeURIComponent(videoId)}`, "DELETE");
}

export async function deleteFederatedPost(hubPostId: string): Promise<void> {
  await sendPostRequest(`/v1/posts/${encodeURIComponent(hubPostId)}`, "DELETE");
}

export async function getRemoteEngagementCounts(postIds: string[]): Promise<Record<string, {
  reply: number;
  like: number;
  repost: number;
}>> {
  const config = configuration();
  const ids = [...new Set(postIds)].slice(0, 50);
  if (!config || !ids.length) return {};
  try {
    const response = await fetch(
      `${config.baseUrl}/v1/engagements?postIds=${encodeURIComponent(ids.join(","))}`,
      {
        headers: { authorization: `Bearer ${config.secret}` },
        cache: "no-store",
        signal: AbortSignal.timeout(3_000),
      },
    );
    if (!response.ok) return {};
    const payload = await response.json() as { counts?: unknown };
    return payload.counts && typeof payload.counts === "object"
      ? payload.counts as Record<string, { reply: number; like: number; repost: number }>
      : {};
  } catch {
    return {};
  }
}

async function sendPostRequest(path: string, method: "POST" | "PUT" | "DELETE", body?: object): Promise<void> {
  const config = configuration();
  if (!config) return;
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.secret}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok && response.status !== 404 && response.status !== 409) {
      console.warn(JSON.stringify({ event: "federation_post_sync_failed", status: response.status }));
    }
  } catch {
    console.warn(JSON.stringify({ event: "federation_post_sync_failed", status: "unavailable" }));
  }
}

async function gatewayJson<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: object,
): Promise<T | null> {
  const config = configuration();
  if (!config) return null;
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.secret}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok ? response.json() as Promise<T> : null;
  } catch {
    return null;
  }
}

export type FederatedActor = {
  id: string;
  handle: string | null;
  host: string;
  displayName: string | null;
  avatarUrl: string | null;
  url: string | null;
};

export type FederationCallResult<T> = { ok: true; status: number; body: T } | { ok: false; status: number; error: string };

async function gatewayCall<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: object): Promise<FederationCallResult<T>> {
  const config = configuration();
  if (!config) return { ok: false, status: 503, error: "federation_unavailable" };
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.secret}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) return { ok: false, status: response.status, error: typeof payload?.error === "string" ? payload.error : "federation_error" };
    return { ok: true, status: response.status, body: payload as T };
  } catch {
    return { ok: false, status: 503, error: "federation_unavailable" };
  }
}

export function followFederatedActor(
  profileId: string,
  target: { handle: string } | { actorUrl: string },
) {
  return gatewayCall<{ followId: string; state: "pending" | "accepted" | "rejected" | "undone"; actor: FederatedActor }>(
    "/v1/follows", "POST", { profileId, ...target },
  );
}

export function undoFederatedFollow(followId: string) {
  return gatewayCall<{ state: string }>(`/v1/follows/${encodeURIComponent(followId)}`, "DELETE");
}

export function sendFederatedLike(profileId: string, objectId: string, like: boolean) {
  return gatewayCall<{ state: string }>("/v1/reactions", "POST", { profileId, objectId, action: like ? "like" : "undo_like" });
}

/** 他のハブへ通報（Flag）を送る。送信元はこのハブの instance actor で、通報者の素性は載らない。 */
export function sendFederatedFlag(input: { actorUrl: string; objectUrls: string[]; category: string }) {
  return gatewayCall<{ state: string }>("/v1/flags", "POST", input);
}

/** 他のハブの人をブロック／解除したことを相手へ伝える（Block / Undo{Block}）。連合を有効にした利用者だけ送られる。 */
export function sendFederatedBlock(profileId: string, actorUrl: string, blocked: boolean) {
  return gatewayCall<{ state: string }>("/v1/blocks", "POST", { profileId, actorUrl, action: blocked ? "block" : "undo_block" });
}

export type InboundEventPage = {
  version: number;
  events: Array<Record<string, unknown> & { seq: number; kind: string }>;
  nextCursor: string;
  hasMore: boolean;
};

/** Federation の受信箱を cursor から順に引く。Federation は Hub へ書かない。Hub が引く。 */
export function fetchFederationInbound(cursor: string, limit = 50) {
  return gatewayCall<InboundEventPage>(`/v1/inbound?cursor=${encodeURIComponent(cursor)}&limit=${limit}`, "GET");
}

export type FederationDomainPolicy = { domain: string; action: "allow" | "limit" | "suspend"; reason: string; updatedAt: string };

/** 運営者向け。Federation のドメイン方針（初見の7日 limit の自動行を含む）を読む。 */
export function listFederationDomainPolicies() {
  return gatewayCall<{ domains: FederationDomainPolicy[] }>("/v1/admin/domains", "GET");
}

export function putFederationDomainPolicy(input: { domain: string; action: "allow" | "limit" | "suspend"; reason?: string }) {
  return gatewayCall<{ updated: boolean }>("/v1/admin/domains", "PUT", input);
}
