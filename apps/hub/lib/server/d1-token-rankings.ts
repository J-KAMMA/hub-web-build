import type { D1Database } from "@cloudflare/workers-types";
import type { Profile, TokenRankingDefinition } from "@/lib/domain";
import { formatRawTokenAmount } from "@/lib/token-amount";

type RankingRow = {
  id: string;
  title: string;
  symbol: string;
  network: string;
  contract_address: string | null;
  description: string;
  created_by_profile_id: string;
  created_at: string;
  verification_status: "pending" | "verified" | "failed" | "not_applicable";
  last_verified_at: string | null;
  last_synced_at: string | null;
  holder_count: number;
  sync_error: string | null;
};
type ProfileRow = { id: string; handle: string; display_name: string; bio: string; avatar_url: string | null; joined_at: string };
type BalanceRow = ProfileRow & { symbol: string; raw_amount: string; token_decimals: number; updated_at: string };

export type D1SearchDateBounds = {
  fromInclusive: string | null;
  toExclusive: string | null;
};

function mapRanking(row: RankingRow): TokenRankingDefinition {
  return {
    id: row.id,
    title: row.title,
    symbol: row.symbol,
    network: row.network,
    contractAddress: row.contract_address ?? undefined,
    description: row.description,
    createdByProfileId: row.created_by_profile_id,
    createdAt: row.created_at,
    verificationStatus: row.verification_status,
    lastVerifiedAt: row.last_verified_at ?? undefined,
    lastSyncedAt: row.last_synced_at ?? undefined,
    holderCount: Number(row.holder_count ?? 0),
    syncError: row.sync_error ?? undefined,
  };
}

function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    handle: row.handle,
    displayName: row.display_name,
    bio: row.bio,
    avatarUrl: row.avatar_url ?? undefined,
    joinedAt: row.joined_at,
  };
}

export async function listD1TokenRankings(database: D1Database): Promise<TokenRankingDefinition[]> {
  const result = await database.prepare(`SELECT id, title, symbol, network, contract_address, description,
      created_by_profile_id, created_at, verification_status, last_verified_at, last_synced_at,
      holder_count, sync_error FROM token_rankings ORDER BY created_at DESC`).all<RankingRow>();
  return result.results.map(mapRanking);
}

/** Complete public token catalog traversal for date-filtered search. */
export async function listD1TokenRankingsForSearch(
  database: D1Database,
  dateBounds: D1SearchDateBounds,
): Promise<TokenRankingDefinition[]> {
  const dateClauses: string[] = [];
  const dateBindings: string[] = [];
  if (dateBounds.fromInclusive || dateBounds.toExclusive) {
    dateClauses.push("julianday(NULLIF(created_at, '')) IS NOT NULL");
    if (dateBounds.fromInclusive) {
      dateClauses.push("julianday(NULLIF(created_at, '')) >= julianday(?)");
      dateBindings.push(dateBounds.fromInclusive);
    }
    if (dateBounds.toExclusive) {
      dateClauses.push("julianday(NULLIF(created_at, '')) < julianday(?)");
      dateBindings.push(dateBounds.toExclusive);
    }
  }
  const result = await database.prepare(`SELECT id, title, symbol, network, contract_address, description,
      created_by_profile_id, created_at, verification_status, last_verified_at, last_synced_at,
      holder_count, sync_error FROM token_rankings
      ${dateClauses.length ? `WHERE ${dateClauses.join(" AND ")}` : ""}
      ORDER BY created_at DESC, id ASC`).bind(...dateBindings).all<RankingRow>();
  return result.results.map(mapRanking);
}

export async function getD1TokenRanking(
  database: D1Database,
  rankingId: string,
): Promise<TokenRankingDefinition | null> {
  const row = await database.prepare(`SELECT id, title, symbol, network, contract_address, description,
      created_by_profile_id, created_at, verification_status, last_verified_at, last_synced_at,
      holder_count, sync_error FROM token_rankings WHERE id = ? LIMIT 1`)
    .bind(rankingId)
    .first<RankingRow>();
  return row ? mapRanking(row) : null;
}

export async function createD1TokenRanking(
  database: D1Database,
  createdByProfileId: string,
  input: { title: string; symbol: string; network: string; contractAddress?: string; description: string },
): Promise<TokenRankingDefinition> {
  const ranking: TokenRankingDefinition = {
    id: `token-ranking-${crypto.randomUUID()}`,
    ...input,
    createdByProfileId,
    createdAt: new Date().toISOString(),
  };
  await database.prepare(`INSERT INTO token_rankings
      (id, title, symbol, network, contract_address, description, created_by_profile_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(ranking.id, ranking.title, ranking.symbol, ranking.network, ranking.contractAddress ?? null,
      ranking.description, ranking.createdByProfileId, ranking.createdAt).run();
  return ranking;
}

export async function canManageD1TokenRankings(database: D1Database, profileId: string): Promise<boolean> {
  const row = await database.prepare(`SELECT 1 AS allowed FROM community_memberships
      WHERE profile_id = ? AND role IN ('owner', 'moderator') LIMIT 1`)
    .bind(profileId).first<{ allowed: number }>();
  return Boolean(row?.allowed);
}

export async function getD1TokenRankingView(
  database: D1Database,
  rankingId: string,
  symbol: string,
  viewerProfileId: string | null,
) {
  const [profilesResult, balancesResult, viewerBalancesResult] = await Promise.all([
    database.prepare("SELECT id, handle, display_name, bio, avatar_url, joined_at FROM profiles ORDER BY joined_at")
      .all<ProfileRow>(),
    database.prepare(`SELECT p.id, p.handle, p.display_name, p.bio, p.avatar_url, p.joined_at,
        ? AS symbol, b.raw_amount, b.token_decimals, b.verified_at AS updated_at
        FROM token_balance_snapshots b
        JOIN profiles p ON p.id = b.profile_id
        JOIN profile_wallet_links wallet
          ON wallet.id = b.wallet_link_id
          AND wallet.profile_id = b.profile_id
        WHERE b.ranking_id = ? AND b.raw_amount != '0'
          AND wallet.active = 1 AND wallet.visibility = 'public'
        ORDER BY length(b.raw_amount) DESC, b.raw_amount DESC, p.handle`)
      .bind(symbol, rankingId).all<BalanceRow>(),
    viewerProfileId
      ? database.prepare(`SELECT ? AS symbol, raw_amount, token_decimals FROM token_balance_snapshots
          WHERE profile_id = ? AND ranking_id = ? AND raw_amount IS NOT NULL LIMIT 1`)
        .bind(symbol, viewerProfileId, rankingId).all<{ symbol: string; raw_amount: string; token_decimals: number }>()
      : Promise.resolve({ results: [] as Array<{ symbol: string; raw_amount: string; token_decimals: number }> }),
  ]);
  const profiles = profilesResult.results.map(mapProfile);
  return {
    profiles,
    ranking: balancesResult.results.map((row) => ({
      profile: mapProfile(row),
      balance: formatRawTokenAmount(row.raw_amount, Number(row.token_decimals)),
    })),
    balances: viewerBalancesResult.results.map((row) => ({
      symbol: row.symbol,
      amount: formatRawTokenAmount(row.raw_amount, Number(row.token_decimals)),
    })),
  };
}
