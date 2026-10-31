/*
 * Hub code hosting, phase 1 (docs/hub-software/PLAN.md sections 3.3, 3.4 and 4; AGENTS.md 2026-10-16).
 *
 * Hub owns repository metadata, collaborators, Git access tokens and authorization. The Code
 * Worker (`apps/code`) owns the Git data in Cloudflare Artifacts and the smart HTTP endpoint at
 * `/code/git/<owner>/<name>.git`. For every Git request it sends Hub only the owner handle, the
 * repository name, the access it needs and the SHA-256 hash of the presented token; Hub answers
 * with a short-lived `jkamma-code` ticket (hub-code-ticket.ts) or a refusal. Pack data and file
 * bodies never pass through Hub.
 *
 * Storage (PLAN 4): before the Code Worker accepts a pack, Hub reserves the push limit under its
 * own Account audience and records the reservation by ticket ID. The Code Worker reports the bytes
 * it received; Hub commits that much and releases the rest. A push needs a profile linked to the
 * common Account, because only Account holds storage totals.
 *
 * This module keeps no `@/` imports so the Code Worker's tests can run it against the real Worker.
 */

import type { D1Database } from "@cloudflare/workers-types";

import type { HubStorageAccountClient } from "./hub-storage-account-client";
import {
  HUB_CODE_MAX_PUSH_BYTES,
  HUB_CODE_REPOSITORY_MAX_BYTES,
  HUB_CODE_TICKET_HEADER,
  isHubCodeRepoId,
  newHubCodeRepoId,
  readOwnHubCodeTicket,
  signHubCodeTicket,
} from "./hub-code-ticket";

export class HubCodeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HubCodeError";
  }
}

export type CodeWorkerSend = (path: string, init: { method: "POST"; headers: Record<string, string> }) => Promise<Response>;

export type HubCodeDeps = {
  /** Hub secret `HUB_CODE_TICKET_PRIVATE_KEY_PKCS8`; null when unconfigured (fail closed). */
  privateKeyPkcs8: string | null;
  /** Null when no Code Worker transport is configured (fail closed). */
  send: CodeWorkerSend | null;
  account: HubStorageAccountClient;
  now?: () => Date;
};

export type CodeVisibility = "public" | "private";
export type CodeScope = "read" | "write";

export type CodeRepositoryView = {
  id: string;
  owner: string;
  name: string;
  description: string;
  visibility: CodeVisibility;
  defaultBranch: string;
  sizeBytes: number;
  gitPath: string;
  createdAt: string;
  updatedAt: string;
  /** The viewer's access: "owner", "write", "read" (collaborator or public), never null in a view. */
  access: "owner" | CodeScope;
};

export type CodeTokenView = {
  id: string;
  repoId: string | null;
  scope: CodeScope;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
};

export const CODE_REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const CODE_HANDLE = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/;
export const CODE_TOKEN_PREFIX = "hcg_";
export const CODE_TOKEN_MAX_DAYS = 90;
export const CODE_TOKEN_DEFAULT_DAYS = 30;
export const CODE_TOKEN_MAX_ACTIVE = 20;
export const CODE_REPOSITORY_MAX_PER_PROFILE = 100;
const RESERVED_NAMES = new Set([".", "..", "info", "objects", "refs", "head"]);
const TOKEN_HASH = /^[0-9a-f]{64}$/;

const nowIso = (deps: Pick<HubCodeDeps, "now">) => (deps.now?.() ?? new Date()).toISOString();

export function codeGitPath(owner: string, name: string): string {
  return `/code/git/${encodeURIComponent(owner)}/${encodeURIComponent(name)}.git`;
}

export async function hashCodeToken(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function requireKey(deps: HubCodeDeps): string {
  if (!deps.privateKeyPkcs8) throw new HubCodeError("code_unavailable", 503, "コード置き場は準備中です。");
  return deps.privateKeyPkcs8;
}

type RepoRow = {
  id: string;
  owner_profile_id: string;
  owner_handle: string;
  name: string;
  description: string;
  visibility: CodeVisibility;
  default_branch: string;
  state: "provisioning" | "ready";
  size_bytes: number;
  created_at: string;
  updated_at: string;
};

const REPO_SELECT = `SELECT r.id, r.owner_profile_id, p.handle AS owner_handle, r.name, r.description, r.visibility,
  r.default_branch, r.state, r.size_bytes, r.created_at, r.updated_at
  FROM code_repositories r JOIN profiles p ON p.id = r.owner_profile_id`;

/** The owner is suspended, or the repository is not ready: treated as absent everywhere. */
const REPO_AVAILABLE = `r.state = 'ready' AND NOT EXISTS (
  SELECT 1 FROM profile_moderation_status m WHERE m.profile_id = r.owner_profile_id AND m.status = 'suspended')`;

function toView(row: RepoRow, access: CodeRepositoryView["access"]): CodeRepositoryView {
  return {
    id: row.id,
    owner: row.owner_handle,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    defaultBranch: row.default_branch,
    sizeBytes: row.size_bytes,
    gitPath: codeGitPath(row.owner_handle, row.name),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    access,
  };
}

/** Repository by owner handle and name; null when absent, ambiguous or unavailable. */
async function findRepository(database: D1Database, owner: string, name: string): Promise<RepoRow | null> {
  if (!CODE_HANDLE.test(owner) || !CODE_REPOSITORY_NAME.test(name)) return null;
  const { results } = await database
    .prepare(`${REPO_SELECT} WHERE p.handle = ? AND r.name = ? COLLATE NOCASE AND ${REPO_AVAILABLE}
      AND NOT EXISTS (SELECT 1 FROM remote_actor_profiles x WHERE x.profile_id = p.id) LIMIT 2`)
    .bind(owner, name)
    .all<RepoRow>();
  return results.length === 1 ? results[0] : null;
}

/** The profile's role on a repository: owner, a collaborator role, or null. */
async function roleOf(database: D1Database, repo: RepoRow, profileId: string | null): Promise<"owner" | CodeScope | null> {
  if (!profileId) return null;
  if (repo.owner_profile_id === profileId) return "owner";
  const row = await database
    .prepare("SELECT role FROM code_repository_collaborators WHERE repo_id = ? AND profile_id = ?")
    .bind(repo.id, profileId)
    .first<{ role: CodeScope }>();
  return row?.role ?? null;
}

const canWrite = (role: "owner" | CodeScope | null) => role === "owner" || role === "write";

function parseCreateInput(input: Record<string, unknown>): { name: string; description: string; visibility: CodeVisibility } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!CODE_REPOSITORY_NAME.test(name) || RESERVED_NAMES.has(name.toLowerCase()) || name.toLowerCase().endsWith(".git")) {
    throw new HubCodeError("invalid_name", 400, "リポジトリ名は英数字と . _ - の100文字以内で、英数字から始めてください。");
  }
  const description = input.description === undefined ? "" : input.description;
  if (typeof description !== "string" || description.length > 500) {
    throw new HubCodeError("invalid_description", 400, "説明は500文字以内で入力してください。");
  }
  const visibility = input.visibility === undefined ? "private" : input.visibility;
  if (visibility !== "public" && visibility !== "private") {
    throw new HubCodeError("invalid_visibility", 400, "公開範囲は public か private です。");
  }
  return { name, description: description.trim(), visibility };
}

async function sendOperation(
  deps: HubCodeDeps,
  repoId: string,
  purpose: "code.repo-create" | "code.repo-delete",
): Promise<boolean> {
  if (!deps.send) return false;
  const { ticket, header } = await signHubCodeTicket({ repoId, purpose, privateKeyPkcs8: requireKey(deps), now: deps.now?.() });
  const path = purpose === "code.repo-create" ? "/code/api/v1/repos/create" : "/code/api/v1/repos/delete";
  try {
    const response = await deps.send(path, { method: "POST", headers: { [header]: ticket } });
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Create a repository: record it as provisioning, ask the Code Worker to create the Artifacts
 * repository, then mark it ready. If the Code Worker does not confirm, the row is removed and the
 * request fails closed.
 */
export async function createCodeRepository(
  database: D1Database,
  deps: HubCodeDeps,
  profileId: string,
  input: Record<string, unknown>,
): Promise<CodeRepositoryView> {
  requireKey(deps);
  if (!deps.send) throw new HubCodeError("code_unavailable", 503, "コード置き場は準備中です。");
  const { name, description, visibility } = parseCreateInput(input);
  const count = await database
    .prepare("SELECT COUNT(*) AS n FROM code_repositories WHERE owner_profile_id = ?")
    .bind(profileId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= CODE_REPOSITORY_MAX_PER_PROFILE) {
    throw new HubCodeError("too_many_repositories", 409, `リポジトリは1人${CODE_REPOSITORY_MAX_PER_PROFILE}個までです。`);
  }
  const id = newHubCodeRepoId();
  const at = nowIso(deps);
  const inserted = await database
    .prepare(`INSERT OR IGNORE INTO code_repositories (id, owner_profile_id, name, description, visibility, default_branch, state, size_bytes, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'main', 'provisioning', 0, ?, ?)`)
    .bind(id, profileId, name, description, visibility, at, at)
    .run();
  if (!inserted.meta.changes) throw new HubCodeError("name_taken", 409, "同じ名前のリポジトリがすでにあります。");
  if (!(await sendOperation(deps, id, "code.repo-create"))) {
    await database.prepare("DELETE FROM code_repositories WHERE id = ? AND state = 'provisioning'").bind(id).run();
    throw new HubCodeError("code_unavailable", 503, "リポジトリを作れませんでした。時間をおいて試してください。");
  }
  await database.prepare("UPDATE code_repositories SET state = 'ready', updated_at = ? WHERE id = ?").bind(nowIso(deps), id).run();
  const row = await database.prepare(`${REPO_SELECT} WHERE r.id = ?`).bind(id).first<RepoRow>();
  if (!row) throw new HubCodeError("code_unavailable", 503, "リポジトリを作れませんでした。");
  return toView(row, "owner");
}

/** Repositories the profile owns or collaborates on. */
export async function listOwnCodeRepositories(database: D1Database, profileId: string): Promise<CodeRepositoryView[]> {
  const { results } = await database
    .prepare(`SELECT q.*, CASE WHEN q.owner_profile_id = ? THEN 'owner' ELSE c.role END AS role
      FROM (${REPO_SELECT} WHERE ${REPO_AVAILABLE}) q
      LEFT JOIN code_repository_collaborators c ON c.repo_id = q.id AND c.profile_id = ?
      WHERE q.owner_profile_id = ? OR c.profile_id IS NOT NULL
      ORDER BY q.updated_at DESC LIMIT ${CODE_REPOSITORY_MAX_PER_PROFILE * 2}`)
    .bind(profileId, profileId, profileId)
    .all<RepoRow & { role: "owner" | CodeScope }>();
  return results.map((row) => toView(row, row.role));
}

/** A repository the viewer may see: public, or private with a role. Otherwise null (no existence leak). */
export async function getCodeRepository(
  database: D1Database,
  viewerProfileId: string | null,
  owner: string,
  name: string,
): Promise<CodeRepositoryView | null> {
  const repo = await findRepository(database, owner, name);
  if (!repo) return null;
  const role = await roleOf(database, repo, viewerProfileId);
  if (!role && repo.visibility !== "public") return null;
  return toView(repo, role ?? "read");
}

/** Issue a personal Git token. The plaintext is returned once and only its hash is stored. */
export async function issueCodeToken(
  database: D1Database,
  deps: Pick<HubCodeDeps, "now">,
  profileId: string,
  input: Record<string, unknown>,
): Promise<{ token: string; view: CodeTokenView }> {
  const scope = input.scope;
  if (scope !== "read" && scope !== "write") throw new HubCodeError("invalid_scope", 400, "権限は read か write です。");
  const days = input.expiresInDays === undefined ? CODE_TOKEN_DEFAULT_DAYS : input.expiresInDays;
  if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > CODE_TOKEN_MAX_DAYS) {
    throw new HubCodeError("invalid_expiry", 400, `期限は1〜${CODE_TOKEN_MAX_DAYS}日です。`);
  }
  const label = input.label === undefined ? "" : input.label;
  if (typeof label !== "string" || label.length > 100) throw new HubCodeError("invalid_label", 400, "名前は100文字以内です。");
  let repoId: string | null = null;
  if (input.repoId !== undefined && input.repoId !== null) {
    if (!isHubCodeRepoId(input.repoId)) throw new HubCodeError("invalid_repository", 400, "リポジトリが正しくありません。");
    const repo = await database.prepare(`${REPO_SELECT} WHERE r.id = ? AND ${REPO_AVAILABLE}`).bind(input.repoId).first<RepoRow>();
    if (!repo || !(await roleOf(database, repo, profileId))) throw new HubCodeError("not_found", 404, "リポジトリが見つかりません。");
    repoId = repo.id;
  }
  const now = deps.now?.() ?? new Date();
  const at = now.toISOString();
  const active = await database
    .prepare("SELECT COUNT(*) AS n FROM code_access_tokens WHERE owner_profile_id = ? AND revoked_at IS NULL AND expires_at > ?")
    .bind(profileId, at)
    .first<{ n: number }>();
  if ((active?.n ?? 0) >= CODE_TOKEN_MAX_ACTIVE) {
    throw new HubCodeError("too_many_tokens", 409, `有効なトークンは${CODE_TOKEN_MAX_ACTIVE}個までです。不要なものを取り消してください。`);
  }
  const token = `${CODE_TOKEN_PREFIX}${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
  const view: CodeTokenView = {
    id: crypto.randomUUID(),
    repoId,
    scope,
    label: label.trim(),
    expiresAt: new Date(now.getTime() + days * 86_400_000).toISOString(),
    revokedAt: null,
    createdAt: at,
  };
  await database
    .prepare(`INSERT INTO code_access_tokens (id, owner_profile_id, repo_id, token_hash, scope, label, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(view.id, profileId, repoId, await hashCodeToken(token), scope, view.label, view.expiresAt, at)
    .run();
  return { token, view };
}

export async function listCodeTokens(database: D1Database, profileId: string): Promise<CodeTokenView[]> {
  const { results } = await database
    .prepare(`SELECT id, repo_id AS repoId, scope, label, expires_at AS expiresAt, revoked_at AS revokedAt, created_at AS createdAt
      FROM code_access_tokens WHERE owner_profile_id = ? ORDER BY created_at DESC LIMIT 200`)
    .bind(profileId)
    .all<CodeTokenView>();
  return results;
}

export async function revokeCodeToken(
  database: D1Database,
  deps: Pick<HubCodeDeps, "now">,
  profileId: string,
  tokenId: string,
): Promise<boolean> {
  const result = await database
    .prepare("UPDATE code_access_tokens SET revoked_at = ? WHERE id = ? AND owner_profile_id = ? AND revoked_at IS NULL")
    .bind(nowIso(deps), tokenId, profileId)
    .run();
  return Boolean(result.meta.changes);
}

export type CodeGitAuthorization =
  | { ok: true; ticket: string; header: typeof HUB_CODE_TICKET_HEADER }
  | { ok: false; status: 401 | 403 | 404 | 413 | 503; code: string };

/**
 * The Code Worker's question: may this request read or write this repository? `phase: "pack"` is
 * the receive-pack POST that carries data; only that phase reserves storage.
 */
export async function authorizeCodeGit(
  database: D1Database,
  deps: HubCodeDeps,
  input: { owner: unknown; name: unknown; access: unknown; phase: unknown; tokenHash: unknown },
): Promise<CodeGitAuthorization> {
  const { owner, name, access, phase, tokenHash } = input;
  if (
    typeof owner !== "string"
    || typeof name !== "string"
    || (access !== "read" && access !== "write")
    || (phase !== "advertise" && phase !== "pack")
    || (tokenHash !== null && (typeof tokenHash !== "string" || !TOKEN_HASH.test(tokenHash)))
  ) {
    return { ok: false, status: 404, code: "not_found" };
  }
  if (!deps.privateKeyPkcs8) return { ok: false, status: 503, code: "code_unavailable" };
  const repo = await findRepository(database, owner, name);
  const at = nowIso(deps);

  let role: "owner" | CodeScope | null = null;
  let scope: CodeScope | null = null;
  let holder: string | null = null;
  if (tokenHash) {
    const token = await database
      .prepare(`SELECT owner_profile_id, repo_id, scope FROM code_access_tokens
        WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM profile_moderation_status m WHERE m.profile_id = owner_profile_id AND m.status = 'suspended')`)
      .bind(tokenHash, at)
      .first<{ owner_profile_id: string; repo_id: string | null; scope: CodeScope }>();
    // An unknown, expired or revoked token is an authentication failure, so Git asks again.
    if (!token) return { ok: false, status: 401, code: "authentication_required" };
    if (repo && (token.repo_id === null || token.repo_id === repo.id)) {
      role = await roleOf(database, repo, token.owner_profile_id);
      scope = token.scope;
      holder = token.owner_profile_id;
    }
  }

  if (!repo) return { ok: false, status: tokenHash ? 404 : 401, code: tokenHash ? "not_found" : "authentication_required" };
  if (!role) {
    if (repo.visibility === "private") return { ok: false, status: tokenHash ? 404 : 401, code: tokenHash ? "not_found" : "authentication_required" };
    if (access === "read") return sign(deps, repo.id, "code.git-read");
    return { ok: false, status: tokenHash ? 403 : 401, code: tokenHash ? "forbidden" : "authentication_required" };
  }
  if (access === "read") return sign(deps, repo.id, "code.git-read");
  if (!canWrite(role) || scope !== "write") return { ok: false, status: 403, code: "forbidden" };
  if (phase === "advertise") return sign(deps, repo.id, "code.git-write", 0);
  return reservePush(database, deps, repo, holder as string);
}

async function sign(
  deps: HubCodeDeps,
  repoId: string,
  purpose: "code.git-read" | "code.git-write",
  maxPushBytes?: number,
  jti?: string,
): Promise<CodeGitAuthorization> {
  const { ticket, header } = await signHubCodeTicket({
    repoId,
    purpose,
    privateKeyPkcs8: requireKey(deps),
    maxPushBytes,
    jti,
    now: deps.now?.(),
  });
  return { ok: true, ticket, header };
}

async function reservePush(database: D1Database, deps: HubCodeDeps, repo: RepoRow, pusher: string): Promise<CodeGitAuthorization> {
  const room = HUB_CODE_REPOSITORY_MAX_BYTES - repo.size_bytes;
  if (room <= 0) return { ok: false, status: 413, code: "repository_full" };
  const maxBytes = Math.min(HUB_CODE_MAX_PUSH_BYTES, room);
  // Storage is counted against the person who pushes, under Hub's own Account audience.
  const link = await database
    .prepare("SELECT pairwise_subject FROM account_profile_links WHERE profile_id = ?")
    .bind(pusher)
    .first<{ pairwise_subject: string }>()
    .catch(() => null);
  if (!link?.pairwise_subject) return { ok: false, status: 403, code: "account_link_required" };
  const jti = crypto.randomUUID();
  const reserved = await deps.account
    .reserve({ subject: link.pairwise_subject, bytes: maxBytes, idempotencyKey: `code:${repo.id}:push:${jti}` })
    .catch(() => ({ ok: false as const, reason: "unavailable" as const }));
  if (!reserved.ok) {
    return reserved.reason === "over_limit"
      ? { ok: false, status: 413, code: "storage_over_limit" }
      : { ok: false, status: 503, code: "storage_unavailable" };
  }
  try {
    await database
      .prepare(`INSERT INTO code_repository_pushes (jti, repo_id, profile_id, reservation_id, max_bytes, state, created_at)
        VALUES (?, ?, ?, ?, ?, 'reserved', ?)`)
      .bind(jti, repo.id, pusher, reserved.reservationId, maxBytes, nowIso(deps))
      .run();
    return await sign(deps, repo.id, "code.git-write", maxBytes, jti);
  } catch {
    await deps.account.release({ subject: link.pairwise_subject, reservationId: reserved.reservationId }).catch(() => undefined);
    return { ok: false, status: 503, code: "code_unavailable" };
  }
}

export type CodePushReport = { ticket: unknown; bytes: unknown; ok: unknown };

/**
 * The Code Worker's report after a receive-pack request. A successful push commits the bytes
 * received (capped at the reservation) and adds them to the repository size; a failed one
 * releases the reservation. A report for a push that was already settled is a no-op.
 */
export async function settleCodePush(
  database: D1Database,
  deps: HubCodeDeps,
  report: CodePushReport,
): Promise<{ settled: "committed" | "released" | "already" }> {
  const key = requireKey(deps);
  if (typeof report.ticket !== "string" || typeof report.ok !== "boolean") {
    throw new HubCodeError("invalid_report", 400, "invalid report");
  }
  const bytes = report.bytes;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) throw new HubCodeError("invalid_report", 400, "invalid report");
  const claims = await readOwnHubCodeTicket(report.ticket, key);
  if (!claims || claims.purpose !== "code.git-write") throw new HubCodeError("invalid_report", 400, "invalid report");
  const push = await database
    .prepare(`SELECT s.jti, s.repo_id, s.reservation_id, s.max_bytes, s.state, l.pairwise_subject
      FROM code_repository_pushes s LEFT JOIN account_profile_links l ON l.profile_id = s.profile_id
      WHERE s.jti = ? AND s.repo_id = ?`)
    .bind(claims.jti, claims.repo_id)
    .first<{ jti: string; repo_id: string; reservation_id: string; max_bytes: number; state: string; pairwise_subject: string | null }>();
  if (!push) throw new HubCodeError("invalid_report", 400, "invalid report");
  if (push.state !== "reserved") return { settled: "already" };
  if (!push.pairwise_subject) throw new HubCodeError("storage_unavailable", 503, "storage unavailable");
  const at = nowIso(deps);
  const counted = Math.min(bytes, push.max_bytes);
  if (report.ok && counted > 0) {
    const committed = await deps.account.commit({ subject: push.pairwise_subject, reservationId: push.reservation_id, bytes: counted });
    if (!committed.ok) throw new HubCodeError("storage_unavailable", 503, "storage unavailable");
    await database.batch([
      database
        .prepare("UPDATE code_repository_pushes SET state = 'committed', bytes = ?, settled_at = ? WHERE jti = ? AND state = 'reserved'")
        .bind(counted, at, push.jti),
      database
        .prepare("UPDATE code_repositories SET size_bytes = size_bytes + ?, updated_at = ? WHERE id = ?")
        .bind(counted, at, push.repo_id),
    ]);
    return { settled: "committed" };
  }
  const released = await deps.account.release({ subject: push.pairwise_subject, reservationId: push.reservation_id });
  if (!released.ok && released.reason !== "expired") throw new HubCodeError("storage_unavailable", 503, "storage unavailable");
  await database
    .prepare("UPDATE code_repository_pushes SET state = 'released', bytes = 0, settled_at = ? WHERE jti = ? AND state = 'reserved'")
    .bind(at, push.jti)
    .run();
  return { settled: "released" };
}

/**
 * One owner's public repositories for the profile tab, newest push first. Keyset on
 * (updated_at, id); the owner has at most CODE_REPOSITORY_MAX_PER_PROFILE rows, reached through
 * the (owner_profile_id, name) index. Private repositories never appear here.
 */
export async function listPublicCodeRepositoriesByOwner(
  database: D1Database,
  ownerProfileId: string,
  options: { limit?: number; before?: { at: string; id: string } | null } = {},
): Promise<{ repositories: CodeRepositoryView[]; nextCursor: { at: string; id: string } | null }> {
  const limit = Math.max(1, Math.min(50, Math.trunc(options.limit ?? 20)));
  const before = options.before ?? null;
  const { results } = await database
    .prepare(`${REPO_SELECT} WHERE r.owner_profile_id = ? AND r.visibility = 'public' AND ${REPO_AVAILABLE}
      ${before ? "AND (r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))" : ""}
      ORDER BY r.updated_at DESC, r.id DESC LIMIT ?`)
    .bind(ownerProfileId, ...(before ? [before.at, before.at, before.id] : []), limit + 1)
    .all<RepoRow>();
  const page = results.slice(0, limit);
  const last = page.at(-1);
  return {
    repositories: page.map((row) => toView(row, "read")),
    nextCursor: results.length > limit && last ? { at: last.updated_at, id: last.id } : null,
  };
}

/** Public repositories, newest push first. Private repositories never appear here. */
export async function listPublicCodeRepositories(database: D1Database, limit = 30): Promise<CodeRepositoryView[]> {
  const bounded = Math.max(1, Math.min(100, Math.trunc(limit)));
  const { results } = await database
    .prepare(`${REPO_SELECT} WHERE r.visibility = 'public' AND ${REPO_AVAILABLE}
      AND NOT EXISTS (SELECT 1 FROM remote_actor_profiles x WHERE x.profile_id = p.id)
      ORDER BY r.updated_at DESC LIMIT ?`)
    .bind(bounded)
    .all<RepoRow>();
  return results.map((row) => toView(row, "read"));
}
