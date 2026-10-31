export type AiTaskState = "planned" | "waiting_approval" | "queued" | "running" | "verifying" | "completed" | "failed" | "cancelled";
export type AiTaskPhase = "read" | "draft" | "confirm" | "execute" | "verify";

export type AiTaskStep = {
  id: string;
  roleId: string;
  toolId: string;
  action: string;
  phase: AiTaskPhase;
  inputRef?: string;
  artifactRefs: string[];
  status: "pending" | "running" | "passed" | "failed" | "cancelled";
  maximumCostUsd: number;
  verification: { kind: "response" | "artifact" | "test" | "state"; expected?: string };
};

export type AiTask = {
  id: string;
  title: string;
  project: string;
  state: AiTaskState;
  privacy: "local_only" | "local_preferred";
  budgetUsd: number;
  minimumMarginUsd: number;
  steps: AiTaskStep[];
};

const TRANSITIONS: Record<AiTaskState, AiTaskState[]> = {
  planned: ["waiting_approval","queued","cancelled"], waiting_approval: ["queued","cancelled"], queued: ["running","cancelled"],
  running: ["verifying","failed","cancelled"], verifying: ["completed","failed","cancelled"], completed: [], failed: ["queued","cancelled"], cancelled: [],
};

export function transitionAiTask(task: AiTask, next: AiTaskState): AiTask {
  if (!TRANSITIONS[task.state].includes(next)) throw new Error(`invalid_task_transition:${task.state}:${next}`);
  return { ...task, state: next };
}

export function calculateTaskEconomics(input: { saleUsd: number; providerUsd: number; settlementUsd: number; infrastructureUsd: number; retryReserveUsd: number; minimumMarginUsd: number }) {
  const costUsd=input.providerUsd+input.settlementUsd+input.infrastructureUsd+input.retryReserveUsd;
  const marginUsd=input.saleUsd-costUsd;
  return { costUsd, marginUsd, profitable:Number.isFinite(marginUsd)&&marginUsd>=input.minimumMarginUsd };
}

export function compileAiTask(input: { title: string; project: string; privacy: AiTask["privacy"]; budgetUsd: number; minimumMarginUsd?: number; steps: Array<{ toolId:string; action:string; phase:"read"|"draft"|"confirm"; input?:Record<string,string> }> }): AiTask {
  const steps=input.steps.slice(0,50).map((step,index):AiTaskStep=>({id:`${step.toolId}-${index+1}`,roleId:"manager",toolId:step.toolId,action:step.action,phase:step.phase,artifactRefs:[],status:"pending",maximumCostUsd:0,verification:{kind:step.phase==="read"?"response":step.phase==="draft"?"artifact":"state"}}));
  return {id:crypto.randomUUID(),title:input.title.slice(0,120),project:input.project.slice(0,80)||"一般",state:steps.some((step)=>step.phase==="confirm")?"waiting_approval":"queued",privacy:input.privacy,budgetUsd:Math.max(0,input.budgetUsd),minimumMarginUsd:Math.max(0,input.minimumMarginUsd??0),steps};
}

export function verifyTaskCompletion(task: AiTask, evidence: Record<string,{artifactRefs?:string[];response?:boolean;testPassed?:boolean;stateConfirmed?:boolean}>) {
  const failures=task.steps.filter((step)=>{const item=evidence[step.id];if(!item)return true;if(step.verification.kind==="artifact")return !(item.artifactRefs?.length);if(step.verification.kind==="test")return item.testPassed!==true;if(step.verification.kind==="state")return item.stateConfirmed!==true;return item.response!==true;}).map((step)=>step.id);
  return {passed:failures.length===0,failures};
}
