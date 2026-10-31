import {
  AI_TOOL_CONTRACTS,
  type AiPermissionScope,
  type AiToolContract,
} from "@/lib/ai-tool-contracts";
import type { HubWorkStep } from "@/lib/ai-site-orchestrator";

export type HubAiExecutionMode =
  | "automatic"
  | "consent-required"
  | "draft-only"
  | "confirmation-required"
  | "payment-authorization-required";

export type HubAiToolCapability = {
  toolId: string;
  action: string;
  capability: string;
  permission: AiPermissionScope;
  executionMode: HubAiExecutionMode;
  mayMutate: boolean;
  maySendMessage: boolean;
  mayMoveValue: boolean;
};

const CAPABILITY_OVERRIDES: Record<string, string> = {
  "search.search": "hub.search.query",
  "feed.publish_post": "hub.social.post.create",
  "community.draft_message": "hub.communication.message.draft",
  "community.publish_message": "hub.communication.message.mediate",
  "shopping.purchase_proposal": "hub.commerce.purchase.propose",
};

function capabilityName(contract: AiToolContract) {
  return CAPABILITY_OVERRIDES[contract.id]
    ?? `hub.tool.${contract.toolId}.${contract.action.replaceAll("_", "-")}`;
}

function executionMode(contract: AiToolContract): HubAiExecutionMode {
  if (contract.permission === "read:account") return "consent-required";
  if (contract.permission === "create:draft") return "draft-only";
  if (
    contract.permission === "spend:wallet"
    || contract.permission === "authorize:payment"
    || contract.permission === "propose:purchase"
  ) {
    return "payment-authorization-required";
  }
  if (contract.requiresExplicitApproval) return "confirmation-required";
  return "automatic";
}

export function toHubAiToolCapability(
  contract: AiToolContract,
): HubAiToolCapability {
  const messageAction = contract.action === "publish_message";
  const purchaseAction = contract.action === "purchase_proposal";
  return {
    toolId: contract.toolId,
    action: contract.action,
    capability: capabilityName(contract),
    permission: messageAction
      ? "approve:message-send"
      : purchaseAction
        ? "propose:purchase"
        : contract.permission,
    executionMode: executionMode({
      ...contract,
      permission: messageAction
        ? "approve:message-send"
        : purchaseAction
          ? "propose:purchase"
          : contract.permission,
    }),
    mayMutate: contract.phase === "confirm",
    maySendMessage: false,
    mayMoveValue: false,
  };
}

export const HUB_AI_TOOL_CAPABILITIES = AI_TOOL_CONTRACTS.map(
  toHubAiToolCapability,
);

const CAPABILITY_BY_ACTION = new Map(
  HUB_AI_TOOL_CAPABILITIES.map((entry) => [
    `${entry.toolId}.${entry.action}`,
    entry,
  ]),
);

export function normalizeHubWorkStep(step: HubWorkStep) {
  const capability = CAPABILITY_BY_ACTION.get(`${step.toolId}.${step.action}`);
  if (!capability) return null;
  return {
    ...step,
    phase: capability.executionMode === "automatic"
      || capability.executionMode === "consent-required"
      ? "read" as const
      : capability.executionMode === "draft-only"
        ? "draft" as const
        : "confirm" as const,
    capability,
    boundary: capability.action === "publish_message"
      ? "mediated-message-only" as const
      : capability.action === "purchase_proposal"
        ? "proposal-only" as const
        : "standard" as const,
  };
}

