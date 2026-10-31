import "server-only";

import { federationConfiguration } from "@/lib/server/federation-gateway";

/*
 * 持ち運べる身元（DESIGN.md 2・3）で Hub が Federation に頼む操作。
 * Hub は秘密鍵を持たない。ここを通るのは、利用者の端末が署名した文書（公開鍵の登録文・Move）と、公開されている情報だけ。
 */

export type FederationIdentity = {
  actorUrl: string | null;
  enabled?: boolean;
  rootKey: string | null;
  rootKeyRegisteredAt?: string | null;
  alsoKnownAs: string[];
  movedTo: string | null;
  movedAt?: string | null;
};

export type PortableExportParts = {
  actor: string;
  rootKey: string | null;
  alsoKnownAs: string[];
  movedTo: string | null;
  profile: { handle: string; displayName: string; summary: string };
  following: Array<{ actor: string; since: string | null }>;
  followers: Array<{ actor: string; inbox: string | null }>;
  posts: Array<{ originalId: string; published: string; content: string; inReplyTo: string | null }>;
};

export type IdentityCall<T> = { ok: true; status: number; body: T } | { ok: false; status: number; error: string };

async function call<T>(path: string, method: "GET" | "POST" | "PUT" | "DELETE", body?: object): Promise<IdentityCall<T>> {
  const config = federationConfiguration();
  if (!config) return { ok: false, status: 503, error: "federation_unavailable" };
  try {
    const response = await fetch(`${config.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.secret}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) return { ok: false, status: response.status, error: typeof payload?.error === "string" ? payload.error : "federation_error" };
    return { ok: true, status: response.status, body: payload as T };
  } catch {
    return { ok: false, status: 503, error: "federation_unavailable" };
  }
}

const enc = encodeURIComponent;

export const identityGateway = {
  getIdentity: (profileId: string) => call<FederationIdentity>(`/v1/profiles/${enc(profileId)}/identity`, "GET"),
  registerRootKey: (profileId: string, statement: object) =>
    call<{ rootKey: string; actor: string; registeredAt: string }>(`/v1/profiles/${enc(profileId)}/root-key`, "PUT", { statement }),
  removeRootKey: (profileId: string) => call<{ removed: boolean }>(`/v1/profiles/${enc(profileId)}/root-key`, "DELETE"),
  setAlsoKnownAs: (profileId: string, alsoKnownAs: string[]) =>
    call<{ alsoKnownAs: string[] }>(`/v1/profiles/${enc(profileId)}/aliases`, "PUT", { alsoKnownAs }),
  portableExport: (profileId: string) => call<PortableExportParts>(`/v1/profiles/${enc(profileId)}/portable-export`, "GET"),
  registerImportedPosts: (profileId: string, posts: object[]) =>
    call<{ registered: number }>(`/v1/profiles/${enc(profileId)}/imported-posts`, "POST", { posts }),
  moveOut: (profileId: string, target: string, move?: object) =>
    call<{ movedTo: string; movedAt: string; notified: number; withProof: boolean }>(`/v1/profiles/${enc(profileId)}/move`, "POST", { target, ...(move ? { move } : {}) }),
  selfMove: (profileId: string, move: object, followers: Array<{ actor: string; inbox: string | null }>) =>
    call<{ delivered: number }>(`/v1/profiles/${enc(profileId)}/self-move`, "POST", { move, followers }),
};

export type IdentityGateway = typeof identityGateway;
