import { getAiToolContract, validateAiToolInput, type AiPermissionScope } from "./ai-tool-contracts";
import type { AiTask, AiTaskStep } from "./ai-task-engine";
import type { AiOrganizationDefinition } from "./local-ai-organization";

export type AiExecutionTarget =
  | { kind: "local"; modelId: string }
  | { kind: "external"; providerId: string; maximumCostUsd: number };

export type AiExecutionPlan = {
  taskId: string;
  privacy: AiTask["privacy"];
  roles: Array<{ roleId: string; roleName: string; target: AiExecutionTarget }>;
  steps: Array<AiTaskStep & { permission: AiPermissionScope; approvalReason: string | null }>;
  requiredApprovals: string[];
  maximumExternalCostUsd: number;
  valid: boolean;
  errors: string[];
};

export function buildAiExecutionPlan(input: {
  task: AiTask;
  organization?: AiOrganizationDefinition | null;
  assignments?: Array<{ roleId: string; kind: "local" | "external"; modelId: string | null; maximumCostUsd?: number }>;
  stepInputs?: Record<string, unknown>;
}): AiExecutionPlan {
  const errors: string[] = [];
  const roles = (input.organization?.roles ?? []).map((role) => {
    const assignment = input.assignments?.find((item) => item.roleId === role.id);
    if (!assignment?.modelId) {
      errors.push(`unassigned_role:${role.id}`);
      return { roleId: role.id, roleName: role.name, target: { kind: "local", modelId: "" } as AiExecutionTarget };
    }
    if (input.task.privacy === "local_only" && assignment.kind === "external") errors.push(`external_blocked:${role.id}`);
    return {
      roleId: role.id,
      roleName: role.name,
      target: assignment.kind === "local"
        ? { kind: "local", modelId: assignment.modelId } as const
        : { kind: "external", providerId: assignment.modelId, maximumCostUsd: Math.max(0, assignment.maximumCostUsd ?? 0) } as const,
    };
  });
  const steps = input.task.steps.flatMap((step) => {
    const contract = getAiToolContract(step.toolId, step.action);
    if (!contract) {
      errors.push(`unknown_tool_action:${step.toolId}.${step.action}`);
      return [];
    }
    const validation = validateAiToolInput(contract, input.stepInputs?.[step.id]);
    if (!validation.valid) errors.push(`${validation.error}:${step.id}`);
    return [{
      ...step,
      phase: contract.phase,
      verification: { kind: contract.verification === "settlement" ? "state" : contract.verification },
      permission: contract.permission,
      approvalReason: contract.requiresExplicitApproval
        ? contract.risk === "financial"
          ? "支払い内容と最大金額を確認"
          : "公開・変更内容を確認"
        : null,
    }];
  });
  const maximumExternalCostUsd = roles.reduce((sum, role) => sum + (role.target.kind === "external" ? role.target.maximumCostUsd : 0), 0);
  if (maximumExternalCostUsd > input.task.budgetUsd) errors.push("external_budget_exceeded");
  return {
    taskId: input.task.id,
    privacy: input.task.privacy,
    roles,
    steps,
    requiredApprovals: steps.filter((step) => step.approvalReason).map((step) => step.id),
    maximumExternalCostUsd,
    valid: errors.length === 0,
    errors,
  };
}
