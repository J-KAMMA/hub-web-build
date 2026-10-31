import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { FederationDomainPolicy } from "@/lib/server/federation-gateway";

/*
 * 運営者向けのドメイン方針の一覧。Hub が知っている外部ドメイン（影のプロフィールの host）と、
 * Federation の方針を合わせる。初めて見るドメインは Federation が 7 日間 limit にする
 * （reason='auto:new-domain'）。運営者の明示（allow / limit / suspend）はそれを上書きする。
 */
export const NEW_DOMAIN_PROBATION_REASON = "auto:new-domain";
export const NEW_DOMAIN_PROBATION_MS = 7 * 24 * 60 * 60 * 1000;

export type DomainPolicyRow = {
  domain: string;
  /** 運営者が明示した、または自動の方針。方針の行が無いドメインは null。 */
  action: "allow" | "limit" | "suspend" | null;
  /** いまの実効。自動の7日が過ぎたら allow、行が無ければ allow（Federation が初見で行を作る）。 */
  effective: "allow" | "limit" | "suspend";
  probation: boolean;
  probationEndsAt: string | null;
  reason: string;
  updatedAt: string | null;
  remoteProfiles: number;
  firstSeenAt: string | null;
};

export function mergeDomainPolicies(
  hosts: Array<{ host: string; profiles: number; first_seen: string | null }>,
  policies: FederationDomainPolicy[],
  now = Date.now(),
): DomainPolicyRow[] {
  const byDomain = new Map<string, DomainPolicyRow>();
  const ensure = (domain: string): DomainPolicyRow => {
    let row = byDomain.get(domain);
    if (!row) {
      row = { domain, action: null, effective: "allow", probation: false, probationEndsAt: null, reason: "", updatedAt: null, remoteProfiles: 0, firstSeenAt: null };
      byDomain.set(domain, row);
    }
    return row;
  };
  for (const host of hosts) {
    const row = ensure(host.host.toLowerCase());
    row.remoteProfiles = host.profiles;
    row.firstSeenAt = host.first_seen;
  }
  for (const policy of policies) {
    const row = ensure(policy.domain.toLowerCase());
    row.action = policy.action;
    row.reason = policy.reason === NEW_DOMAIN_PROBATION_REASON ? "" : policy.reason;
    row.updatedAt = policy.updatedAt;
    if (policy.reason === NEW_DOMAIN_PROBATION_REASON) {
      const endsAt = Date.parse(policy.updatedAt) + NEW_DOMAIN_PROBATION_MS;
      row.probation = Number.isFinite(endsAt) && endsAt > now;
      row.probationEndsAt = Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : null;
      row.effective = row.probation ? "limit" : "allow";
      if (!row.probation) row.action = null;
    } else {
      row.effective = policy.action;
    }
  }
  return [...byDomain.values()].sort((a, b) => a.domain.localeCompare(b.domain));
}

export async function listKnownRemoteHosts(database: D1Database) {
  const rows = await database.prepare(
    `SELECT host, COUNT(*) AS profiles, MIN(created_at) AS first_seen FROM remote_actor_profiles
     GROUP BY host ORDER BY host LIMIT 500`,
  ).all<{ host: string; profiles: number; first_seen: string | null }>();
  return rows.results.map((row) => ({ host: row.host, profiles: Number(row.profiles), first_seen: row.first_seen }));
}

export function isValidPolicyAction(value: unknown): value is "allow" | "limit" | "suspend" {
  return value === "allow" || value === "limit" || value === "suspend";
}
