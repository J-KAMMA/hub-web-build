import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { HubIntent } from "@/lib/platform/core-model";
import type { HubIntentResolution } from "@/lib/platform/capability-catalog";
import {
  advanceIntentRun,
  applyIntentOwnerResult,
  cancelIntentRun,
  decideIntentApproval,
  initialIntentStage,
  initialIntentState,
  requiredIntentApprovals,
  safeCheckpointSummary,
  safeIntentConstraints,
  type HubIntentApproval,
  type HubIntentApprovalKind,
  type HubIntentCheckpoint,
  type HubIntentRunSnapshot,
  type HubIntentRunState,
  type HubIntentStage,
} from "@/lib/platform/intent-orchestrator";
import type { VerifiedIntentOwnerResult } from "@/lib/server/intent-owner-result-proof";

type RunRow = {
  id: string;
  profileId: string;
  objective: string;
  constraintsJson: string;
  resolutionJson: string;
  state: HubIntentRunState;
  currentStage: HubIntentStage;
  version: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  failureCode: string | null;
};

type ApprovalRow = {
  kind: HubIntentApprovalKind;
  status: HubIntentApproval["status"];
  previewHash: string | null;
};

type CheckpointRow = {
  sequence: number;
  stage: HubIntentStage;
  status: HubIntentCheckpoint["status"];
  capabilityName: string | null;
  safeSummaryJson: string;
  previewHash: string | null;
  createdAt: string;
};

function commerceKind(value: unknown):
  | "marketplace"
  | "digital"
  | "work"
  | "ai"
  | null {
  return value === "marketplace"
    || value === "digital"
    || value === "work"
    || value === "ai"
    ? value
    : null;
}

async function previewHash(summary: Record<string, string | number | boolean | null>) {
  const entries = Object.entries(summary).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  const bytes = new TextEncoder().encode(JSON.stringify(Object.fromEntries(entries)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function parseResolution(row: RunRow) {
  const value = JSON.parse(row.resolutionJson) as {
    handoff?: { href?: unknown; method?: unknown };
  };
  const href = typeof value.handoff?.href === "string" ? value.handoff.href : "/";
  const method = value.handoff?.method === "POST" ? "POST" : "GET";
  return { href, method } as const;
}

async function approvalsFor(database: D1Database, runId: string) {
  const result = await database.prepare(
    `SELECT kind, status, preview_hash AS previewHash
     FROM hub_intent_approvals
     WHERE intent_run_id = ?
     ORDER BY kind`,
  ).bind(runId).all<ApprovalRow>();
  return result.results ?? [];
}

async function checkpointsFor(database: D1Database, runId: string) {
  const result = await database.prepare(
    `SELECT sequence, stage, status, capability_name AS capabilityName,
       safe_summary_json AS safeSummaryJson, preview_hash AS previewHash,
       created_at AS createdAt
     FROM hub_intent_checkpoints
     WHERE intent_run_id = ?
     ORDER BY sequence`,
  ).bind(runId).all<CheckpointRow>();
  return (result.results ?? []).map((row) => ({
    sequence: Number(row.sequence),
    stage: row.stage,
    status: row.status,
    capabilityName: row.capabilityName,
    safeSummary: JSON.parse(row.safeSummaryJson) as Record<
      string,
      string | number | boolean | null
    >,
    previewHash: row.previewHash,
    createdAt: row.createdAt,
  } satisfies HubIntentCheckpoint));
}

async function snapshotFromRow(database: D1Database, row: RunRow) {
  const constraints = JSON.parse(row.constraintsJson) as Record<string, unknown>;
  const kind = commerceKind(constraints.kind);
  const commercePreview = constraints.commerceRequired === true
    && kind !== null
    && typeof constraints.contractSummary === "string"
    && typeof constraints.counterparty === "string"
    && typeof constraints.maximumCharge === "string"
    && typeof constraints.currency === "string"
    && typeof constraints.recipient === "string"
    ? {
        kind,
        contractSummary: constraints.contractSummary,
        counterparty: constraints.counterparty,
        maximumCharge: constraints.maximumCharge,
        currency: constraints.currency,
        recipient: constraints.recipient,
      }
    : undefined;
  return {
    id: row.id,
    profileId: row.profileId,
    objective: row.objective,
    goalSummary:
      typeof constraints.goalSummary === "string"
        ? constraints.goalSummary.slice(0, 500)
        : "",
    commerceRequired: constraints.commerceRequired === true,
    commercePreview,
    state: row.state,
    currentStage: row.currentStage,
    version: Number(row.version),
    expiresAt: row.expiresAt,
    approvals: await approvalsFor(database, row.id),
    checkpoints: await checkpointsFor(database, row.id),
    handoff: parseResolution(row),
  } satisfies HubIntentRunSnapshot;
}

async function runRow(
  database: D1Database,
  profileId: string,
  runId: string,
) {
  return database.prepare(
    `SELECT id, profile_id AS profileId, objective,
       constraints_json AS constraintsJson,
       resolution_json AS resolutionJson, state,
       current_stage AS currentStage, version,
       expires_at AS expiresAt, created_at AS createdAt,
       updated_at AS updatedAt, completed_at AS completedAt,
       cancelled_at AS cancelledAt, failure_code AS failureCode
     FROM hub_intent_runs
     WHERE id = ? AND profile_id = ?`,
  ).bind(runId, profileId).first<RunRow>();
}

async function runRowById(database: D1Database, runId: string) {
  return database.prepare(
    `SELECT id, profile_id AS profileId, objective,
       constraints_json AS constraintsJson,
       resolution_json AS resolutionJson, state,
       current_stage AS currentStage, version,
       expires_at AS expiresAt, created_at AS createdAt,
       updated_at AS updatedAt, completed_at AS completedAt,
       cancelled_at AS cancelledAt, failure_code AS failureCode
     FROM hub_intent_runs
     WHERE id = ?`,
  ).bind(runId).first<RunRow>();
}

export async function getIntentRun(
  database: D1Database,
  profileId: string,
  runId: string,
) {
  const row = await runRow(database, profileId, runId);
  return row ? snapshotFromRow(database, row) : null;
}

export async function listIntentRuns(
  database: D1Database,
  profileId: string,
  limit = 30,
) {
  const result = await database.prepare(
    `SELECT id, profile_id AS profileId, objective,
       constraints_json AS constraintsJson,
       resolution_json AS resolutionJson, state,
       current_stage AS currentStage, version,
       expires_at AS expiresAt, created_at AS createdAt,
       updated_at AS updatedAt, completed_at AS completedAt,
       cancelled_at AS cancelledAt, failure_code AS failureCode
     FROM hub_intent_runs
     WHERE profile_id = ?
     ORDER BY updated_at DESC
     LIMIT ?`,
  ).bind(profileId, Math.max(1, Math.min(100, Math.floor(limit)))).all<RunRow>();
  return Promise.all((result.results ?? []).map((row) => snapshotFromRow(database, row)));
}

export async function createIntentRun(
  database: D1Database,
  profileId: string,
  intent: HubIntent,
  resolution: Extract<HubIntentResolution, { status: "ready" }>,
) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const approvals = requiredIntentApprovals(intent, resolution);
  const currentStage = initialIntentStage(intent.objective);
  const state = initialIntentState(approvals, intent.objective, currentStage);
  const safeConstraints = safeIntentConstraints(intent.constraints);
  const statements = [
    database.prepare(
      `INSERT INTO hub_intent_runs
       (id, profile_id, objective, constraints_json, negotiable_json,
        resolution_json, state, current_stage, version, expires_at,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    ).bind(
      id,
      profileId,
      intent.objective,
      JSON.stringify(safeConstraints),
      JSON.stringify(intent.negotiable.slice(0, 40)),
      JSON.stringify({
        capability: resolution.capability.name,
        handoff: resolution.handoff,
      }),
      state,
      currentStage,
      intent.expiresAt,
      now,
      now,
    ),
    database.prepare(
      `INSERT INTO hub_intent_checkpoints
       (id, intent_run_id, sequence, stage, status, capability_name,
        safe_summary_json, preview_hash, created_at)
       VALUES (?, ?, 1, ?, 'entered', ?, '{}', NULL, ?)`,
    ).bind(
      crypto.randomUUID(),
      id,
      currentStage,
      resolution.capability.name,
      now,
    ),
    ...approvals.map((approval) =>
      database.prepare(
        `INSERT INTO hub_intent_approvals
         (id, intent_run_id, kind, status, created_at, updated_at)
         VALUES (?, ?, ?, 'required', ?, ?)`,
      ).bind(crypto.randomUUID(), id, approval.kind, now, now)
    ),
  ];
  await database.batch(statements);
  return getIntentRun(database, profileId, id);
}

async function persistSnapshot(
  database: D1Database,
  previous: HubIntentRunSnapshot,
  next: HubIntentRunSnapshot,
  checkpointStatus: "entered" | "paused" | "handoff" | "completed" | "failed" | "cancelled",
  safeSummary: Record<string, string | number | boolean | null> = {},
) {
  const now = new Date().toISOString();
  const safe = safeCheckpointSummary(safeSummary);
  const hash = next.currentStage === "contract_approval"
    || next.currentStage === "payment_approval"
    ? await previewHash(safe)
    : null;
  const result = await database.prepare(
    `UPDATE hub_intent_runs
     SET state = ?, current_stage = ?, version = ?, updated_at = ?,
       completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
       cancelled_at = CASE WHEN ? = 'cancelled' THEN ? ELSE cancelled_at END,
       failure_code = CASE WHEN ? = 'failed' THEN 'execution_failed' ELSE NULL END
     WHERE id = ? AND profile_id = ? AND version = ?`,
  ).bind(
    next.state,
    next.currentStage,
    next.version,
    now,
    next.state,
    now,
    next.state,
    now,
    next.state,
    next.id,
    next.profileId,
    previous.version,
  ).run();
  if (!result.meta.changes) throw new Error("intent_version_conflict");

  await database.prepare(
    `INSERT INTO hub_intent_checkpoints
     (id, intent_run_id, sequence, stage, status, capability_name,
      safe_summary_json, preview_hash, created_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    next.id,
    next.version,
    next.currentStage,
    checkpointStatus,
    JSON.stringify(safe),
    hash,
    now,
  ).run();
  return next;
}

export async function decideStoredIntentApproval(
  database: D1Database,
  profileId: string,
  runId: string,
  input: {
    kind: HubIntentApprovalKind;
    decision: "granted" | "denied";
    previewHash?: string | null;
  },
) {
  const current = await getIntentRun(database, profileId, runId);
  if (!current) return null;
  if (input.kind === "contract" || input.kind === "payment") {
    const checkpoint = current.checkpoints?.at(-1);
    if (
      !checkpoint?.previewHash
      || !input.previewHash
      || checkpoint.previewHash !== input.previewHash
    ) {
      throw new Error("approval_preview_mismatch");
    }
  }
  const next = decideIntentApproval(current, input);
  const now = new Date().toISOString();
  const approvalUpdate = await database.prepare(
    `UPDATE hub_intent_approvals
     SET status = ?, preview_hash = ?, decided_at = ?, updated_at = ?
     WHERE intent_run_id = ? AND kind = ? AND status IN ('required','denied','revoked')`,
  ).bind(
    input.decision,
    input.previewHash ?? null,
    now,
    now,
    runId,
    input.kind,
  ).run();
  if (!approvalUpdate.meta.changes) throw new Error("approval_not_required");
  await persistSnapshot(
    database,
    current,
    next,
    input.decision === "denied" ? "paused" : "entered",
    { approval: input.kind, decision: input.decision },
  );
  return getIntentRun(database, profileId, runId);
}

export async function advanceStoredIntentRun(
  database: D1Database,
  profileId: string,
  runId: string,
  input: {
    expectedVersion: number;
    outcome?: "continue" | "handoff" | "pause" | "complete" | "fail";
    summary?: Record<string, string | number | boolean | null>;
  },
) {
  const current = await getIntentRun(database, profileId, runId);
  if (!current) return null;
  const next = advanceIntentRun(current, input);
  const suppliedSummary = safeCheckpointSummary(input.summary);
  const proposalSummary = [...(current.checkpoints ?? [])]
    .reverse()
    .find((checkpoint) =>
      typeof checkpoint.safeSummary.maximumCharge === "string"
      && typeof checkpoint.safeSummary.currency === "string"
      && typeof checkpoint.safeSummary.recipient === "string"
    )?.safeSummary;
  const safeSummary = next.currentStage === "payment_approval"
    && Object.keys(suppliedSummary).length === 0
    && proposalSummary
    ? safeCheckpointSummary(proposalSummary)
    : suppliedSummary;
  if (next.currentStage === "contract_approval") {
    if (
      typeof safeSummary.contractSummary !== "string"
      || typeof safeSummary.counterparty !== "string"
    ) {
      throw new Error("contract_preview_required");
    }
  }
  if (next.currentStage === "payment_approval") {
    if (
      typeof safeSummary.maximumCharge !== "string"
      || typeof safeSummary.currency !== "string"
      || typeof safeSummary.recipient !== "string"
    ) {
      throw new Error("payment_preview_required");
    }
  }
  const checkpointStatus = next.state === "paused"
    ? "paused"
    : next.state === "handoff_required"
      ? "handoff"
      : next.state === "completed"
        ? "completed"
        : next.state === "failed"
          ? "failed"
          : "entered";
  await persistSnapshot(database, current, next, checkpointStatus, safeSummary);
  return getIntentRun(database, profileId, runId);
}

export async function cancelStoredIntentRun(
  database: D1Database,
  profileId: string,
  runId: string,
  expectedVersion: number,
) {
  const current = await getIntentRun(database, profileId, runId);
  if (!current) return null;
  if (current.version !== expectedVersion) throw new Error("intent_version_conflict");
  const next = cancelIntentRun(current);
  await persistSnapshot(database, current, next, "cancelled");
  return getIntentRun(database, profileId, runId);
}

export async function applyStoredIntentOwnerResult(
  database: D1Database,
  proof: VerifiedIntentOwnerResult,
) {
  const row = await runRowById(database, proof.intentRunId);
  if (!row) return null;
  const current = await snapshotFromRow(database, row);
  if (current.currentStage !== proof.stage) {
    throw new Error("owner_result_stage_mismatch");
  }
  const next = applyIntentOwnerResult(current, {
    expectedVersion: current.version,
    service: proof.service,
    status: proof.status,
    operationRef: proof.operationRef,
    safeSummary: proof.safeSummary,
  });
  const now = new Date().toISOString();
  const expiresAt = new Date(proof.exp * 1000).toISOString();
  const safe = safeCheckpointSummary({
    ...proof.safeSummary,
    ownerService: proof.service,
    operationRef: proof.operationRef,
  });
  const resultPreviewHash = next.currentStage === "contract_approval"
    || next.currentStage === "payment_approval"
    ? await previewHash(safe)
    : null;
  const nextConstraints = JSON.parse(row.constraintsJson) as Record<string, unknown>;
  if (proof.stage === "discovery" && proof.status === "fulfilled") {
    nextConstraints.commerceRequired = proof.safeSummary.commerceRequired === true;
    if (proof.safeSummary.commerceRequired === true) {
      nextConstraints.kind = proof.safeSummary.kind;
      nextConstraints.contractSummary = proof.safeSummary.contractSummary;
      nextConstraints.counterparty = proof.safeSummary.counterparty;
      nextConstraints.maximumCharge = proof.safeSummary.maximumCharge;
      nextConstraints.currency = proof.safeSummary.currency;
      nextConstraints.recipient = proof.safeSummary.recipient;
    }
  }
  try {
    const results = await database.batch([
      database.prepare(
        `DELETE FROM hub_intent_owner_result_proofs WHERE expires_at < ?`,
      ).bind(now),
      database.prepare(
        `INSERT INTO hub_intent_owner_result_proofs
         (jti, intent_run_id, issuer, stage, consumed_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(proof.jti, proof.intentRunId, proof.issuer, proof.stage, now, expiresAt),
      database.prepare(
        `UPDATE hub_intent_runs
         SET state = ?, current_stage = ?, version = ?, updated_at = ?,
           constraints_json = ?,
           completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END,
           failure_code = CASE WHEN ? = 'failed' THEN 'owner_service_failed' ELSE failure_code END
         WHERE id = ? AND version = ? AND state = 'handoff_required' AND current_stage = ?`,
      ).bind(
        next.state,
        next.currentStage,
        next.version,
        now,
        JSON.stringify(nextConstraints),
        next.state,
        now,
        next.state,
        next.id,
        current.version,
        proof.stage,
      ),
      database.prepare(
        `INSERT INTO hub_intent_checkpoints
         (id, intent_run_id, sequence, stage, status, capability_name,
          safe_summary_json, preview_hash, created_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        next.id,
        next.version,
        next.currentStage,
        next.state === "completed"
          ? "completed"
          : next.state === "failed"
            ? "failed"
            : next.state === "handoff_required"
              ? "handoff"
              : "entered",
        JSON.stringify(safe),
        resultPreviewHash,
        now,
      ),
    ]);
    if (!results[2]?.meta.changes) throw new Error("intent_version_conflict");
  } catch (error) {
    if (
      error instanceof Error
      && /unique|constraint|primary/i.test(error.message)
    ) throw new Error("owner_result_replayed");
    throw error;
  }
  return getIntentRun(database, current.profileId, current.id);
}
