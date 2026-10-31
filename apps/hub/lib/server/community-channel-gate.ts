import type { D1Database } from "@cloudflare/workers-types";

/**
 * Community channel token gates (docs/hub-token-gates/DESIGN.md sections 2, 7).
 *
 * A channel is gated when content_access_gates has a ('channel', channelId) row.
 * The old community_channels.token_gate_id / minimum_token_balance columns are
 * NOT read any more (symbol-only matching, no expiry). Owners and moderators of
 * the hosting community are not subject to the gate; everyone else must hold a
 * fresh, allowed check (cached for at most 10 minutes by the verifier).
 *
 * The verifier modules import "server-only", so they are loaded lazily and only
 * when a channel really has a gate.
 */

export type ChannelGateVerdict = "allowed" | "denied" | "unavailable";

/** Checks one gate for one viewer profile. Default: lane B's checkGateForViewer (cache first, then RPC). */
export type ChannelGateVerifier = (
  database: D1Database,
  profileId: string,
  gate: ChannelGateSpec,
) => Promise<ChannelGateVerdict>;

export type ChannelGateSpec = {
  id: string;
  match: "any" | "all";
  version: number;
  conditions: ReadonlyArray<{
    kind: string;
    chainId: number;
    contract: string;
    minRaw: string | null;
    tokenIds: readonly string[] | null;
  }>;
};

export const defaultChannelGateVerifier: ChannelGateVerifier = async (database, profileId, gate) => {
  const { checkGateForViewer, createGateVerificationDeps } = await import("@/lib/server/access-gate-verification");
  const outcome = await checkGateForViewer(gate, profileId, createGateVerificationDeps(database));
  return outcome.result === "granted" ? "allowed" : outcome.result === "denied" ? "denied" : "unavailable";
};

export type ChannelGateState =
  | { gated: false }
  | { gated: true; verdict: ChannelGateVerdict };

async function isCommunityManager(database: D1Database, communityId: string, profileId: string) {
  const row = await database
    .prepare(
      `SELECT 1 AS ok FROM community_memberships
       WHERE community_id = ? AND profile_id = ? AND status = 'active' AND role IN ('owner', 'moderator') LIMIT 1`,
    )
    .bind(communityId, profileId)
    .first<{ ok: number }>();
  return row !== null;
}

/**
 * Whether `profileId` (null = signed out) may read/act in the channel.
 * Ungated channels are untouched. Any failure, missing gate row data or
 * unknown condition resolves to "denied"/"unavailable", never to "allowed".
 */
export async function evaluateChannelGate(
  database: D1Database,
  input: { communityId: string; channelId: string; profileId: string | null },
  verifier: ChannelGateVerifier = defaultChannelGateVerifier,
): Promise<ChannelGateState> {
  const attached = await database
    .prepare("SELECT gate_id FROM content_access_gates WHERE target_type = 'channel' AND target_id = ? LIMIT 1")
    .bind(input.channelId)
    .first<{ gate_id: string }>();
  if (!attached) return { gated: false };
  if (!input.profileId) return { gated: true, verdict: "denied" };
  if (await isCommunityManager(database, input.communityId, input.profileId)) {
    return { gated: true, verdict: "allowed" };
  }
  try {
    const { getContentAccessGate } = await import("@/lib/server/access-gates");
    const gate = await getContentAccessGate(database, { targetType: "channel", targetId: input.channelId });
    if (!gate) return { gated: true, verdict: "unavailable" };
    const verdict = await verifier(database, input.profileId, {
      id: gate.id,
      match: gate.match,
      version: gate.version,
      conditions: gate.conditions.map((condition) => ({
        kind: condition.kind,
        chainId: condition.chainId,
        contract: condition.contract,
        minRaw: condition.minRaw,
        tokenIds: condition.tokenIds,
      })),
    });
    return { gated: true, verdict };
  } catch {
    return { gated: true, verdict: "unavailable" };
  }
}
