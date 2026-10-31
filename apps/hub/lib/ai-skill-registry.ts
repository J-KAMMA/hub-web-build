import type { HarnessCapability } from "./agent-harness";
import type { AiTask } from "./ai-task-engine";

export type HubSkillPermission =
  | "read:public" | "read:project" | "read:local-files" | "create:draft"
  | "write:workspace" | "execute:code" | "network:restricted"
  | "publish:post" | "send:message" | "spend:wallet";

export type HubSkillManifest = {
  id: string;
  name: string;
  version: string;
  author: string;
  license: string;
  source: { repository?: string; commit?: string; contentHash: string };
  description: string;
  triggers: string[];
  capabilities: string[];
  tools: string[];
  permissions: HubSkillPermission[];
  execution: {
    runtime: "instructions" | "local-sandbox";
    network: "off" | "restricted";
    privacy: "local-only" | "local-preferred";
    compatibleHarnesses: string[];
  };
  verification: Array<{ kind: "artifact" | "test" | "state" | "response"; expected?: string }>;
  instructions?: string;
  files?: Array<{ path: string; contentHash: string; sizeBytes: number }>;
};

export type SkillRisk = {
  level: "low" | "medium" | "high";
  reasons: string[];
  requiresExecutionApproval: boolean;
  requiresPerUseApproval: boolean;
};

const PERMISSIONS = new Set<HubSkillPermission>(["read:public","read:project","read:local-files","create:draft","write:workspace","execute:code","network:restricted","publish:post","send:message","spend:wallet"]);
const CONSEQUENTIAL = new Set<HubSkillPermission>(["publish:post","send:message","spend:wallet"]);

export function validateSkillManifest(value: HubSkillManifest): string[] {
  const errors: string[]=[];
  if(!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(value.id))errors.push("invalid_id");
  if(!value.name.trim()||value.name.length>100)errors.push("invalid_name");
  if(!/^\d+\.\d+\.\d+$/.test(value.version))errors.push("invalid_version");
  if(!value.author.trim()||!value.license.trim())errors.push("missing_attribution");
  if(!/^[a-f0-9]{64}$/.test(value.source.contentHash))errors.push("invalid_content_hash");
  if(!value.description.trim()||value.description.length>1000)errors.push("invalid_description");
  if(value.triggers.length>50||value.capabilities.length>50||value.tools.length>50)errors.push("too_many_entries");
  if(value.permissions.some((item)=>!PERMISSIONS.has(item)))errors.push("invalid_permission");
  if(value.execution.runtime==="instructions"&&value.permissions.includes("execute:code"))errors.push("instruction_skill_cannot_execute");
  if(value.execution.network==="off"&&value.permissions.includes("network:restricted"))errors.push("network_policy_conflict");
  if(value.files?.some((file)=>file.path.includes("..")||file.path.startsWith("/")||file.path.startsWith("\\")||file.sizeBytes<0||file.sizeBytes>2_000_000))errors.push("unsafe_file");
  if((value.files?.length??0)>200)errors.push("too_many_files");
  return [...new Set(errors)];
}

export function assessSkillRisk(skill:HubSkillManifest):SkillRisk {
  const reasons:string[]=[];
  if(skill.execution.runtime==="local-sandbox")reasons.push("コード実行");
  if(skill.execution.network==="restricted")reasons.push("外部通信");
  if(skill.permissions.includes("read:local-files"))reasons.push("ローカルファイル読取");
  if(skill.permissions.includes("write:workspace"))reasons.push("作業領域への書込");
  for(const permission of skill.permissions)if(CONSEQUENTIAL.has(permission))reasons.push(permission);
  const high=reasons.some((item)=>["コード実行","外部通信","publish:post","send:message","spend:wallet"].includes(item));
  return {level:high?"high":reasons.length?"medium":"low",reasons,requiresExecutionApproval:skill.execution.runtime==="local-sandbox",requiresPerUseApproval:skill.permissions.some((item)=>CONSEQUENTIAL.has(item))};
}

export async function sha256Text(value:string):Promise<string> {
  const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((item)=>item.toString(16).padStart(2,"0")).join("");
}

export function skillMatches(skill:HubSkillManifest,input:{prompt:string;capabilities:string[];privacy:AiTask["privacy"];harnessCapabilities:HarnessCapability[]}):number {
  if(input.privacy==="local_only"&&skill.execution.privacy!=="local-only")return Number.NEGATIVE_INFINITY;
  const text=input.prompt.toLocaleLowerCase("ja");
  const trigger=skill.triggers.reduce((score,item)=>score+(text.includes(item.toLocaleLowerCase("ja"))?4:0),0);
  const capabilities=input.capabilities.reduce((score,item)=>score+(skill.capabilities.includes(item)?2:0),0);
  const localBonus=skill.execution.privacy==="local-only"?1:0;
  return trigger+capabilities+localBonus-assessSkillRisk(skill).reasons.length*.25;
}

export class SkillRegistry {
  private versions=new Map<string,HubSkillManifest[]>();
  install(skill:HubSkillManifest){const errors=validateSkillManifest(skill);if(errors.length)throw new Error(errors.join(","));const entries=this.versions.get(skill.id)??[];if(entries.some((item)=>item.version===skill.version&&item.source.contentHash===skill.source.contentHash))return;this.versions.set(skill.id,[...entries,structuredClone(skill)].slice(-10));}
  list(){return [...this.versions.values()].flatMap((items)=>items.at(-1)??[]);}
  history(id:string){return [...(this.versions.get(id)??[])];}
  rollback(id:string,version:string){const entries=this.versions.get(id)??[],index=entries.findIndex((item)=>item.version===version);if(index<0)throw new Error("skill_version_not_found");this.versions.set(id,[...entries.slice(0,index+1)]);return entries[index];}
  select(input:Parameters<typeof skillMatches>[1],limit=5){return this.list().map((skill)=>({skill,score:skillMatches(skill,input)})).filter((item)=>Number.isFinite(item.score)&&item.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);}
}

export function buildAutomaticSkillContext(prompt:string,privacy:AiTask["privacy"],skills:HubSkillManifest[]=OFFICIAL_SKILLS):string {
  const registry=new SkillRegistry();for(const skill of skills)registry.install(skill);
  const selected=registry.select({prompt,capabilities:[],privacy,harnessCapabilities:["chat","organization","artifacts"]},3);
  if(!selected.length)return "";
  return `選択済みスキル:\n${selected.map(({skill})=>`- ${skill.name}: ${skill.instructions??skill.description}\n  許可ツール: ${skill.tools.join("、")||"なし"}\n  検証: ${skill.verification.map((item)=>item.kind).join("、")}`).join("\n")}`;
}

export const OFFICIAL_SKILLS: HubSkillManifest[] = [
  {id:"hub.post-draft",name:"投稿下書き",version:"1.0.0",author:"JKamma",license:"Proprietary",source:{contentHash:"0".repeat(64)},description:"資料や会話からHub投稿の下書きを作成",triggers:["投稿","告知","下書き"],capabilities:["writing"],tools:["hub.search","hub.create-draft"],permissions:["read:public","create:draft"],execution:{runtime:"instructions",network:"off",privacy:"local-only",compatibleHarnesses:["hub.local-runner"]},verification:[{kind:"artifact"}],instructions:"目的、読者、根拠を確認し、公開せず下書きまで作成する。"},
  {id:"hub.code-review",name:"コードレビュー",version:"1.0.0",author:"JKamma",license:"Proprietary",source:{contentHash:"1".repeat(64)},description:"コードの不具合、安全性、テスト不足を確認",triggers:["レビュー","コード","バグ"],capabilities:["code","verification"],tools:["local.read","local.test"],permissions:["read:local-files"],execution:{runtime:"instructions",network:"off",privacy:"local-only",compatibleHarnesses:["hub.local-runner","hub.development"]},verification:[{kind:"response"}],instructions:"根拠となるファイル位置を示し、推測と確認済み事項を分離する。"}
];
