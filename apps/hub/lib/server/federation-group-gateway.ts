import "server-only";

import { federationConfiguration, type FederatedActor, type FederationCallResult } from "@/lib/server/federation-gateway";

/*
 * Federation Worker の Group まわりの内部 API（apps/federation/src/groups.ts）。
 * 持ち主の Hub が使う操作（グループの登録・参加の判断・発言の announce / 削除・除名）と、
 * 参加する側が使う操作（他のハブのコミュニティへの参加・書き込み）をまとめる。
 * Hub は Federation の D1 を読まず、Federation も Hub へ書かない。出来事は GET /v1/group-events を Hub が引く。
 */

async function call<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: object): Promise<FederationCallResult<T>> {
  const config = federationConfiguration();
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

export type GroupChannelInput = { id: string; name: string };

export type FederatedGroupSummary = {
  id: string;
  slug: string;
  host: string;
  name: string;
  summary: string;
  channels: Array<{ id: string; name: string; url: string }>;
};

export type GroupSubscriptionResult = {
  subscriptionId: string;
  state: "pending" | "accepted" | "rejected" | "removed" | "banned" | "undone";
  group: FederatedGroupSummary;
};

const id = encodeURIComponent;

/* ---- 持ち主の Hub ---- */

export function upsertFederatedGroup(communityId: string, input: {
  slug: string; name: string; summary: string; enabled: boolean; channels: GroupChannelInput[];
}) {
  return call<{ groupId: string; slug: string; actorUrl: string; enabled: boolean }>(`/v1/groups/${id(communityId)}`, "PUT", input);
}

export function decideFederatedGroupMember(communityId: string, actorId: string, decision: "accept" | "reject") {
  return call<{ state: string }>(`/v1/groups/${id(communityId)}/member-decisions`, "POST", { actorId, decision });
}

export function removeFederatedGroupMember(communityId: string, actorId: string, ban: boolean, reason?: string) {
  return call<{ state: string }>(`/v1/groups/${id(communityId)}/member-removals`, "POST", { actorId, ban, ...(reason ? { reason } : {}) });
}

export function decideFederatedGroupObject(communityId: string, objectId: string, decision: "announce" | "reject" | "announce_update") {
  return call<{ state: string }>(`/v1/groups/${id(communityId)}/object-decisions`, "POST", { objectId, decision });
}

export function publishFederatedGroupMessage(communityId: string, input: {
  hubMessageId: string; text: string; title?: string; channelId?: string | null; inReplyToObjectId?: string | null;
  authorName?: string; authorHandle?: string; publishedAt?: string;
}) {
  return call<{ objectId: string; state: string }>(`/v1/groups/${id(communityId)}/publications`, "POST", input);
}

export function removeFederatedGroupObject(communityId: string, objectId: string) {
  return call<{ state: string }>(`/v1/groups/${id(communityId)}/removed-objects`, "POST", { objectId });
}

/* ---- 参加する側 ---- */

export function subscribeToFederatedGroup(profileId: string, target: { handle: string } | { groupUrl: string }) {
  return call<GroupSubscriptionResult>("/v1/group-subscriptions", "POST", { profileId, ...target });
}

export function unsubscribeFromFederatedGroup(subscriptionId: string) {
  return call<{ state: string }>(`/v1/group-subscriptions/${id(subscriptionId)}`, "DELETE");
}

export function postToFederatedGroup(input: {
  profileId: string; groupUrl: string; text: string; title?: string; inReplyTo?: string | null; channelId?: string | null;
}) {
  return call<{ objectId: string; activityId: string }>("/v1/group-posts", "POST", input);
}

export function deleteFederatedGroupPost(profileId: string, objectId: string) {
  return call<{ deleted: boolean }>("/v1/group-posts/delete", "POST", { profileId, objectId });
}

/* ---- 出来事 ---- */

export type GroupEvent = Record<string, unknown> & {
  seq: number;
  kind: string;
  actor?: FederatedActor | null;
};

export type GroupEventPage = { version: number; events: GroupEvent[]; nextCursor: string; hasMore: boolean };

export function fetchFederationGroupEvents(cursor: string, limit = 50) {
  return call<GroupEventPage>(`/v1/group-events?cursor=${encodeURIComponent(cursor)}&limit=${limit}`, "GET");
}
