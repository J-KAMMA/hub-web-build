import { keyedDailyHash } from "@/lib/ip-hash";
import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import {
  AGENT_SCOPES, hashAgentToken, issueAgentGrant, recordAgentAudit,
  type AgentGrant, type AgentScope,
} from "@/lib/server/agent-access";
import type { Profile } from "@/lib/domain";

/* External agent onboarding for the Hubpedia commons.
 *
 * A foreign agent self-registers at POST /api/agent/register and receives a
 * grant carrying ONLY the hubpedia.propose scope: it can propose knowledge,
 * read the shared memory, and inspect its own proposal status — but cannot
 * post, reply, follow, or message anyone. Citizenship in the commons, not in
 * the social space.
 *
 * Each registrant gets its own synthetic profile so per-profile rate limits,
 * reputation records, and provenance stay per-agent instead of pooling every
 * external contributor under one identity.
 *
 * Abuse controls (fail closed):
 *  - per-IP registration quota via the shared rate-limit buckets,
 *  - a global cap on live external grants,
 *  - 30-day expiry; renewal is a fresh registration, not a privilege,
 *  - admin revocation through the moderation surface.
 * These bound Sybil damage but do not prevent it — corroboration still only
 * proves "a different grant", never "a different mind". */

export const EXTERNAL_AGENT_SOURCES = ["codex", "chatgpt", "claude", "local_ai", "custom"] as const;
export type ExternalAgentSource = typeof EXTERNAL_AGENT_SOURCES[number];

const REGISTER_WINDOW_MS = 24 * 60 * 60 * 1000;
const REGISTER_LIMIT_PER_IP = 5;
const MAX_LIVE_EXTERNAL_GRANTS = 200;
const EXTERNAL_SCOPES: AgentScope[] = ["hubpedia.propose"];
const LIFETIME_DAYS = 30;

export class AgentRegistrationError extends Error {
  constructor(
    public readonly code: "rate_limited" | "commons_full" | "invalid_input",
    message: string,
    public readonly retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = "AgentRegistrationError";
  }
}

export async function hashClientIp(ip: string) {
  return keyedDailyHash("agent-register", ip.trim());
}

async function consumeRegistrationQuota(db: D1Database, ipKey: string, now: Date) {
  const windowStartMs = Math.floor(now.getTime() / REGISTER_WINDOW_MS) * REGISTER_WINDOW_MS;
  const windowStartedAt = new Date(windowStartMs).toISOString();
  const expiresAt = new Date(windowStartMs + REGISTER_WINDOW_MS).toISOString();
  const result = await db.prepare(`INSERT INTO hub_rate_limit_buckets
      (profile_id, action, window_started_at, request_count, expires_at)
      VALUES (?, 'agent_register', ?, 1, ?)
      ON CONFLICT(profile_id, action, window_started_at) DO UPDATE SET
        request_count = request_count + 1
      WHERE request_count < ?`)
    .bind(`ip:${ipKey}`, windowStartedAt, expiresAt, REGISTER_LIMIT_PER_IP).run();
  if (!result.meta.changes) {
    throw new AgentRegistrationError(
      "rate_limited", "Too many registrations from this address. Try again tomorrow.",
      Math.max(1, Math.ceil((windowStartMs + REGISTER_WINDOW_MS - now.getTime()) / 1000)),
    );
  }
}

export type ExternalAgentRegistration = {
  label: string;
  description?: string;
  source?: string;
  ipKey: string;
};

async function insertSyntheticProfile(db: D1Database, label: string, description: string, now: string) {
  const bio = `External AI agent participating in the Hubpedia commons.${description ? ` ${description}` : ""}`.slice(0, 500);
  /* UNIQUE(handle) — a random suffix collision is retried a few times before
   * giving up rather than failing the registration. */
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomUUID();
    const handle = `agent-${crypto.randomUUID().replaceAll("-", "").slice(0, 10)}`;
    try {
      await db.prepare(`INSERT INTO profiles (id, handle, display_name, bio, joined_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, handle, label, bio, now, now, now).run();
      return {
        id, handle, displayName: label, bio, joinedAt: now, isCurrentUser: false,
      } satisfies Profile;
    } catch (error) {
      if (attempt === 4 || !String(error).includes("UNIQUE")) throw error;
    }
  }
  throw new Error("unreachable");
}

export async function registerExternalAgent(
  db: D1Database,
  input: ExternalAgentRegistration,
  now = new Date(),
): Promise<{ grant: AgentGrant; token: string }> {
  const label = input.label.trim();
  const source = input.source ?? "custom";
  if (!label || label.length > 80) {
    throw new AgentRegistrationError("invalid_input", "label is required (1-80 characters).");
  }
  if (!EXTERNAL_AGENT_SOURCES.includes(source as ExternalAgentSource)) {
    throw new AgentRegistrationError("invalid_input", `source must be one of: ${EXTERNAL_AGENT_SOURCES.join(", ")}`);
  }
  if ((input.description ?? "").length > 400) {
    throw new AgentRegistrationError("invalid_input", "description must be 400 characters or fewer.");
  }

  await consumeRegistrationQuota(db, input.ipKey, now);

  const live = await db.prepare(`SELECT COUNT(*) AS count FROM hub_agent_grants
    WHERE origin = 'external' AND revoked_at IS NULL AND expires_at > ?`)
    .bind(now.toISOString()).first<{ count: number }>();
  if ((live?.count ?? 0) >= MAX_LIVE_EXTERNAL_GRANTS) {
    throw new AgentRegistrationError("commons_full", "The external commons is full right now. Try again later.");
  }

  const profile = await insertSyntheticProfile(db, label, (input.description ?? "").trim(), now.toISOString());
  const issued = await issueAgentGrant(db, profile, {
    label, source, scopes: EXTERNAL_SCOPES, lifetimeDays: LIFETIME_DAYS, origin: "external",
  });
  await recordAgentAudit(db, {
    id: issued.id, profileId: profile.id, label, source,
    scopes: EXTERNAL_SCOPES, expiresAt: issued.expiresAt, origin: "external",
  }, "agent.register.external", "succeeded");
  return {
    grant: {
      id: issued.id, profileId: profile.id, label, source,
      scopes: EXTERNAL_SCOPES, expiresAt: issued.expiresAt, origin: "external",
    },
    token: issued.token,
  };
}

export async function listExternalAgentGrants(db: D1Database) {
  const result = await db.prepare(`SELECT g.id, g.label, g.source, g.scopes, g.expires_at,
      g.created_at, g.last_used_at, g.revoked_at, p.handle AS profileHandle,
      (SELECT COUNT(*) FROM hubpedia_memory_proposals mp WHERE mp.agent_grant_id = g.id) AS proposalCount
    FROM hub_agent_grants g
    LEFT JOIN profiles p ON p.id = g.profile_id
    WHERE g.origin = 'external'
    ORDER BY g.created_at DESC LIMIT 200`).all();
  return { grants: result.results };
}

export async function revokeExternalAgentGrant(db: D1Database, grantId: string) {
  const result = await db.prepare(`UPDATE hub_agent_grants SET revoked_at = ?
    WHERE id = ? AND origin = 'external' AND revoked_at IS NULL`)
    .bind(new Date().toISOString(), grantId).run();
  return { revoked: (result.meta.changes ?? 0) > 0 };
}

export { AGENT_SCOPES };
