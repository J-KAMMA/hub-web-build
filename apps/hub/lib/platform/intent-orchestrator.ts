import type { HubIntent } from "@/lib/platform/core-model";
import type { HubIntentResolution } from "@/lib/platform/capability-catalog";

export const HUB_INTENT_ORCHESTRATOR_VERSION = "hub.intent-run.v1" as const;

export const HUB_INTENT_STAGES = [
  "discovery",
  "comparison",
  "selection",
  "contract_approval",
  "payment_approval",
  "execution",
  "fulfillment",
  "complete",
] as const;

export type HubIntentStage = (typeof HUB_INTENT_STAGES)[number];
export type HubIntentRunState =
  | "awaiting_approval"
  | "ready"
  | "running"
  | "paused"
  | "handoff_required"
  | "completed"
  | "failed"
  | "cancelled"
  | "expired";

export type HubIntentApprovalKind =
  | "execution"
  | "publish"
  | "confirmation"
  | "contract"
  | "payment"
  | "personal_data";

export type HubIntentApproval = {
  kind: HubIntentApprovalKind;
  status: "required" | "granted" | "denied" | "revoked";
  previewHash?: string | null;
};

export type HubIntentCheckpoint = {
  sequence: number;
  stage: HubIntentStage;
  status: "entered" | "paused" | "handoff" | "completed" | "failed" | "cancelled";
  capabilityName?: string | null;
  safeSummary: Record<string, string | number | boolean | null>;
  previewHash?: string | null;
  createdAt: string;
};

export type HubIntentRunSnapshot = {
  id: string;
  profileId: string;
  objective: string;
  goalSummary?: string;
  commerceRequired?: boolean;
  commercePreview?: {
    kind: "marketplace" | "digital" | "work" | "ai";
    contractSummary: string;
    counterparty: string;
    maximumCharge: string;
    currency: string;
    recipient: string;
  };
  state: HubIntentRunState;
  currentStage: HubIntentStage;
  version: number;
  expiresAt: string;
  approvals: HubIntentApproval[];
  checkpoints?: HubIntentCheckpoint[];
  handoff: { href: string; method: "GET" | "POST" };
};

export type HubIntentOwnerResult = {
  service: "ai" | "commerce";
  status: "fulfilled" | "failed";
  operationRef: string;
  safeSummary: Record<string, string | number | boolean | null>;
};

const SENSITIVE_ORCHESTRATION_KEY =
  /(private.?key|secret|mnemonic|seed|password|credential|authorization|assertion|payment.?payload|session|cookie|prompt|provider.?result|wallet.?signature)/i;

export function safeIntentConstraints(
  constraints: HubIntent["constraints"],
): HubIntent["constraints"] {
  const entries = Object.entries(constraints);
  if (entries.length > 40) throw new Error("too_many_intent_constraints");
  const safe: HubIntent["constraints"] = {};
  for (const [rawKey, value] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > 64 || SENSITIVE_ORCHESTRATION_KEY.test(key)) {
      throw new Error("sensitive_intent_constraint");
    }
    if (typeof value === "string" && value.length > 500) {
      throw new Error("intent_constraint_too_long");
    }
    safe[key] = value;
  }
  return safe;
}

export function safeCheckpointSummary(
  summary: Record<string, string | number | boolean | null> | undefined,
) {
  const entries = Object.entries(summary ?? {});
  if (entries.length > 20) throw new Error("too_many_checkpoint_fields");
  const safe: Record<string, string | number | boolean | null> = {};
  for (const [rawKey, value] of entries) {
    const key = rawKey.trim();
    if (!key || key.length > 64 || SENSITIVE_ORCHESTRATION_KEY.test(key)) {
      throw new Error("sensitive_checkpoint_field");
    }
    if (typeof value === "string" && value.length > 500) {
      throw new Error("checkpoint_field_too_long");
    }
    safe[key] = value;
  }
  return safe;
}

const APPROVAL_KINDS = new Set<HubIntentApprovalKind>([
  "execution",
  "publish",
  "confirmation",
  "contract",
  "payment",
  "personal_data",
]);

function approvalKind(value: string): HubIntentApprovalKind | null {
  return APPROVAL_KINDS.has(value as HubIntentApprovalKind)
    ? value as HubIntentApprovalKind
    : null;
}

export function requiredIntentApprovals(
  intent: HubIntent,
  resolution: Extract<HubIntentResolution, { status: "ready" }>,
): HubIntentApproval[] {
  const required = new Set<HubIntentApprovalKind>();
  for (const item of resolution.pendingApprovals) {
    if (
      intent.objective === "hub.orchestration.fulfill"
      && intent.constraints.commerceRequired !== true
      && (item === "contract" || item === "payment")
    ) continue;
    const kind = approvalKind(item);
    if (kind) required.add(kind);
  }
  if (intent.approvals.personalData === "required") required.add("personal_data");
  return [...required].map((kind) => ({ kind, status: "required" }));
}

export function initialIntentStage(objective: string): HubIntentStage {
  return objective === "hub.orchestration.fulfill" ? "discovery" : "execution";
}

function approvalGateForStage(
  run: Pick<
    HubIntentRunSnapshot,
    "objective" | "currentStage" | "commerceRequired"
  >,
): HubIntentApprovalKind[] {
  if (run.objective !== "hub.orchestration.fulfill") {
    return ["execution", "publish", "confirmation", "contract", "payment", "personal_data"];
  }
  if (run.currentStage === "contract_approval") return ["contract"];
  if (run.currentStage === "payment_approval") return ["payment"];
  if (run.currentStage === "execution") return ["execution", "personal_data"];
  return [];
}

export function initialIntentState(
  approvals: HubIntentApproval[],
  objective = "",
  currentStage: HubIntentStage = "execution",
): HubIntentRunState {
  if (
    objective === "hub.orchestration.fulfill"
    && currentStage === "discovery"
  ) return "handoff_required";
  const gate = approvalGateForStage({ objective, currentStage });
  return approvals.some((approval) =>
    gate.includes(approval.kind) && approval.status !== "granted"
  )
    ? "awaiting_approval"
    : "ready";
}

export function pendingIntentApprovals(run: HubIntentRunSnapshot) {
  return run.approvals
    .filter((approval) => approval.status !== "granted")
    .map((approval) => approval.kind);
}

export function blockingIntentApprovals(run: HubIntentRunSnapshot) {
  const gate = approvalGateForStage(run);
  return run.approvals
    .filter((approval) =>
      gate.includes(approval.kind) && approval.status !== "granted"
    )
    .map((approval) => approval.kind);
}

export function decideIntentApproval(
  run: HubIntentRunSnapshot,
  input: {
    kind: HubIntentApprovalKind;
    decision: "granted" | "denied";
    previewHash?: string | null;
  },
): HubIntentRunSnapshot {
  if (["completed", "cancelled", "expired"].includes(run.state)) {
    throw new Error("intent_run_terminal");
  }
  const approval = run.approvals.find((item) => item.kind === input.kind);
  if (!approval) throw new Error("approval_not_required");
  const approvals = run.approvals.map((item) =>
    item.kind === input.kind
      ? { ...item, status: input.decision, previewHash: input.previewHash ?? null }
      : item
  );
  return {
    ...run,
    approvals,
    state: input.decision === "denied"
      ? "paused"
      : blockingIntentApprovals({ ...run, approvals }).length === 0
        ? "ready"
        : "awaiting_approval",
    version: run.version + 1,
  };
}

export function advanceIntentRun(
  run: HubIntentRunSnapshot,
  input: {
    expectedVersion: number;
    outcome?: "continue" | "handoff" | "pause" | "complete" | "fail";
  },
): HubIntentRunSnapshot {
  if (run.version !== input.expectedVersion) throw new Error("intent_version_conflict");
  if (new Date(run.expiresAt).getTime() <= Date.now()) {
    return { ...run, state: "expired", version: run.version + 1 };
  }
  if (["completed", "cancelled", "expired"].includes(run.state)) {
    throw new Error("intent_run_terminal");
  }
  if (blockingIntentApprovals(run).length) throw new Error("approval_required");

  const outcome = input.outcome ?? "continue";
  if (
    run.objective === "hub.orchestration.fulfill"
    && outcome === "complete"
  ) {
    throw new Error("owner_result_required");
  }
  if (
    run.objective === "hub.orchestration.fulfill"
    && run.currentStage === "payment_approval"
  ) {
    return {
      ...run,
      currentStage: "fulfillment",
      state: "handoff_required",
      version: run.version + 1,
    };
  }
  if (
    run.objective === "hub.orchestration.fulfill"
    && (run.currentStage === "discovery" || run.currentStage === "fulfillment")
  ) {
    if (run.state === "handoff_required") throw new Error("owner_result_required");
    if (outcome === "fail") {
      return { ...run, state: "failed", version: run.version + 1 };
    }
    if (outcome === "pause") {
      return { ...run, state: "paused", version: run.version + 1 };
    }
    return { ...run, state: "handoff_required", version: run.version + 1 };
  }
  if (outcome === "fail") return { ...run, state: "failed", version: run.version + 1 };
  if (outcome === "pause") return { ...run, state: "paused", version: run.version + 1 };
  if (outcome === "handoff") {
    return { ...run, state: "handoff_required", version: run.version + 1 };
  }
  if (outcome === "complete" || run.currentStage === "complete") {
    return {
      ...run,
      state: "completed",
      currentStage: "complete",
      version: run.version + 1,
    };
  }
  const index = HUB_INTENT_STAGES.indexOf(run.currentStage);
  const currentStage = HUB_INTENT_STAGES[Math.min(index + 1, HUB_INTENT_STAGES.length - 1)];
  const candidate = { ...run, currentStage };
  return {
    ...run,
    currentStage,
    state: currentStage === "complete"
      ? "completed"
      : blockingIntentApprovals(candidate).length
        ? "awaiting_approval"
        : "running",
    version: run.version + 1,
  };
}

export function applyIntentOwnerResult(
  run: HubIntentRunSnapshot,
  input: HubIntentOwnerResult & { expectedVersion: number },
): HubIntentRunSnapshot {
  if (run.version !== input.expectedVersion) throw new Error("intent_version_conflict");
  if (
    run.objective !== "hub.orchestration.fulfill"
    || run.state !== "handoff_required"
    || !["discovery", "fulfillment"].includes(run.currentStage)
  ) {
    throw new Error("owner_result_not_expected");
  }
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(input.operationRef)) {
    throw new Error("invalid_owner_operation_ref");
  }
  safeCheckpointSummary(input.safeSummary);
  if (input.status === "failed") {
    return { ...run, state: "failed", version: run.version + 1 };
  }
  if (run.currentStage === "discovery") {
    if (input.service !== "ai") throw new Error("owner_service_mismatch");
    if (typeof input.safeSummary.commerceRequired !== "boolean") {
      throw new Error("intent_route_required");
    }
    if (input.safeSummary.commerceRequired) {
      if (
        !["marketplace", "digital", "work", "ai"].includes(
          String(input.safeSummary.kind),
        )
        ||
        typeof input.safeSummary.contractSummary !== "string"
        || typeof input.safeSummary.counterparty !== "string"
        || typeof input.safeSummary.maximumCharge !== "string"
        || typeof input.safeSummary.currency !== "string"
        || typeof input.safeSummary.recipient !== "string"
      ) {
        throw new Error("commerce_preview_required");
      }
      const candidate: HubIntentRunSnapshot = {
        ...run,
        commerceRequired: true,
        commercePreview: {
          kind: input.safeSummary.kind as
            | "marketplace"
            | "digital"
            | "work"
            | "ai",
          contractSummary: input.safeSummary.contractSummary,
          counterparty: input.safeSummary.counterparty,
          maximumCharge: input.safeSummary.maximumCharge,
          currency: input.safeSummary.currency,
          recipient: input.safeSummary.recipient,
        },
        currentStage: "contract_approval",
        version: run.version + 1,
      };
      return {
        ...candidate,
        state: blockingIntentApprovals(candidate).length
          ? "awaiting_approval"
          : "ready",
      };
    }
    return {
      ...run,
      commerceRequired: false,
      currentStage: "complete",
      state: "completed",
      version: run.version + 1,
    };
  }
  const expectedService = run.commercePreview?.kind === "ai"
    ? "ai"
    : "commerce";
  if (input.service !== expectedService) throw new Error("owner_service_mismatch");
  return {
    ...run,
    currentStage: "complete",
    state: "completed",
    version: run.version + 1,
  };
}

export function cancelIntentRun(run: HubIntentRunSnapshot): HubIntentRunSnapshot {
  if (["completed", "cancelled", "expired"].includes(run.state)) {
    throw new Error("intent_run_terminal");
  }
  return { ...run, state: "cancelled", version: run.version + 1 };
}
