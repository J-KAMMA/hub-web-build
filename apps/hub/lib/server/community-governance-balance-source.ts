import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import { getAddress, isAddress } from 'viem';
import { getHubEvmNetworkByChainId } from './wallet-balance-verification';

export type GovernanceBalanceRule = { tokenId: string; tokensPerVote: number; weight: number };
export type GovernanceSourceGuard = { sql: string; args: (string | number | null)[] };
export class GovernanceBalanceSourceUnavailable extends Error {
  readonly status = 409;
  constructor(readonly unavailableReason: string) {
    super(unavailableReason === 'wallet_timestamp_mismatch'
      ? 'ウォレットと残高の検証時刻を確認できません。利用する資産の残高を再検証してください。'
      : '投票開始に使える検証済み残高を確認できません。');
  }
}
const fail = (reason: string): never => { throw new GovernanceBalanceSourceUnavailable(reason); };
const id = (value: unknown): value is string => typeof value === 'string' && value.length >= 1 && value.length <= 100 && !/[^A-Za-z0-9_-]/.test(value);
const maxRaw = (1n << 256n) - 1n;
export const GOVERNANCE_BALANCE_MAX_AGE_MS = 15 * 60 * 1000;
const chains = [1, 137, 80002, 8453, 42161, 10].map(getHubEvmNetworkByChainId);
function network(value: unknown) {
  if (typeof value !== 'string' || value.length > 80 || /[\u0000-\u001f\u007f]/.test(value)) return fail('unsupported_network');
  return chains.find(({ aliases }) => aliases.includes(value.trim().toLowerCase())) ?? fail('unsupported_network');
}
function address(value: unknown): string {
  if (typeof value !== 'string' || !isAddress(value, { strict: true })) return fail('invalid_address');
  return getAddress(value).toLowerCase();
}
function time(value: unknown): number {
  if (typeof value !== 'string' || value.length > 64 || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return fail('invalid_timestamp');
  const parsed = Date.parse(value);
  if (new Date(parsed).toISOString().slice(0,19) !== value.slice(0,19)) fail('invalid_timestamp');
  return parsed;
}
function positive(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > max) return fail('invalid_rule');
  return value;
}
// Decimal strings of JS configuration numbers, not their binary floating point approximation.
function rational(value: number): [bigint, bigint] {
  const [mantissa, exponent = '0'] = String(value).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const scale = fraction.length - Number(exponent), digits = BigInt(whole + fraction);
  return scale >= 0 ? [digits, 10n ** BigInt(scale)] : [digits * 10n ** BigInt(-scale), 1n];
}
export function exactGovernanceTokenWeight(observations: { rawAmount: string; decimals: number; tokensPerVote: number; weight: number }[]) {
  if (!Array.isArray(observations) || observations.length > 100) fail('invalid_rule');
  let numerator = 0n, denominator = 1n, holder = false;
  for (const observation of observations) {
    if (!observation || typeof observation.rawAmount !== 'string' || observation.rawAmount.length > 78 || !/^(0|[1-9][0-9]*)$/.test(observation.rawAmount) || /[^0-9]/.test(observation.rawAmount)) fail('invalid_raw_amount');
    const raw = BigInt(observation.rawAmount);
    if (raw > maxRaw || !Number.isInteger(observation.decimals) || observation.decimals < 0 || observation.decimals > 255) fail('invalid_raw_amount');
    const [unitN, unitD] = rational(positive(observation.tokensPerVote, Number.MAX_SAFE_INTEGER));
    const [weightN, weightD] = rational(positive(observation.weight, 1000));
    const units = raw * unitD / (10n ** BigInt(observation.decimals) * unitN);
    numerator = numerator * weightD + units * weightN * denominator;
    denominator *= weightD;
    holder ||= raw > 0n;
  }
  const combined = numerator / denominator;
  if (combined > BigInt(Number.MAX_SAFE_INTEGER)) fail('unsafe_token_weight');
  return { tokenWeight: Number(combined), holder };
}

type Row = Record<string, unknown>;
const MAX_D1_VALUE_BYTES = 2_000_000;
function bounded(value: string) {
  if (new TextEncoder().encode(value).length > MAX_D1_VALUE_BYTES) fail('source_too_large');
  return value;
}
async function capture(db: D1Database, from: string, columns: string[], order: string, args: (string | number | null)[], guards: GovernanceSourceGuard[]) {
  const query = `SELECT COALESCE(json_group_array(json_object(${columns.map(column => `'${column}',${column}`).join(',')})), '[]') AS value FROM (SELECT ${columns.join(',')} ${from} ORDER BY ${order})`;
  if (columns.length * 2 > 32 || args.length + 1 > 100 || new TextEncoder().encode(query).length > 100_000) fail('source_too_large');
  for (const arg of args) if (typeof arg === 'string') bounded(arg);
  let value: string;
  try {
    const row = await db.prepare(query).bind(...args).first<{ value: string }>();
    if (!row || typeof row.value !== 'string') return fail('reader_unavailable');
    value = row.value;
  } catch { return fail('reader_unavailable'); }
  bounded(value);
  let rows: Row[];
  try { rows = JSON.parse(value); } catch { return fail('reader_unavailable'); }
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail('reader_unavailable');
  guards.push({ sql: `(${query}) = ?`, args: [...args, value] });
  return rows;
}

/** Freezes recent signed observations, not current block balances. Provenance is server-internal.
 * Existing writers never change a wallet link's address/owner/id or a ranking's asset tuple.
 * If either becomes editable, snapshots need immutable observation provenance before reuse.
 */
export async function readGovernanceBalanceSourcesForMembers(db: D1Database, cid: string, profileIds: string[], rules: GovernanceBalanceRule[], now = new Date().toISOString()) {
  if (!id(cid) || !Array.isArray(profileIds) || profileIds.some(profile => !id(profile)) || new Set(profileIds).size !== profileIds.length || !Array.isArray(rules) || rules.length > 100 || new Set(rules.map(rule => rule?.tokenId)).size !== rules.length) fail('invalid_rule');
  const fixedRules = rules.map(rule => { if (!rule || !id(rule.tokenId)) return fail('invalid_rule'); return { tokenId: rule.tokenId, tokensPerVote: positive(rule.tokensPerVote, Number.MAX_SAFE_INTEGER), weight: positive(rule.weight, 1000) }; });
  const fixedProfiles = [...profileIds];
  const nowMs = time(now), guards: GovernanceSourceGuard[] = [], requestedProfiles = new Set(fixedProfiles);
  const sources = new Map<string, { kind: 'verified' | 'no_link'; tokenWeight: number; holder: boolean; provenance: {version:number;sourceBasis:string;maxAgeMs:number;profileId:string;sources:Row[]} }>();
  const profilesJson = bounded(JSON.stringify(fixedProfiles)), assetIdsJson = bounded(JSON.stringify(fixedRules.map(rule => rule.tokenId)));
  if (!fixedProfiles.length) return { sources, guards };
  const wallets = await capture(db, 'FROM profile_wallet_links WHERE profile_id IN (SELECT value FROM json_each(?)) AND active = 1', ['id','profile_id','chain_id','network','wallet_address','verified_at','last_balance_refresh_at','created_at','active','unlinked_at'], 'profile_id,id', [profilesJson], guards);
  const assets = await capture(db, 'FROM community_tokens WHERE community_id = ? AND id IN (SELECT value FROM json_each(?))', ['id','community_id','symbol','network','contract_address'], 'id', [cid, assetIdsJson], guards);
  const walletGroups = new Map<string, Row[]>();
  for (const wallet of wallets) { const profile = wallet.profile_id as string; if (!requestedProfiles.has(profile)) fail('wallet_source_mismatch'); const group = walletGroups.get(profile) ?? []; group.push(wallet); walletGroups.set(profile, group); }
  const mappings = fixedRules.map(rule => {
    const matches = assets.filter(asset => asset.id === rule.tokenId && asset.community_id === cid);
    if (matches.length !== 1) return fail('asset_unavailable');
    const asset = matches[0], chain = network(asset.network);
    const contract = asset.contract_address === null ? null : address(asset.contract_address);
    if (typeof asset.symbol !== 'string' || [...asset.symbol].length < 1 || [...asset.symbol].length > 16 || /[\uD800-\uDFFF]/u.test(asset.symbol) || /[\u0000-\u001f\u007f]/.test(asset.symbol)) fail('invalid_asset');
    return { rule, chain, contract };
  });
  const tuplesJson = bounded(JSON.stringify(mappings.map(({chain,contract}) => ({aliases:chain.aliases,contract}))));
  const needsObservations = wallets.length > 0 && mappings.length > 0;
  const rankings = needsObservations ? await capture(db, `FROM token_rankings WHERE EXISTS(SELECT 1 FROM json_each(?) asset WHERE lower(trim(network)) IN (SELECT value FROM json_each(json_extract(asset.value,'$.aliases'))) AND (contract_address IS NULL AND json_extract(asset.value,'$.contract') IS NULL OR lower(contract_address) = json_extract(asset.value,'$.contract')))`, ['id','network','contract_address'], 'id', [tuplesJson], guards) : [];
  const selected = needsObservations ? mappings.map(({chain,contract}) => {
    const candidates = rankings.filter(row => typeof row.network === 'string' && chain.aliases.includes(row.network.trim().toLowerCase()) && (row.contract_address === null ? null : typeof row.contract_address === 'string' ? row.contract_address.toLowerCase() : undefined) === contract);
    if (candidates.length !== 1 || !id(candidates[0].id)) fail('ambiguous_asset_ranking');
    const ranking = candidates[0];
    if (network(ranking.network).chain.id !== chain.chain.id || (ranking.contract_address === null ? null : address(ranking.contract_address)) !== contract) fail('asset_mismatch');
    return ranking;
  }) : [];
  const snapshots = needsObservations ? await capture(db, 'FROM token_balance_snapshots WHERE profile_id IN (SELECT value FROM json_each(?)) AND ranking_id IN (SELECT value FROM json_each(?))', ['profile_id','ranking_id','wallet_link_id','raw_amount','token_decimals','verified_at'], 'profile_id,ranking_id', [bounded(JSON.stringify(fixedProfiles.filter(profile => walletGroups.has(profile)))),bounded(JSON.stringify(selected.map(row => row.id)))], guards) : [];
  const snapshotIndex = new Map<string, Row[]>();
  for (const snapshot of snapshots) { const key = JSON.stringify([snapshot.profile_id,snapshot.ranking_id]), group = snapshotIndex.get(key) ?? []; group.push(snapshot); snapshotIndex.set(key, group); }
  let earliestExpiry = Infinity, latestVerified = -Infinity;
  for (const profileId of fixedProfiles) {
    const ownWallets = walletGroups.get(profileId) ?? [], observations: {rawAmount:string;decimals:number;tokensPerVote:number;weight:number}[] = [], provenanceSources: Row[] = [];
    for (const [index, {rule,chain,contract}] of mappings.entries()) {
      const source = { tokenId: rule.tokenId, chainId: chain.chain.id, contractAddress: contract, tokensPerVote: rule.tokensPerVote, weight: rule.weight };
      if (!ownWallets.length) { provenanceSources.push({ ...source, kind: 'no_link' }); continue; }
      const ranking = selected[index], matches = snapshotIndex.get(JSON.stringify([profileId,ranking.id])) ?? [];
      if (matches.length !== 1) fail('observation_missing');
      const snapshot = matches[0], wallet = ownWallets.find(row => row.id === snapshot.wallet_link_id) ?? fail('wallet_source_mismatch');
      if (snapshot.profile_id !== profileId || snapshot.ranking_id !== ranking.id) fail('observation_source_mismatch');
      if (!id(wallet.id) || wallet.profile_id !== profileId || wallet.active !== 1 || wallet.unlinked_at !== null || wallet.chain_id !== chain.chain.id || network(wallet.network).chain.id !== chain.chain.id) fail('wallet_source_mismatch');
      const walletAddress = address(wallet.wallet_address);
      const verified = time(snapshot.verified_at);
      if (verified > nowMs || nowMs - verified > GOVERNANCE_BALANCE_MAX_AGE_MS) fail('observation_stale');
      earliestExpiry = Math.min(earliestExpiry, verified + GOVERNANCE_BALANCE_MAX_AGE_MS); latestVerified = Math.max(latestVerified, verified);
      // The link may refresh another asset or leave/return to this chain; its address/owner stays fixed.
      const walletVerified = time(wallet.verified_at), walletRefreshed = time(wallet.last_balance_refresh_at);
      if (time(wallet.created_at) > verified || verified > walletVerified || walletVerified > walletRefreshed || walletRefreshed > nowMs) fail('wallet_timestamp_mismatch');
      observations.push({ rawAmount: snapshot.raw_amount as string, decimals: snapshot.token_decimals as number, tokensPerVote: rule.tokensPerVote, weight: rule.weight });
      provenanceSources.push({ ...source, kind: 'verified', rankingId: ranking.id, walletLinkId: wallet.id, walletAddress, rawAmount: snapshot.raw_amount, decimals: snapshot.token_decimals, verifiedAt: snapshot.verified_at });
    }
    sources.set(profileId, { kind: ownWallets.length ? 'verified' : 'no_link', ...exactGovernanceTokenWeight(observations), provenance: { version: 1, sourceBasis: 'recent_verified_balance', maxAgeMs: GOVERNANCE_BALANCE_MAX_AGE_MS, profileId, sources: provenanceSources } });
  }
  if (Number.isFinite(latestVerified)) guards.push({ sql: "strftime('%Y-%m-%dT%H:%M:%fZ','now') BETWEEN ? AND ?", args: [new Date(latestVerified).toISOString(), new Date(earliestExpiry).toISOString()] });
  return { sources, guards };
}

export async function readGovernanceBalanceSources(db: D1Database, cid: string, profileId: string, rules: GovernanceBalanceRule[], now = new Date().toISOString()) {
  const { sources, guards } = await readGovernanceBalanceSourcesForMembers(db, cid, [profileId], rules, now);
  const source = sources.get(profileId) ?? fail('reader_unavailable');
  return { ...source, guards };
}
