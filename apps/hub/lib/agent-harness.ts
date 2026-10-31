import type { AiTask } from "./ai-task-engine";
import type { AiOrganizationDefinition } from "./local-ai-organization";
import type { LocalModel } from "@/components/ai-local-runner-panel";

// "code-sandbox" runs generated code in a container and throws it away.
// "workspace-edit" is the other thing entirely: a coding CLI changing real
// files in a directory the operator chose, and keeping the result.
export type HarnessCapability = "chat"|"organization"|"local-models"|"code-sandbox"|"workspace-edit"|"artifacts"|"cancel";
export type HarnessManifest = { id:string; name:string; version:string; license:string; runtime:"local-runner"|"remote-api"; capabilities:HarnessCapability[]; network:"off"|"restricted"|"required" };
// "progress" carries what the run has produced so far. Without it a caller that
// wants to show a long run has to poll the same endpoint the harness is already
// polling, and the two renderings drift apart.
// What a run left in the workspace. Present only for harnesses that edit files
// and only when the workspace is a git repository.
export type HarnessFileChange = { path:string; state:string; alreadyDirty:boolean; afterSha256?:string|null; revertSupported?:boolean };
export type HarnessCheck = { name:string; status:string; detail:string };
export type HarnessControlSnapshot = {
  contract:{id:string;objective:string;workspace:string;constraints:string[];acceptanceCriteria:string[];permissions:{filesystem:string;shell:boolean;network:boolean;gitCommit:boolean;gitPush:boolean;deploy:boolean}};
  state:{runId:string;taskId:string;status:string;phase:string;plan:Array<{id:string;description:string;dependencies:string[];status:string}>;activeStepId?:string|null;observations:Array<{kind:string;summary:string;trust:string;atMs:number}>;changedFiles:string[];errors:string[];toolCallCount:number;modelTurnCount:number;checkpointId:string;forceReplan:boolean;startedAtMs:number;updatedAtMs:number};
  trace:Array<{sequence:number;kind:string;phase:string;detail:string;atMs:number}>;
  toolRegistry:Array<{name:string;risk:string;timeoutMs:number;enforcement:string}>;
  adapter?:HarnessAdapterContract;
  failureClass?:string|null;
  context:{hotChars:number;warmChars:number;coldChars:number;sourceCount:number;budgetChars:number;compacted:boolean};
  approval:{id:string;state:string;riskLevel:string;requestedCapabilities:string[];blockedCapabilities:string[];requestFingerprint:string;requestedAtMs:number;decidedAtMs?:number|null};
  evaluation:{completionGatePassed:boolean;recoveryAvailable:boolean;approvalAudited:boolean;contextCompacted:boolean;policyViolations:number;passedChecks:number;failedChecks:number;score:number};
};
export type HarnessAdapterContract = {id:string;label:string;protocolVersion:string;transport:string;executionAuthority:"provider_harness"|string;approvalMode:string;connectionState:"connected"|"unavailable"|"blocked"|string;capabilities:string[];providerOwns:string[]};
export type HarnessVerificationCommand = {program:string;args:string[];cwd?:string;timeoutMs?:number|null};
export type HarnessTokenUsage = { inputTokens:number|null;uncachedInputTokens:number|null;cacheReadTokens:number|null;cacheWriteTokens:number|null;outputTokens:number };
export type HarnessRuntime = { phase:string;toolCalls:number;iterations:number;elapsedMs:number;budget:{maxDurationMs:number;maxToolCalls:number;maxOutputBytes:number};stopReason?:string|null;control?:HarnessControlSnapshot;usage?:HarnessTokenUsage|null;verification?:{status:string;attempts:number}|null;pendingVerification?:{id:string;command:HarnessVerificationCommand}|null };
export type HarnessEvent = { type:"started";runId:string }|{type:"approval_required";runId:string;approval?:HarnessControlSnapshot["approval"]}|{type:"verifying";runId:string;output:string;runtime?:HarnessRuntime}|{type:"progress";runId:string;output:string;runtime?:HarnessRuntime}|{type:"completed";runId:string;output:string;changed?:HarnessFileChange[];checks?:HarnessCheck[];runtime?:HarnessRuntime;stages:Array<{id:string;label:string;model:string;durationMs:number}>;artifacts:Array<{id:string;roleId:string;roleName:string;summary:string}>}|{type:"failed";runId:string;error:string};
// A few seconds of unreachable runner is a hiccup; the agent keeps working
// through it. Beyond that it is worth telling the caller, because the run may
// have outlived the app watching it.
const MISSED_POLLS_ALLOWED=5;
// A real piece of development runs for minutes to hours. The cap is not a
// deadline for the agent, only for how long one screen keeps asking.
const HOURS_WATCHED=6;
// A finished run as the screens see it. `revertable` is decided per request by
// the runner: undo restores only paths one run changed and is offered after a
// restart only while the persisted snapshot and after-hashes still match.
export type HarnessRunRecord = { id:string; agent:string; model:string; status:string; prompt:string; sessionId:string|null; startedAtMs:number; exitCode:number|null; tail:string; changed?:HarnessFileChange[]|null; revertable:boolean; outputTruncated?:boolean; checks?:HarnessCheck[];phase?:string;toolCalls?:number;iterations?:number;budget?:HarnessRuntime["budget"];stopReason?:string|null;harness?:HarnessControlSnapshot;usage?:HarnessTokenUsage|null;verification?:HarnessRuntime["verification"] };
export type HarnessRunRequest = { task:AiTask; prompt:string; organization?:AiOrganizationDefinition|null;verification?:HarnessVerificationCommand };

export interface AgentHarness {
  manifest:HarnessManifest;
  available():Promise<boolean>;
  run(request:HarnessRunRequest):AsyncIterable<HarnessEvent>;
  cancel(runId:string):Promise<void>;
}

export function validateHarnessManifest(value:HarnessManifest):boolean {
  return /^[a-z0-9][a-z0-9._-]{1,79}$/.test(value.id)&&value.name.length>0&&value.name.length<=100&&/^\d+\.\d+\.\d+$/.test(value.version)&&value.license.length>0&&value.capabilities.length>0&&value.capabilities.length<=20&&new Set(value.capabilities).size===value.capabilities.length;
}

export class HarnessRegistry {
  private readonly harnesses=new Map<string,AgentHarness>();
  register(harness:AgentHarness){if(!validateHarnessManifest(harness.manifest))throw new Error("invalid_harness_manifest");if(this.harnesses.has(harness.manifest.id))throw new Error("duplicate_harness");this.harnesses.set(harness.manifest.id,harness);}
  get(id:string){return this.harnesses.get(id)??null;}
  list(){return [...this.harnesses.values()].map((harness)=>harness.manifest);}
  async select(required:HarnessCapability[],privacy:AiTask["privacy"]){for(const harness of this.harnesses.values()){if(privacy==="local_only"&&(harness.manifest.runtime!=="local-runner"||harness.manifest.network!=="off"))continue;if(required.every((item)=>harness.manifest.capabilities.includes(item))&&await harness.available())return harness;}return null;}
}

export class LocalRunnerHarness implements AgentHarness {
  readonly manifest:HarnessManifest={id:"hub.local-runner",name:"Hub",version:"1.0.0",license:"JKamma Platform",runtime:"local-runner",capabilities:["chat","organization","local-models","code-sandbox","artifacts","cancel"],network:"off"};
  private runs=new Map<string,AbortController>();
  constructor(private token:string,private models:LocalModel[],private base="http://127.0.0.1:43127"){}
  async available(){try{return (await fetch(`${this.base}/health`,{cache:"no-store"})).ok;}catch{return false;}}
  async *run(request:HarnessRunRequest):AsyncIterable<HarnessEvent>{
    const controller=new AbortController();
    let runId="";
    try{
      const response=await fetch(`${this.base}/local-ai/jobs`,{method:"POST",headers:{authorization:`Bearer ${this.token}`,"content-type":"application/json"},body:JSON.stringify({models:this.models.slice(0,3),prompt:request.prompt,organization:request.organization??null}),signal:controller.signal});
      const created=await response.json() as {id?:string;error?:string};
      if(!response.ok||!created.id)throw new Error(created.error??"harness_failed");
      runId=created.id;this.runs.set(runId,controller);yield{type:"started",runId};
      for(let attempt=0;attempt<1200;attempt+=1){
        await new Promise((resolve)=>setTimeout(resolve,500));
        const statusResponse=await fetch(`${this.base}/local-ai/jobs/${encodeURIComponent(runId)}`,{headers:{authorization:`Bearer ${this.token}`},cache:"no-store",signal:controller.signal});
        const status=await statusResponse.json() as {status?:string;output?:{output?:string;stages?:Array<{id:string;label:string;model:string;durationMs:number}>;artifacts?:Array<{id:string;roleId:string;roleName:string;summary:string}>};error?:string};
        if(!statusResponse.ok)throw new Error(status.error??"harness_failed");
        if(status.status==="completed"&&status.output?.output){yield{type:"completed",runId,output:status.output.output,stages:status.output.stages??[],artifacts:status.output.artifacts??[]};return;}
        if(status.status==="failed"||status.status==="cancelled")throw new Error(status.status);
      }
      throw new Error("harness_timeout");
    }catch(cause){yield{type:"failed",runId,error:cause instanceof DOMException&&cause.name==="AbortError"?"cancelled":cause instanceof Error?cause.message:"harness_failed"};}
    finally{if(runId)this.runs.delete(runId);}
  }
  async cancel(runId:string){
    const controller=this.runs.get(runId);
    await fetch(`${this.base}/local-ai/jobs/${encodeURIComponent(runId)}/cancel`,{method:"POST",headers:{authorization:`Bearer ${this.token}`}}).catch(()=>undefined);
    controller?.abort();this.runs.delete(runId);
  }
}

const DEVELOPMENT_CLIENT_KEY="hub-development-client-v1";
function developmentClientId():string{
  try{
    const existing=globalThis.localStorage?.getItem(DEVELOPMENT_CLIENT_KEY);
    if(existing&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(existing))return existing;
    const created=globalThis.crypto.randomUUID();
    globalThis.localStorage?.setItem(DEVELOPMENT_CLIENT_KEY,created);
    return created;
  }catch{return globalThis.crypto?.randomUUID?.()??"00000000-0000-4000-8000-000000000000";}
}

/**
 * The coding CLIs this machine is signed in to, allowed to change files.
 *
 * Kept apart from LocalRunnerHarness because the two differ in what they are
 * permitted to touch, not merely in which endpoint they call. That one runs
 * generated code in a container and discards it; this one edits a directory the
 * operator picked and leaves the result behind. Selecting the wrong one is not a
 * performance question, so they advertise different capabilities.
 */
export class HarnessConnector implements AgentHarness {
  // Compatibility name: this object is a client for connected provider
  // harnesses. Hub does not own their agent loop or tool execution.
  readonly manifest:HarnessManifest={id:"hub.harness-connectors",name:"Hub Harness Connectors",version:"1.0.0",license:"JKamma Platform",runtime:"local-runner",capabilities:["chat","workspace-edit","artifacts","cancel"],network:"required"};
  private runs=new Map<string,AbortController>();
  // The agent id is whatever the machine defines, so this does not name them.
  constructor(private token:string,private agent="codex",private model?:string,private base="http://127.0.0.1:43127",private resume?:string,private clientId=developmentClientId()){}
  private headers(json=false){return {authorization:`Bearer ${this.token}`,"x-hub-client-id":this.clientId,...(json?{"content-type":"application/json"}:{})};}
  /**
   * Unavailable until a workspace is configured. Health alone would say yes on a
   * machine where every run is going to be refused, and the registry would then
   * hand work to a harness that cannot accept it.
   */
  async available(){
    try{
      const response=await fetch(`${this.base}/dev/workspace`,{headers:this.headers(),cache:"no-store"});
      if(!response.ok)return false;
      return ((await response.json()) as {enabled?:boolean}).enabled===true;
    }catch{return false;}
  }
  async *run(request:HarnessRunRequest):AsyncIterable<HarnessEvent>{
    const controller=new AbortController();
    let runId="";
    try{
      const idempotencyKey=globalThis.crypto?.randomUUID?.()??`${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const response=await fetch(`${this.base}/dev/runs`,{method:"POST",headers:this.headers(true),body:JSON.stringify({agent:this.agent,prompt:request.prompt,model:this.model??null,resume:this.resume??null,idempotencyKey,...(request.verification?{verification:request.verification}:{})}),signal:controller.signal});
      const created=await response.json() as {runId?:string;error?:string};
      if(!response.ok||!created.runId)throw new Error(created.error??"harness_failed");
      runId=created.runId;this.runs.set(runId,controller);yield{type:"started",runId};
      yield*this.follow(runId,Date.now(),controller);
    }catch(cause){yield{type:"failed",runId,error:cause instanceof DOMException&&cause.name==="AbortError"?"cancelled":cause instanceof Error?cause.message:"harness_failed"};}
    finally{if(runId)this.runs.delete(runId);}
  }
  /**
   * Watch a run this harness did not start.
   *
   * Starting and watching are separate concerns, which is why they are separate
   * methods: a retried start can begin a second run, while watching can always
   * be picked up again — including by a screen that was closed and reopened.
   */
  async *watch(runId:string):AsyncIterable<HarnessEvent>{
    const controller=new AbortController();
    this.runs.set(runId,controller);
    try{
      yield{type:"started",runId};
      yield*this.follow(runId,Date.now(),controller);
    }catch(cause){yield{type:"failed",runId,error:cause instanceof DOMException&&cause.name==="AbortError"?"cancelled":cause instanceof Error?cause.message:"harness_failed"};}
    finally{this.runs.delete(runId);}
  }
  /** Poll one run to its end. Throws on failure so both callers report it alike. */
  private async *follow(runId:string,started:number,controller:AbortController):AsyncIterable<HarnessEvent>{
    let shown="";
    let lastEmitted="";
    let cursor=0;
    let missed=0;
    let approvalShown=false;
    let verifyingShown=false;
    for(let attempt=0;attempt<HOURS_WATCHED*3600;attempt+=1){
      await new Promise((resolve)=>setTimeout(resolve,1000));
      // Only the watching is retried, never the starting: a retried start can
      // begin a second run, while a failed poll says nothing about the agent,
      // which is still editing the workspace. A gone session or a gone run is
      // final, so those are not retried.
      let statusResponse:Response;
      try{
        statusResponse=await fetch(`${this.base}/dev/runs/${encodeURIComponent(runId)}?after=${cursor}`,{headers:this.headers(),cache:"no-store",signal:controller.signal});
      }catch(cause){
        if(cause instanceof DOMException&&cause.name==="AbortError")throw cause;
        if((missed+=1)>MISSED_POLLS_ALLOWED)throw new Error("harness_unreachable");
        continue;
      }
      if(statusResponse.status===401||statusResponse.status===404)throw new Error("harness_failed");
      if(!statusResponse.ok){
        if((missed+=1)>MISSED_POLLS_ALLOWED)throw new Error("harness_unreachable");
        continue;
      }
      missed=0;
      const status=await statusResponse.json() as Pick<HarnessRuntime,"verification"|"pendingVerification"|"usage"> & {status?:string;output?:string;nextCursor?:number;outputTruncated?:boolean;exitCode?:number|null;changed?:HarnessFileChange[];checks?:HarnessCheck[];phase?:string;toolCalls?:number;iterations?:number;elapsedMs?:number;budget?:HarnessRuntime["budget"];stopReason?:string|null;harness?:HarnessControlSnapshot;approval?:HarnessControlSnapshot["approval"]};
      const runtime:HarnessRuntime|undefined=status.budget?{phase:status.phase??"executing",toolCalls:status.toolCalls??0,iterations:status.iterations??0,elapsedMs:status.elapsedMs??0,budget:status.budget,stopReason:status.stopReason,control:status.harness,usage:status.usage,verification:status.verification,pendingVerification:status.pendingVerification}:undefined;
      const piece=summarize(status.output??"");
      const incremental=typeof status.nextCursor==="number";
      if(piece)shown=incremental?(shown?`${shown}\n${piece}`:piece):piece;
      if(status.outputTruncated&&!shown.includes("出力上限"))shown+=`${shown?"\n":""}[出力上限に達したため、以後の詳細は省略されました]`;
      if(typeof status.nextCursor==="number")cursor=status.nextCursor;
      if(status.status==="awaiting_confirmation"){
        if(!approvalShown){approvalShown=true;yield{type:"approval_required",runId,approval:status.approval??status.harness?.approval};}
        continue;
      }
      if(status.status==="verifying"){
        if(!verifyingShown||runtime){verifyingShown=true;yield{type:"verifying",runId,output:shown,runtime};}
        continue;
      }
      if(status.status==="done"){yield{type:"completed",runId,output:shown,changed:status.changed,checks:status.checks,runtime,stages:[{id:runId,label:this.agent,model:this.model??"default",durationMs:Date.now()-started}],artifacts:[]};return;}
      if(runtime&&["failed","cancelled","denied","expired","conflicted"].includes(status.status??""))yield{type:"progress",runId,output:shown,runtime};
      if(status.status==="failed")throw new Error(status.stopReason??`exit_${status.exitCode??"unknown"}`);
      if(status.status==="cancelled"||status.status==="denied"||status.status==="expired"||status.status==="conflicted")throw new Error(status.status);
      // Only when there is something new to show, so a quiet minute does not
      // produce sixty identical events.
      if((shown&&shown!==lastEmitted)||runtime){lastEmitted=shown;yield{type:"progress",runId,output:shown,runtime};}
    }
    // Giving up watching is not the same as stopping the work, and no longer
    // has to be: `inProgress` finds a run again, so an unwatched run is not a
    // lost one. Killing a six-hour refactor because one watcher timed out would
    // be the more expensive mistake, so this reports and leaves it running.
    throw new Error("harness_unwatched");
  }
  async cancel(runId:string){
    // Keep watching until the runner has killed the process tree, captured the
    // partial diff and persisted the receipt. Aborting the watcher would make
    // "中断" look complete before recovery data exists.
    await fetch(`${this.base}/dev/runs/${encodeURIComponent(runId)}/cancel`,{method:"POST",headers:this.headers()});
  }
  /**
   * Decide a parked run from inside Hub.
   *
   * Approval used to be native-window only; the Hub surface is the harness
   * now, so the same human decides here instead. The runner still requires
   * the live pairing token and this client's owner scope — the call cannot
   * approve a run another client asked for.
   */
  async approve(runId:string){
    const response=await fetch(`${this.base}/dev/runs/${encodeURIComponent(runId)}/approve`,{method:"POST",headers:this.headers()});
    if(!response.ok)throw new Error((await response.json() as {error?:string}).error??"approve_failed");
  }
  async deny(runId:string){
    const response=await fetch(`${this.base}/dev/runs/${encodeURIComponent(runId)}/deny`,{method:"POST",headers:this.headers()});
    if(!response.ok)throw new Error((await response.json() as {error?:string}).error??"deny_failed");
  }
  async decideVerification(runId:string,actionId:string,approve:boolean){
    const response=await fetch(`${this.base}/dev/runs/${encodeURIComponent(runId)}/verification`,{method:"POST",headers:this.headers(true),body:JSON.stringify({actionId,approve})});
    if(!response.ok)throw new Error((await response.json() as {error?:string}).error??"verification_decision_failed");
  }
  /** Put back only what this run changed. Returns the paths actually restored. */
  async revert(runId:string):Promise<string[]>{
    const response=await fetch(`${this.base}/dev/runs/${encodeURIComponent(runId)}/revert`,{method:"POST",headers:this.headers()});
    if(!response.ok)throw new Error((await response.json() as {error?:string}).error??"revert_failed");
    return await response.json() as string[];
  }
  /**
   * Finished runs, newest first, from the machine's own store.
   *
   * This is where a continuation handle comes from. Holding it in component
   * state loses it on a reload, and holding it in memory loses it on restart,
   * which is exactly when someone wants to carry on where they stopped.
   */
  async history():Promise<HarnessRunRecord[]>{
    const response=await fetch(`${this.base}/dev/history`,{headers:this.headers(),cache:"no-store"});
    if(!response.ok)return [];
    return await response.json();
  }
  /**
   * The run still going on this machine, if there is one.
   *
   * A run outlives the screen that started it. Reopening to an empty form hides
   * an agent that is still editing, and the natural response — asking for the
   * same work again — is refused by the runner as a second run in one workspace.
   */
  async inProgress():Promise<{runId:string;agent:string;model:string;status:string;output:string;runtime?:HarnessRuntime}|null>{
    const response=await fetch(`${this.base}/dev/runs`,{headers:this.headers(),cache:"no-store"});
    if(!response.ok)return null;
    const run=await response.json() as (Pick<HarnessRuntime,"verification"|"pendingVerification"|"usage"> & {id?:string;agent?:string;model?:string;status?:string;output?:string;phase?:string;toolCalls?:number;iterations?:number;startedAtMs?:number;budget?:HarnessRuntime["budget"];stopReason?:string|null;harness?:HarnessControlSnapshot})|null;
    const runtime=run?.budget?{phase:run.phase??"executing",toolCalls:run.toolCalls??0,iterations:run.iterations??0,elapsedMs:Math.max(0,Date.now()-Number(run.startedAtMs??Date.now())),budget:run.budget,stopReason:run.stopReason,control:run.harness,usage:run.usage,verification:run.verification,pendingVerification:run.pendingVerification}:undefined;
    return typeof run?.id==="string"?{runId:run.id,agent:run.agent??"",model:run.model??"",status:run.status??"running",output:summarize(run.output??""),runtime}:null;
  }
  /** The record survives a failed or cancelled run, so it is fetched separately. */
  async changes(runId:string):Promise<HarnessFileChange[]|null>{
    const response=await fetch(`${this.base}/dev/runs/${encodeURIComponent(runId)}`,{headers:this.headers(),cache:"no-store"});
    if(!response.ok)return null;
    return ((await response.json()) as {changed?:HarnessFileChange[]|null}).changed??null;
  }
}

// Source compatibility for callers written before Hub was explicitly modeled
// as a connector control plane.
export { HarnessConnector as DevelopmentHarness };

/**
 * The run's raw output is JSONL and mostly bookkeeping. A harness contract
 * promises a string a caller can show, so reduce it to the tools reached for and
 * what the agent said, dropping the repeat the closing result event carries.
 */
export function summarize(output:string){
  const lines:string[]=[];
  for(const line of output.split("\n")){
    if(!line.trim())continue;
    let event:Record<string,unknown>;
    try{event=JSON.parse(line) as Record<string,unknown>;}catch{lines.push(line);continue;}
    if(event.type==="assistant"){
      const message=event.message as {content?:Array<Record<string,string>>}|undefined;
      const text=(message?.content??[]).map((part)=>part.type==="text"?part.text:part.type==="tool_use"?`→ ${part.name}`:"").filter(Boolean).join("\n");
      if(text)lines.push(text);
      continue;
    }
    if(event.type==="result"&&event.result)lines.push(String(event.result));
    if(event.type==="item.started"||event.type==="item.completed"){
      const item=event.item as {type?:string;text?:string}|undefined;
      if(event.type==="item.completed"&&item?.type==="agent_message"&&item.text)lines.push(item.text);
      if(event.type==="item.started"&&item?.type==="command_execution")lines.push("→ Command");
      if(event.type==="item.started"&&item?.type==="file_change")lines.push("→ File change");
    }
  }
  return lines.filter((line,index)=>line!==lines[index-1]).join("\n");
}
