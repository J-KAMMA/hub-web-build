import type { D1Database } from "@cloudflare/workers-types";

import type {
  AccessGate,
  AccessGateCondition,
  AccessGateConditionKind,
  AccessGateMatch,
  AccessGateTargetType,
  PublicAccessGate,
} from "@/lib/access-gates/types";
import {
  checkGateForViewer,
  createGateVerificationDeps,
  type GateToVerify,
  type GateVerificationDeps,
} from "@/lib/server/access-gate-verification";
import { toPublicAccessGate } from "@/lib/server/access-gates";
import { isGateUnlockTargetType, scheduleGateUnlocks, type GateUnlockKey } from "@/lib/server/gate-unlock-library";

/**
 * Hub token gates, lane C (docs/hub-token-gates/DESIGN.md section 3): strips
 * gated bodies on the server before anything is rendered or serialized.
 *
 * Rules
 * - The author (and the gate owner) always see their own content.
 * - List contexts never call an RPC: only the cached check can open a card,
 *   anything uncached stays locked.
 * - Detail contexts run the full check (cache first, then the chain reads).
 * - Anything unexpected closes: the item is stripped, never passed through.
 */

export type GateAccessState = { gate: PublicAccessGate; status: "locked" | "unavailable" };
export type GatedContext = "list" | "detail";

/** Fields a locked item loses. A key is only touched when the item has it. */
const STRIPPED_KEYS = [
  "body",
  "bodyHtml",
  "bodyMarkdown",
  "excerpt",
  "summary",
  "images",
  "attachments",
  "embeds",
  "media",
  "mediaUrl",
  "sourceUrl",
  "thumbnailUrl",
  "thumbnail",
  "ogImage",
  "linkPreview",
  "referenced",
] as const;

/** Detail pages check at most this many different gates by RPC; the rest use the cache only. */
const DEFAULT_MAX_DETAIL_CHECKS = 5;
const ID_CHUNK = 80;

export class GatedContentUnavailableError extends Error {
  constructor() {
    super("gated_content_unavailable");
    this.name = "GatedContentUnavailableError";
  }
}

export type RedactGatedOptions = {
  context?: GatedContext;
  /** Gate target id of an item. Defaults to `item.id`; threads use `threadId`. */
  keyOf?: (item: never) => string | null | undefined;
  deps?: GateVerificationDeps;
  maxDetailChecks?: number;
};

/** Tiny adapter from lane A's AccessGate to lane B's GateToVerify. */
export function toGateToVerify(gate: AccessGate): GateToVerify {
  return {
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
  };
}

type GateJoinRow = {
  target_id: string;
  id: string;
  owner_profile_id: string;
  match: string;
  description: string;
  acquisition_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  ordinal: number | null;
  kind: string | null;
  chain_id: number | null;
  contract: string | null;
  min_raw: string | null;
  token_ids: string | null;
  decimals: number | null;
};

const GATE_JOIN_SELECT = `SELECT cag.target_id AS target_id, g.id AS id, g.owner_profile_id AS owner_profile_id,
  g.match AS match, g.description AS description, g.acquisition_url AS acquisition_url, g.version AS version,
  g.created_at AS created_at, g.updated_at AS updated_at,
  c.ordinal AS ordinal, c.kind AS kind, c.chain_id AS chain_id, c.contract AS contract,
  c.min_raw AS min_raw, c.token_ids AS token_ids, c.decimals AS decimals
  FROM content_access_gates cag
  JOIN access_gates g ON g.id = cag.gate_id
  LEFT JOIN access_gate_conditions c ON c.gate_id = g.id`;

function parseTokenIds(value: string | null): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

/** Groups join rows into gates, keyed by target id. */
function gatesFromRows(rows: readonly GateJoinRow[]): Map<string, AccessGate> {
  const byGate = new Map<string, AccessGate>();
  const byTarget = new Map<string, AccessGate>();
  for (const row of rows) {
    let gate = byGate.get(row.id);
    if (!gate) {
      gate = {
        id: row.id,
        ownerProfileId: row.owner_profile_id,
        match: row.match as AccessGateMatch,
        description: row.description,
        acquisitionUrl: row.acquisition_url,
        version: Number(row.version),
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        conditions: [],
      };
      byGate.set(row.id, gate);
    }
    byTarget.set(row.target_id, gate);
    if (row.kind !== null && row.chain_id !== null && row.contract !== null) {
      const condition: AccessGateCondition = {
        ordinal: Number(row.ordinal),
        kind: row.kind as AccessGateConditionKind,
        chainId: Number(row.chain_id),
        contract: row.contract,
        minRaw: row.min_raw ?? "0",
        tokenIds: parseTokenIds(row.token_ids),
        decimals: row.decimals === null ? null : Number(row.decimals),
      };
      if (!gate.conditions.some((existing) => existing.ordinal === condition.ordinal)) {
        gate.conditions.push(condition);
        gate.conditions.sort((a, b) => a.ordinal - b.ordinal);
      }
    }
  }
  return byTarget;
}

function isMissingGateTable(error: unknown): boolean {
  // Before migration 0240 is applied no gate can exist.
  return error instanceof Error && /no such table:?\s*(main\.)?(content_access_gates|access_gates|access_gate_conditions)/i.test(error.message);
}

/** One query per 80 targets. Returns gates keyed by target id. */
export async function loadGatesForTargets(
  database: D1Database,
  targetType: AccessGateTargetType,
  targetIds: readonly string[],
): Promise<Map<string, AccessGate>> {
  const unique = [...new Set(targetIds.filter((id) => typeof id === "string" && id.length > 0))];
  const rows: GateJoinRow[] = [];
  try {
    for (let offset = 0; offset < unique.length; offset += ID_CHUNK) {
      const chunk = unique.slice(offset, offset + ID_CHUNK);
      const result = await database
        .prepare(`${GATE_JOIN_SELECT} WHERE cag.target_type = ? AND cag.target_id IN (${chunk.map(() => "?").join(",")})`)
        .bind(targetType, ...chunk)
        .all<GateJoinRow>();
      rows.push(...(result.results ?? []));
    }
  } catch (error) {
    if (isMissingGateTable(error)) return new Map();
    throw new GatedContentUnavailableError();
  }
  return gatesFromRows(rows);
}

function emptyLike(value: unknown): unknown {
  if (Array.isArray(value)) return [];
  if (typeof value === "string") return "";
  return null;
}

function stripItem<T extends object>(item: T): T {
  const copy: Record<string, unknown> = { ...(item as Record<string, unknown>) };
  for (const key of STRIPPED_KEYS) {
    if (key in copy && copy[key] !== undefined) copy[key] = emptyLike(copy[key]);
  }
  return copy as T;
}

type GateOutcome = "open" | "locked" | "unavailable";

async function peekCached(
  gate: AccessGate,
  viewerProfileId: string,
  deps: GateVerificationDeps,
): Promise<GateOutcome> {
  try {
    const cached = await deps.cache?.get({
      profileId: viewerProfileId,
      gateId: gate.id,
      gateVersion: gate.version,
      now: deps.now(),
    });
    return cached === "granted" ? "open" : "locked";
  } catch {
    return "locked";
  }
}

async function fullCheck(
  gate: AccessGate,
  viewerProfileId: string,
  deps: GateVerificationDeps,
  bypassCache = false,
): Promise<GateOutcome> {
  try {
    const outcome = await checkGateForViewer(toGateToVerify(gate), viewerProfileId, deps, { bypassCache });
    if (outcome.result === "granted") return "open";
    return outcome.result === "unavailable" ? "unavailable" : "locked";
  } catch {
    return "unavailable";
  }
}

export type GatedView<T> = T & { accessGate?: GateAccessState };

/**
 * Strips body, excerpt, media, attachments and embeds from gated items the
 * viewer may not open and attaches `accessGate: { gate, status }`.
 * Open items are returned unchanged (same object).
 */
export async function redactGated<T extends object>(
  database: D1Database | null | undefined,
  viewerProfileId: string | null,
  items: readonly T[],
  targetType: AccessGateTargetType,
  options: RedactGatedOptions = {},
): Promise<Array<GatedView<T>>> {
  if (!database || items.length === 0) return [...items];
  const keyOf = (options.keyOf as ((item: T) => string | null | undefined) | undefined)
    ?? ((item: T) => (item as { id?: string }).id);
  const gates = await loadGatesForTargets(database, targetType, items.map((item) => keyOf(item) ?? ""));
  if (gates.size === 0) return [...items];

  const context = options.context ?? "list";
  const deps = options.deps ?? createGateVerificationDeps(database);
  const budget = { remaining: options.maxDetailChecks ?? DEFAULT_MAX_DETAIL_CHECKS };
  const decided = new Map<string, GateOutcome>();
  /* Gates the FULL check granted in this call (the only source of an "入手した作品" record). */
  const fullGranted = new Set<string>();
  const unlocks = new Map<string, GateUnlockKey>();

  async function decide(gate: AccessGate): Promise<GateOutcome> {
    const known = decided.get(gate.id);
    if (known) return known;
    let outcome: GateOutcome;
    if (!viewerProfileId) outcome = "locked";
    else if (gate.ownerProfileId === viewerProfileId) outcome = "open";
    else if (context === "detail" && budget.remaining > 0) {
      budget.remaining -= 1;
      outcome = await fullCheck(gate, viewerProfileId, deps);
      if (outcome === "open") fullGranted.add(gate.id);
    } else outcome = await peekCached(gate, viewerProfileId, deps);
    decided.set(gate.id, outcome);
    return outcome;
  }

  const result: Array<GatedView<T>> = [];
  for (const item of items) {
    const key = keyOf(item);
    const gate = key ? gates.get(key) : undefined;
    if (!gate) {
      result.push(item);
      continue;
    }
    const author = (item as { authorProfileId?: string | null }).authorProfileId;
    if (viewerProfileId && author && author === viewerProfileId) {
      result.push(item);
      continue;
    }
    const outcome = await decide(gate);
    if (outcome === "open") {
      if (key && fullGranted.has(gate.id) && isGateUnlockTargetType(targetType)) {
        unlocks.set(key, { targetType, targetId: key });
      }
      result.push(item);
      continue;
    }
    result.push({
      ...stripItem(item),
      accessGate: { gate: toPublicAccessGate(gate), status: outcome === "unavailable" ? "unavailable" : "locked" },
    });
  }
  if (viewerProfileId && unlocks.size > 0) scheduleGateUnlocks(database, viewerProfileId, [...unlocks.values()]);
  return result;
}

/**
 * For quote/repost previews: removes `referenced` from items whose referenced
 * social post is gated and not open to the viewer (cache-only, never an RPC).
 */
export async function redactGatedReferences<T extends { id: string; referenced?: unknown }>(
  database: D1Database | null | undefined,
  viewerProfileId: string | null,
  items: readonly T[],
  referencedPostIdOf: ReadonlyMap<string, string | null | undefined>,
  deps?: GateVerificationDeps,
): Promise<T[]> {
  if (!database || items.length === 0) return [...items];
  const ids = items.flatMap((item) => (item.referenced ? [referencedPostIdOf.get(item.id) ?? ""] : []));
  const gates = await loadGatesForTargets(database, "post", ids);
  if (gates.size === 0) return [...items];
  const resolved = deps ?? createGateVerificationDeps(database);
  const result: T[] = [];
  for (const item of items) {
    const gate = item.referenced ? gates.get(referencedPostIdOf.get(item.id) ?? "") : undefined;
    if (!gate) {
      result.push(item);
      continue;
    }
    const open = Boolean(viewerProfileId)
      && (gate.ownerProfileId === viewerProfileId || (await peekCached(gate, viewerProfileId as string, resolved)) === "open");
    result.push(open ? item : { ...item, referenced: null });
  }
  return result;
}

export type MediaGateTarget = "social_post" | "thread_post" | "community_message";

/**
 * Per-request authorization of media attached to content that may be gated.
 * "open": no gate. "allowed": gate passed. "denied": gate closed or unverifiable.
 * Always runs the full check (cache first), never a list-style peek.
 */
export async function authorizeGatedMedia(
  database: D1Database,
  viewerProfileId: string | null,
  targetType: MediaGateTarget,
  targetId: string,
  deps?: GateVerificationDeps,
): Promise<"open" | "allowed" | "denied"> {
  let gate: AccessGate | undefined;
  try {
    const [gateTargetType, targetExpression] =
      targetType === "social_post"
        ? ["post", "?"]
        : targetType === "thread_post"
          ? ["thread", "(SELECT thread_id FROM thread_posts WHERE id = ?)"]
          : ["channel", "(SELECT channel_id FROM community_channel_messages WHERE id = ?)"];
    const lookup = database
      .prepare(`${GATE_JOIN_SELECT} WHERE cag.target_type = '${gateTargetType}' AND cag.target_id = ${targetExpression}`)
      .bind(targetId);
    const { results } = await lookup.all<GateJoinRow>();
    gate = [...gatesFromRows(results ?? []).values()][0];
  } catch (error) {
    if (isMissingGateTable(error)) return "open";
    return "denied";
  }
  if (!gate) return "open";
  if (!viewerProfileId) return "denied";
  if (gate.ownerProfileId === viewerProfileId) return "allowed";
  const author = await mediaAuthor(database, targetType, targetId);
  if (author === viewerProfileId) return "allowed";
  const outcome = await fullCheck(gate, viewerProfileId, deps ?? createGateVerificationDeps(database));
  return outcome === "open" ? "allowed" : "denied";
}

async function mediaAuthor(database: D1Database, targetType: MediaGateTarget, targetId: string): Promise<string | null> {
  const table =
    targetType === "social_post" ? "social_posts" : targetType === "thread_post" ? "thread_posts" : "community_channel_messages";
  try {
    const row = await database
      .prepare(`SELECT author_profile_id FROM ${table} WHERE id = ? LIMIT 1`)
      .bind(targetId)
      .first<{ author_profile_id: string | null }>();
    return row?.author_profile_id ?? null;
  } catch {
    return null;
  }
}

/** True when the viewer wrote the item. Any failure answers true: an unknown author is never recorded. */
async function isContentAuthor(
  database: D1Database,
  targetType: "post" | "article" | "video" | "thread",
  targetId: string,
  viewerProfileId: string,
): Promise<boolean> {
  const query = {
    post: "SELECT author_profile_id AS author FROM social_posts WHERE id = ? LIMIT 1",
    article: "SELECT author_profile_id AS author FROM hub_user_articles WHERE id = ? LIMIT 1",
    video: "SELECT submitted_by_profile_id AS author FROM external_videos WHERE id = ? LIMIT 1",
    thread: "SELECT created_by_profile_id AS author FROM threads WHERE id = ? LIMIT 1",
  }[targetType];
  try {
    const row = await database.prepare(query).bind(targetId).first<{ author: string | null }>();
    return !row || row.author === viewerProfileId;
  } catch {
    return true;
  }
}

/** "Check again" for the POST /api/access-gates/check route. Never returns addresses or balances. */
export async function checkTargetGateStatus(
  database: D1Database,
  viewerProfileId: string,
  target: { targetType: AccessGateTargetType; targetId: string },
  deps?: GateVerificationDeps,
): Promise<"open" | "locked" | "unavailable"> {
  const gates = await loadGatesForTargets(database, target.targetType, [target.targetId]);
  const gate = gates.get(target.targetId);
  if (!gate) return "open";
  if (gate.ownerProfileId === viewerProfileId) return "open";
  const outcome = await fullCheck(gate, viewerProfileId, deps ?? createGateVerificationDeps(database), true);
  if (outcome === "open" && isGateUnlockTargetType(target.targetType) && !(await isContentAuthor(database, target.targetType, target.targetId, viewerProfileId))) {
    scheduleGateUnlocks(database, viewerProfileId, [{ targetType: target.targetType, targetId: target.targetId }]);
  }
  return outcome;
}
