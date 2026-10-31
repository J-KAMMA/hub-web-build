import type { AiExecutionPlan, AiExecutionTarget } from "./ai-execution-plan";
import type { AiOrganizationDefinition, AiOrganizationRole } from "./local-ai-organization";

export type HybridRoleResult = {
  roleId: string;
  roleName: string;
  target: AiExecutionTarget;
  output: string;
  durationMs: number;
};

export type HybridRoleRunner = (input: {
  role: AiOrganizationRole;
  target: AiExecutionTarget;
  prompt: string;
  priorResults: HybridRoleResult[];
  signal?: AbortSignal;
}) => Promise<string>;

function rolePrompt(objective: string, role: AiOrganizationRole, priorResults: HybridRoleResult[]) {
  const prior = priorResults.length
    ? `\n\n先行する役職の成果:\n${priorResults.map((item) => `[${item.roleName}]\n${item.output}`).join("\n\n")}`
    : "";
  return `組織の目的: ${objective}\n担当: ${role.name}\n責任範囲: ${role.responsibility}\n責任範囲内の成果だけを返してください。${prior}`.slice(-24_000);
}

export async function runHybridOrganization(input: {
  organization: AiOrganizationDefinition;
  plan: AiExecutionPlan;
  runRole: HybridRoleRunner;
  synthesize: HybridRoleRunner;
  signal?: AbortSignal;
}) {
  if (!input.plan.valid) throw new Error(`invalid_execution_plan:${input.plan.errors.join(",")}`);
  const targetByRole = new Map(input.plan.roles.map((item) => [item.roleId, item.target]));
  const execute = async (role: AiOrganizationRole, priorResults: HybridRoleResult[]) => {
    if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const target = targetByRole.get(role.id);
    if (!target) throw new Error(`unassigned_role:${role.id}`);
    const started = performance.now();
    const output = await input.runRole({ role, target, prompt: rolePrompt(input.organization.objective, role, priorResults), priorResults, signal: input.signal });
    return { roleId: role.id, roleName: role.name, target, output, durationMs: Math.max(0, Math.round(performance.now() - started)) };
  };
  const leader = input.organization.roles.find((role) => role.reportsToId === null) ?? input.organization.roles[0];
  const workers = input.organization.roles.filter((role) => role.id !== leader?.id);
  const workerResults: HybridRoleResult[] = [];
  if (input.organization.mode === "parallel") {
    workerResults.push(...await Promise.all(workers.map((role) => execute(role, []))));
  } else {
    for (const role of workers) workerResults.push(await execute(role, [...workerResults]));
  }
  if (!leader) return { output: "", results: workerResults };
  const leaderTarget = targetByRole.get(leader.id);
  if (!leaderTarget) throw new Error(`unassigned_role:${leader.id}`);
  const output = await input.synthesize({
    role: leader,
    target: leaderTarget,
    prompt: `${rolePrompt(input.organization.objective, leader, workerResults)}\n\n各成果を検証し、矛盾を解消した最終成果を返してください。`,
    priorResults: workerResults,
    signal: input.signal,
  });
  return { output, results: workerResults };
}
