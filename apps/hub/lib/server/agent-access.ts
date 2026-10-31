import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";

export const AGENT_SCOPES = [
  "social.read", "social.draft", "social.publish", "social.reply",
  "social.react", "social.follow", "notifications.read",
  "hubpedia.propose",
] as const;
export type AgentScope = typeof AGENT_SCOPES[number];

export type AgentGrant = {
  id: string;
  profileId: string;
  label: string;
  source: string;
  scopes: AgentScope[];
  expiresAt: string;
  origin: "owner" | "external";
};

const encoder = new TextEncoder();
const hex = (bytes: ArrayBuffer) =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");

export async function hashAgentToken(token: string) {
  return hex(await crypto.subtle.digest("SHA-256", encoder.encode(token)));
}

export function parseAgentScopes(value: string): AgentScope[] {
  const allowed = new Set<string>(AGENT_SCOPES);
  return value.split(/\s+/).filter((scope): scope is AgentScope => allowed.has(scope));
}

export async function issueAgentGrant(
  db: D1Database,
  profile: Profile,
  input: { label: string; source: string; scopes: AgentScope[]; lifetimeDays?: number; origin?: "owner" | "external" },
) {
  const id = crypto.randomUUID();
  const secret = `${id}.${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + Math.min(90, Math.max(1, input.lifetimeDays ?? 30)) * 86_400_000).toISOString();
  const scopes = [...new Set(input.scopes)].filter((scope) => AGENT_SCOPES.includes(scope));
  const origin = input.origin ?? "owner";
  await db.prepare(`INSERT INTO hub_agent_grants
    (id, profile_id, label, source, token_hash, scopes, expires_at, created_at, origin)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, profile.id, input.label.slice(0, 80), input.source, await hashAgentToken(secret), scopes.join(" "), expiresAt, createdAt, origin)
    .run();
  return { id, token: secret, scopes, expiresAt, origin };
}

export async function authenticateAgent(request: Request, db: D1Database): Promise<AgentGrant | null> {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (token.length < 64 || token.length > 256) return null;
  const row = await db.prepare(`SELECT id, profile_id, label, source, scopes, expires_at, origin
    FROM hub_agent_grants
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ? LIMIT 1`)
    .bind(await hashAgentToken(token), new Date().toISOString())
    .first<{ id: string; profile_id: string; label: string; source: string; scopes: string; expires_at: string; origin: string }>();
  if (!row) return null;
  await db.prepare("UPDATE hub_agent_grants SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), row.id).run();
  return {
    id: row.id, profileId: row.profile_id, label: row.label, source: row.source,
    scopes: parseAgentScopes(row.scopes), expiresAt: row.expires_at,
    origin: row.origin === "external" ? "external" : "owner",
  };
}

export function requireAgentScope(grant: AgentGrant, scope: AgentScope) {
  if (!grant.scopes.includes(scope)) throw new AgentScopeError(scope);
}

export class AgentScopeError extends Error {
  constructor(public readonly scope: AgentScope) {
    super(`Required scope: ${scope}`);
    this.name = "AgentScopeError";
  }
}

export async function getAgentProfile(db: D1Database, profileId: string): Promise<Profile> {
  const row = await db.prepare(`SELECT id, handle, display_name, bio, avatar_url, joined_at
    FROM profiles WHERE id = ? LIMIT 1`).bind(profileId)
    .first<{ id: string; handle: string; display_name: string; bio: string; avatar_url: string | null; joined_at: string }>();
  if (!row) throw new Error("Agent profile is unavailable.");
  return {
    id: row.id, handle: row.handle, displayName: row.display_name, bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined, joinedAt: row.joined_at, isCurrentUser: true,
  };
}

export async function recordAgentAudit(
  db: D1Database, grant: AgentGrant, action: string, status: string,
  targetType?: string | null, targetId?: string | null,
) {
  await db.prepare(`INSERT INTO hub_agent_audit
    (id, profile_id, grant_id, action, target_type, target_id, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), grant.profileId, grant.id, action, targetType ?? null, targetId ?? null, status, new Date().toISOString())
    .run();
}
