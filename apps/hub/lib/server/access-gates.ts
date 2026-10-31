import type { D1Database } from "@cloudflare/workers-types";
import { isAddress } from "viem";

import { normalizeSolanaAddress } from "@/lib/chains/address/solana";
import { getBitcoinNetwork, resolveBitcoinIndexer } from "@/lib/chains/bitcoin-chain-registry";
import { isSolanaChainActive } from "@/lib/chains/solana-chain-registry";

import {
  ACCESS_GATE_CONDITION_KINDS,
  ACCESS_GATE_MATCHES,
  ACCESS_GATE_MAX_ACQUISITION_URL_LENGTH,
  ACCESS_GATE_MAX_CONDITIONS,
  ACCESS_GATE_MAX_DESCRIPTION_LENGTH,
  ACCESS_GATE_MAX_MIN_RAW_DIGITS,
  ACCESS_GATE_MAX_TOKEN_IDS,
  ACCESS_GATE_TARGET_TYPES,
  isAllowedAccessGateChain,
  isBitcoinGateKind,
  isSolanaGateKind,
  type AccessGate,
  type AccessGateCondition,
  type AccessGateConditionInput,
  type AccessGateConditionKind,
  type AccessGateInput,
  type AccessGateMatch,
  type AccessGateTarget,
  type AccessGateTargetType,
  type PublicAccessGate,
} from "@/lib/access-gates/types";

export class AccessGateValidationError extends Error {}
export class AccessGateForbiddenError extends Error {}
export class AccessGateNotFoundError extends Error {}
export class AccessGateConflictError extends Error {}

const UINT256_MAX = (BigInt(1) << BigInt(256)) - BigInt(1);
const INTEGER_STRING = /^(0|[1-9][0-9]*)$/;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = new RegExp("[\u0000-\u001f\u007f-\u009f\u2028\u2029]");

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AccessGateValidationError(message);
  }
  return value as Record<string, unknown>;
}

function uint256String(value: unknown, field: string): string {
  if (typeof value !== "string" || !INTEGER_STRING.test(value) || value.length > ACCESS_GATE_MAX_MIN_RAW_DIGITS) {
    throw new AccessGateValidationError(`${field}は整数の文字列で指定してください。`);
  }
  if (BigInt(value) > UINT256_MAX) {
    throw new AccessGateValidationError(`${field}が大きすぎます。`);
  }
  return value;
}

export function normalizeGateContract(value: unknown): string {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    throw new AccessGateValidationError("コントラクトアドレスが正しくありません。");
  }
  return value.toLowerCase();
}

export function normalizeAcquisitionUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > ACCESS_GATE_MAX_ACQUISITION_URL_LENGTH) {
    throw new AccessGateValidationError("入手先リンクが長すぎるか、形式が正しくありません。");
  }
  if (CONTROL_CHARACTERS.test(value) || /\s/.test(value)) {
    throw new AccessGateValidationError("入手先リンクに空白や制御文字は使えません。");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AccessGateValidationError("入手先リンクの形式が正しくありません。");
  }
  if (url.protocol !== "https:") {
    throw new AccessGateValidationError("入手先リンクはhttpsだけ使えます。");
  }
  if (url.username || url.password) {
    throw new AccessGateValidationError("入手先リンクに認証情報は含められません。");
  }
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) {
    throw new AccessGateValidationError("入手先リンクのホストが正しくありません。");
  }
  const href = url.href;
  if (href.length > ACCESS_GATE_MAX_ACQUISITION_URL_LENGTH) {
    throw new AccessGateValidationError("入手先リンクが長すぎます。");
  }
  return href;
}

const UINT64_MAX = (BigInt(1) << BigInt(64)) - BigInt(1);

function validateSolanaCondition(input: Record<string, unknown>, kind: "sol_native" | "spl" | "spl_mints"): AccessGateConditionInput {
  const chainRef = input.chainRef;
  if (typeof chainRef !== "string" || !chainRef.startsWith("solana:") || !isSolanaChainActive(chainRef, process.env)) {
    throw new AccessGateValidationError("未対応のチェーンです。");
  }
  let decimals: number | null = null;
  if (input.decimals !== undefined && input.decimals !== null) {
    if (typeof input.decimals !== "number" || !Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 255) {
      throw new AccessGateValidationError("小数桁数が正しくありません。");
    }
    decimals = input.decimals;
  }
  const amount = (): string => {
    const value = uint256String(input.minRaw, "最小量");
    if (BigInt(value) === BigInt(0) || BigInt(value) > UINT64_MAX) throw new AccessGateValidationError("最小量は1以上の64ビット整数にしてください。");
    return value;
  };
  const mint = (value: unknown): string => {
    const normalized = normalizeSolanaAddress(value);
    if (!normalized) throw new AccessGateValidationError("ミントアドレスが正しくありません。");
    return normalized;
  };
  if (kind === "sol_native") {
    if ((input.contract !== undefined && input.contract !== null && input.contract !== "") || (Array.isArray(input.tokenIds) && input.tokenIds.length > 0)) {
      throw new AccessGateValidationError("SOLにミントは指定できません。");
    }
    return { kind, chainId: 0, chainRef, contract: "", minRaw: amount(), tokenIds: [], decimals: 9 };
  }
  if (kind === "spl") {
    if (Array.isArray(input.tokenIds) && input.tokenIds.length > 0) throw new AccessGateValidationError("SPLにトークンIDは指定できません。");
    return { kind, chainId: 0, chainRef, contract: mint(input.contract), minRaw: amount(), tokenIds: [], decimals };
  }
  const list = input.tokenIds;
  if (!Array.isArray(list) || list.length === 0 || list.length > ACCESS_GATE_MAX_TOKEN_IDS) {
    throw new AccessGateValidationError(`ミントは1〜${ACCESS_GATE_MAX_TOKEN_IDS}件で指定してください。`);
  }
  const mints = list.map(mint);
  if (new Set(mints).size !== mints.length) throw new AccessGateValidationError("ミントが重複しています。");
  // The first mint is the condition anchor (the contract column); the full set is stored in token_ids.
  return { kind, chainId: 0, chainRef, contract: mints[0], minRaw: "1", tokenIds: mints, decimals: 0 };
}

function validateBitcoinCondition(input: Record<string, unknown>): AccessGateConditionInput {
  const chainRef = input.chainRef;
  const network = typeof chainRef === "string" ? getBitcoinNetwork(chainRef) : null;
  // Gates read only from the configured indexer (never a default), so a network without one cannot take a gate.
  if (typeof chainRef !== "string" || !network || !resolveBitcoinIndexer(network, process.env)) {
    throw new AccessGateValidationError("未対応のチェーンです。");
  }
  if ((input.contract !== undefined && input.contract !== null && input.contract !== "") || (Array.isArray(input.tokenIds) && input.tokenIds.length > 0)) {
    throw new AccessGateValidationError("BTCにコントラクトやトークンIDは指定できません。");
  }
  const value = uint256String(input.minRaw, "最小量");
  if (BigInt(value) === BigInt(0) || BigInt(value) > BigInt(21_000_000) * BigInt(100_000_000)) throw new AccessGateValidationError("最小量は1satoshi以上、2,100万BTC以下にしてください。");
  return { kind: "btc_native", chainId: 0, chainRef, contract: "", minRaw: value, tokenIds: [], decimals: 8 };
}

function validateCondition(raw: unknown): AccessGateConditionInput {
  const input = record(raw, "条件の形式が正しくありません。");
  const kind = input.kind;
  if (typeof kind === "string" && isSolanaGateKind(kind)) return validateSolanaCondition(input, kind);
  if (typeof kind === "string" && isBitcoinGateKind(kind)) return validateBitcoinCondition(input);
  if (typeof kind !== "string" || !(ACCESS_GATE_CONDITION_KINDS as readonly string[]).includes(kind)) {
    throw new AccessGateValidationError("未対応の条件の種類です。");
  }
  const chainId = input.chainId;
  if (typeof chainId !== "number" || !Number.isSafeInteger(chainId) || !isAllowedAccessGateChain(chainId)) {
    throw new AccessGateValidationError("未対応のチェーンです。");
  }
  const contract = normalizeGateContract(input.contract);

  let tokenIds: string[] = [];
  if (input.tokenIds !== undefined && input.tokenIds !== null) {
    if (!Array.isArray(input.tokenIds) || input.tokenIds.length > ACCESS_GATE_MAX_TOKEN_IDS) {
      throw new AccessGateValidationError(`トークンIDは${ACCESS_GATE_MAX_TOKEN_IDS}件までです。`);
    }
    tokenIds = input.tokenIds.map((id) => uint256String(id, "トークンID"));
    if (new Set(tokenIds).size !== tokenIds.length) {
      throw new AccessGateValidationError("トークンIDが重複しています。");
    }
  }

  let decimals: number | null = null;
  if (input.decimals !== undefined && input.decimals !== null) {
    if (typeof input.decimals !== "number" || !Number.isInteger(input.decimals) || input.decimals < 0 || input.decimals > 255) {
      throw new AccessGateValidationError("小数桁数が正しくありません。");
    }
    decimals = input.decimals;
  }

  const typedKind = kind as AccessGateConditionKind;
  let minRaw: string;
  if (typedKind === "erc20") {
    if (tokenIds.length > 0) throw new AccessGateValidationError("ERC-20にトークンIDは指定できません。");
    minRaw = uint256String(input.minRaw, "最小量");
    if (BigInt(minRaw) === BigInt(0)) throw new AccessGateValidationError("最小量は1以上にしてください。");
  } else if (typedKind === "erc1155") {
    if (tokenIds.length !== 1) throw new AccessGateValidationError("ERC-1155はトークンIDを1件だけ指定してください。");
    minRaw = uint256String(input.minRaw, "最小量");
    if (BigInt(minRaw) === BigInt(0)) throw new AccessGateValidationError("最小量は1以上にしてください。");
  } else {
    // erc721: one or more of the collection, or any of the listed token ids.
    minRaw = "1";
  }
  return { kind: typedKind, chainId, contract, minRaw, tokenIds, decimals };
}

/** Validate and normalise untrusted gate input. Throws AccessGateValidationError. */
export function validateAccessGateInput(raw: unknown): AccessGateInput {
  const input = record(raw, "門の形式が正しくありません。");
  const match = input.match;
  if (typeof match !== "string" || !(ACCESS_GATE_MATCHES as readonly string[]).includes(match)) {
    throw new AccessGateValidationError("matchはanyかallを指定してください。");
  }
  let description = "";
  if (input.description !== undefined && input.description !== null) {
    if (typeof input.description !== "string") throw new AccessGateValidationError("説明の形式が正しくありません。");
    description = input.description.trim();
    if (description.length > ACCESS_GATE_MAX_DESCRIPTION_LENGTH) {
      throw new AccessGateValidationError(`説明は${ACCESS_GATE_MAX_DESCRIPTION_LENGTH}字までです。`);
    }
    if (CONTROL_CHARACTERS.test(description.replace(/\n/g, ""))) {
      throw new AccessGateValidationError("説明に制御文字は使えません。");
    }
  }
  if (!Array.isArray(input.conditions) || input.conditions.length === 0) {
    throw new AccessGateValidationError("条件を1つ以上指定してください。");
  }
  if (input.conditions.length > ACCESS_GATE_MAX_CONDITIONS) {
    throw new AccessGateValidationError(`条件は${ACCESS_GATE_MAX_CONDITIONS}つまでです。`);
  }
  return {
    match: match as AccessGateMatch,
    description,
    acquisitionUrl: normalizeAcquisitionUrl(input.acquisitionUrl),
    conditions: input.conditions.map(validateCondition),
  };
}

type GateRow = {
  id: string;
  owner_profile_id: string;
  match: string;
  description: string;
  acquisition_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};
type ConditionRow = {
  gate_id: string;
  ordinal: number;
  kind: string;
  chain_id: number | null;
  chain_ref?: string | null;
  contract: string | null;
  min_raw: string;
  token_ids: string;
  decimals: number | null;
};

function conditionFromRow(row: ConditionRow): AccessGateCondition {
  let tokenIds: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.token_ids);
    if (Array.isArray(parsed)) tokenIds = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    tokenIds = [];
  }
  return {
    ordinal: Number(row.ordinal),
    kind: row.kind as AccessGateConditionKind,
    chainId: row.chain_id === null || row.chain_id === undefined ? 0 : Number(row.chain_id),
    chainRef: row.chain_ref ?? (row.chain_id ? `eip155:${row.chain_id}` : undefined),
    contract: row.contract ?? "",
    minRaw: row.min_raw,
    tokenIds,
    decimals: row.decimals === null ? null : Number(row.decimals),
  };
}

function gateFromRows(row: GateRow, conditions: ConditionRow[]): AccessGate {
  return {
    id: row.id,
    ownerProfileId: row.owner_profile_id,
    match: row.match as AccessGateMatch,
    description: row.description,
    acquisitionUrl: row.acquisition_url,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    conditions: conditions.map(conditionFromRow).sort((a, b) => a.ordinal - b.ordinal),
  };
}

export function toPublicAccessGate(gate: AccessGate): PublicAccessGate {
  return {
    id: gate.id,
    version: gate.version,
    match: gate.match,
    description: gate.description,
    acquisitionUrl: gate.acquisitionUrl,
    conditions: gate.conditions,
  };
}

function conditionStatements(database: D1Database, gateId: string, conditions: AccessGateConditionInput[]) {
  return conditions.map((condition, ordinal) =>
    database
      .prepare(`INSERT INTO access_gate_conditions
        (gate_id, ordinal, kind, chain_ref, chain_id, contract, min_raw, token_ids, decimals)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        gateId,
        ordinal,
        condition.kind,
        isSolanaGateKind(condition.kind) || isBitcoinGateKind(condition.kind) ? condition.chainRef ?? "" : `eip155:${condition.chainId}`,
        isSolanaGateKind(condition.kind) || isBitcoinGateKind(condition.kind) ? null : condition.chainId,
        condition.kind === "sol_native" || condition.kind === "btc_native" ? null : condition.contract,
        condition.minRaw ?? "1",
        JSON.stringify(condition.tokenIds ?? []),
        condition.decimals ?? null,
      ),
  );
}

export async function getAccessGate(database: D1Database, gateId: string): Promise<AccessGate | null> {
  const row = await database
    .prepare(`SELECT id, owner_profile_id, match, description, acquisition_url, version, created_at, updated_at
      FROM access_gates WHERE id = ? LIMIT 1`)
    .bind(gateId)
    .first<GateRow>();
  if (!row) return null;
  const { results } = await database
    .prepare(`SELECT gate_id, ordinal, kind, chain_ref, chain_id, contract, min_raw, token_ids, decimals
      FROM access_gate_conditions WHERE gate_id = ? ORDER BY ordinal`)
    .bind(gateId)
    .all<ConditionRow>();
  return gateFromRows(row, results ?? []);
}

export async function listAccessGatesForOwner(database: D1Database, ownerProfileId: string): Promise<AccessGate[]> {
  const { results } = await database
    .prepare(`SELECT id FROM access_gates WHERE owner_profile_id = ? ORDER BY created_at DESC, id LIMIT 100`)
    .bind(ownerProfileId)
    .all<{ id: string }>();
  const gates: AccessGate[] = [];
  for (const { id } of results ?? []) {
    const gate = await getAccessGate(database, id);
    if (gate) gates.push(gate);
  }
  return gates;
}

export async function createAccessGate(
  database: D1Database,
  ownerProfileId: string,
  raw: unknown,
): Promise<AccessGate> {
  const input = validateAccessGateInput(raw);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(`INSERT INTO access_gates
        (id, owner_profile_id, match, description, acquisition_url, version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(id, ownerProfileId, input.match, input.description, input.acquisitionUrl, now, now),
    ...conditionStatements(database, id, input.conditions),
  ]);
  const created = await getAccessGate(database, id);
  if (!created) throw new Error("access_gate_create_failed");
  return created;
}

async function requireOwnedGate(database: D1Database, ownerProfileId: string, gateId: string): Promise<AccessGate> {
  const gate = await getAccessGate(database, gateId);
  if (!gate) throw new AccessGateNotFoundError("門が見つかりません。");
  if (gate.ownerProfileId !== ownerProfileId) throw new AccessGateForbiddenError("この門を変更する権限がありません。");
  return gate;
}

/** Replace conditions; bumps version and discards every cached check for the gate. */
export async function updateAccessGate(
  database: D1Database,
  ownerProfileId: string,
  gateId: string,
  raw: unknown,
): Promise<AccessGate> {
  const input = validateAccessGateInput(raw);
  await requireOwnedGate(database, ownerProfileId, gateId);
  const now = new Date().toISOString();
  await database.batch([
    database
      .prepare(`UPDATE access_gates SET match = ?, description = ?, acquisition_url = ?,
        version = version + 1, updated_at = ? WHERE id = ? AND owner_profile_id = ?`)
      .bind(input.match, input.description, input.acquisitionUrl, now, gateId, ownerProfileId),
    database.prepare("DELETE FROM access_gate_conditions WHERE gate_id = ?").bind(gateId),
    ...conditionStatements(database, gateId, input.conditions),
    database.prepare("DELETE FROM access_gate_checks WHERE gate_id = ?").bind(gateId),
  ]);
  const updated = await getAccessGate(database, gateId);
  if (!updated) throw new Error("access_gate_update_failed");
  return updated;
}

/** A gate still attached to content cannot be deleted: removing it would silently open the content. */
export async function deleteAccessGate(database: D1Database, ownerProfileId: string, gateId: string): Promise<void> {
  await requireOwnedGate(database, ownerProfileId, gateId);
  const attached = await database
    .prepare("SELECT 1 AS present FROM content_access_gates WHERE gate_id = ? LIMIT 1")
    .bind(gateId)
    .first<{ present: number }>();
  if (attached) throw new AccessGateConflictError("コンテンツに付いている門は削除できません。先に外してください。");
  await database.prepare("DELETE FROM access_gates WHERE id = ? AND owner_profile_id = ?").bind(gateId, ownerProfileId).run();
}

export function parseAccessGateTarget(targetType: unknown, targetId: unknown): AccessGateTarget {
  if (typeof targetType !== "string" || !(ACCESS_GATE_TARGET_TYPES as readonly string[]).includes(targetType)) {
    throw new AccessGateValidationError("対象の種類が正しくありません。");
  }
  if (typeof targetId !== "string" || targetId.length < 1 || targetId.length > 200 || CONTROL_CHARACTERS.test(targetId)) {
    throw new AccessGateValidationError("対象のIDが正しくありません。");
  }
  return { targetType: targetType as AccessGateTargetType, targetId };
}

/**
 * Whether the profile may attach or detach a gate on the target: the content's
 * author (post, article, video, thread) or the community owner/moderator
 * (channel). Unknown or missing targets are not manageable.
 */
export async function canManageGatedTarget(
  database: D1Database,
  profileId: string,
  target: AccessGateTarget,
): Promise<boolean> {
  const { targetType, targetId } = target;
  if (targetType === "channel") {
    const row = await database
      .prepare(`SELECT 1 AS ok FROM community_channels channel
        JOIN community_memberships member ON member.community_id = channel.community_id
        WHERE channel.id = ? AND member.profile_id = ? AND member.status = 'active'
          AND member.role IN ('owner', 'moderator') LIMIT 1`)
      .bind(targetId, profileId)
      .first<{ ok: number }>();
    return row !== null;
  }
  const authorQuery: Record<Exclude<AccessGateTargetType, "channel">, string> = {
    post: "SELECT 1 AS ok FROM social_posts WHERE id = ? AND author_profile_id = ? LIMIT 1",
    article: "SELECT 1 AS ok FROM hub_user_articles WHERE id = ? AND author_profile_id = ? LIMIT 1",
    // External catalog rows and Hub self-made videos (hub_videos, migration 0266) both use target type "video".
    video: `SELECT 1 AS ok FROM (
      SELECT id, submitted_by_profile_id AS owner FROM external_videos
      UNION ALL SELECT id, profile_id AS owner FROM hub_videos WHERE state <> 'deleted'
    ) WHERE id = ? AND owner = ? LIMIT 1`,
    thread: "SELECT 1 AS ok FROM threads WHERE id = ? AND created_by_profile_id = ? LIMIT 1",
  };
  const row = await database.prepare(authorQuery[targetType]).bind(targetId, profileId).first<{ ok: number }>();
  return row !== null;
}

/** Attach (or replace) the one gate on a target. Caller must own both the gate and the content. */
export async function attachAccessGate(
  database: D1Database,
  profileId: string,
  rawTarget: { targetType: unknown; targetId: unknown },
  gateId: string,
): Promise<AccessGateTarget & { gateId: string }> {
  const target = parseAccessGateTarget(rawTarget.targetType, rawTarget.targetId);
  await requireOwnedGate(database, profileId, gateId);
  if (!(await canManageGatedTarget(database, profileId, target))) {
    throw new AccessGateForbiddenError("このコンテンツに門を付ける権限がありません。");
  }
  // A CC license lets anyone redistribute, so it cannot coexist with a gate (PLAN 7.1). Enforced again by a trigger.
  const licensed = await database
    .prepare("SELECT 1 AS ok FROM content_licenses WHERE target_type = ? AND target_id = ? AND license <> 'arr' LIMIT 1")
    .bind(target.targetType, target.targetId)
    .first<{ ok: number }>();
  if (licensed) throw new AccessGateConflictError("CCライセンスが付いたコンテンツには、閲覧条件を付けられません。先にライセンスを「全権利留保」に戻してください。");
  if (target.targetType === "video") {
    const licensedVideo = await database
      .prepare("SELECT 1 AS ok FROM hub_videos WHERE id = ? AND license <> 'arr' LIMIT 1")
      .bind(target.targetId)
      .first<{ ok: number }>();
    if (licensedVideo) throw new AccessGateConflictError("CCライセンスが付いた動画には、閲覧条件を付けられません。先にライセンスを「全権利留保」に戻してください。");
  }
  await database
    .prepare(`INSERT INTO content_access_gates (target_type, target_id, gate_id, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(target_type, target_id) DO UPDATE SET gate_id = excluded.gate_id`)
    .bind(target.targetType, target.targetId, gateId, new Date().toISOString())
    .run();
  return { ...target, gateId };
}

export async function detachAccessGate(
  database: D1Database,
  profileId: string,
  rawTarget: { targetType: unknown; targetId: unknown },
): Promise<void> {
  const target = parseAccessGateTarget(rawTarget.targetType, rawTarget.targetId);
  if (!(await canManageGatedTarget(database, profileId, target))) {
    throw new AccessGateForbiddenError("このコンテンツの門を外す権限がありません。");
  }
  await database
    .prepare("DELETE FROM content_access_gates WHERE target_type = ? AND target_id = ?")
    .bind(target.targetType, target.targetId)
    .run();
  // Files exist only on gated content: removing the gate unpublishes them in the same operation.
  if (target.targetType === "post" || target.targetType === "article") {
    const { unpublishAttachedFiles } = await import("@/lib/server/content-files");
    await unpublishAttachedFiles(database, { targetType: target.targetType, targetId: target.targetId });
  }
  // A gated self-made video without its gate must not stay playable: unpublish it with the gate.
  if (target.targetType === "video") {
    const { unpublishHubVideo } = await import("@/lib/server/hub-videos");
    const { hubVideoDepsFromEnv } = await import("@/lib/server/hub-videos-env");
    const gated = await database
      .prepare("SELECT id FROM hub_videos WHERE id = ? AND visibility = 'gated' LIMIT 1")
      .bind(target.targetId)
      .first<{ id: string }>();
    if (gated) await unpublishHubVideo(database, hubVideoDepsFromEnv(), gated.id);
  }
}

/** The gate on a target, or null when the target is open. Used by other lanes. */
export async function getContentAccessGate(
  database: D1Database,
  target: AccessGateTarget,
): Promise<AccessGate | null> {
  const row = await database
    .prepare("SELECT gate_id FROM content_access_gates WHERE target_type = ? AND target_id = ? LIMIT 1")
    .bind(target.targetType, target.targetId)
    .first<{ gate_id: string }>();
  return row ? getAccessGate(database, row.gate_id) : null;
}

/** Delete expired cache rows (periodic job). Returns nothing sensitive. */
export async function purgeExpiredAccessGateChecks(database: D1Database, now = new Date()): Promise<void> {
  await database.prepare("DELETE FROM access_gate_checks WHERE expires_at <= ?").bind(now.toISOString()).run();
}

export type AccessGateUsage = { posts: number; articles: number; other: number };

/**
 * Where the owner's gates are attached: counts of attached content only, per gate.
 * This is never about who or how many people unlocked a gate.
 */
export async function listAccessGateUsageForOwner(database: D1Database, ownerProfileId: string): Promise<Record<string, AccessGateUsage>> {
  const { results } = await database
    .prepare(`SELECT c.gate_id AS gate_id, c.target_type AS target_type, COUNT(*) AS total
      FROM content_access_gates c JOIN access_gates g ON g.id = c.gate_id
      WHERE g.owner_profile_id = ? GROUP BY c.gate_id, c.target_type`)
    .bind(ownerProfileId)
    .all<{ gate_id: string; target_type: string; total: number }>();
  const usage: Record<string, AccessGateUsage> = {};
  for (const row of results ?? []) {
    const entry = (usage[row.gate_id] ??= { posts: 0, articles: 0, other: 0 });
    if (row.target_type === "post") entry.posts += row.total;
    else if (row.target_type === "article") entry.articles += row.total;
    else entry.other += row.total;
  }
  return usage;
}
