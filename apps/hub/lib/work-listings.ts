export type WorkListingKind = "service" | "request" | "job";
export type WorkListingStatus = "draft" | "published" | "paused" | "rejected";
export type WorkStyle = "remote" | "hybrid" | "onsite";
export const WORK_CATEGORIES=["development","design","writing","marketing","operations","consulting","education","creative","other"] as const;
export type WorkCategory=typeof WORK_CATEGORIES[number];
export type WorkListing = {
  id:string; ownerProfileId:string; ownerName:string; ownerHandle:string; kind:WorkListingKind;
  title:string; summary:string; category:string; location:string; compensationLabel:string; budgetAmount:number|null;
  skills:string[]; workStyle:WorkStyle; engagement:string; workload:string; deadline:string|null;
  status:WorkListingStatus; rejectionReason?:string|null; publishedAt:string|null; createdAt:string; updatedAt:string; ownedByViewer:boolean; acceptingApplications?:boolean; savedByViewer?:boolean; qualityScore?:number; qualityHints?:string[];
  ownerTrust?:{memberSince:string;responseRate:number|null;completedCount:number|null};
};
export type WorkListingInput = Pick<WorkListing,"kind"|"title"|"summary"|"category"|"location"|"compensationLabel"|"budgetAmount"|"skills"|"workStyle"|"engagement"|"workload"|"deadline">;
export type WorkInquiry={id:string;listingId:string;listingTitle:string;senderProfileId:string;senderName:string;senderHandle:string;message:string;createdAt:string;updatedAt:string};
export type WorkApplicationStatus="new"|"reviewing"|"accepted"|"declined"|"withdrawn";
export type WorkSearchFilters={query?:string;kind?:WorkListingKind;category?:string;workStyle?:WorkStyle;skills?:string[]};

export function workListingText(value:unknown,max:number){return typeof value==="string"?value.trim().replace(/\s+/g," ").slice(0,max):"";}
export function workListingKind(value:unknown):WorkListingKind|null{return value==="service"||value==="request"||value==="job"?value:null;}
export function workListingStyle(value:unknown):WorkStyle|null{return value==="remote"||value==="hybrid"||value==="onsite"?value:null;}
export function parseWorkListingInput(body:Record<string,unknown>):WorkListingInput|null {
  const kind=workListingKind(body.kind),title=workListingText(body.title,120),summary=workListingText(body.summary,3000),category=workListingText(body.category,60);
  const compensationLabel=workListingText(body.compensationLabel,100),budgetAmount=body.budgetAmount===null||body.budgetAmount===""?null:Number(body.budgetAmount);
  const skills=normalizeContentTags(body.skills);
  const workStyle=body.workStyle==null||body.workStyle===""?"remote":workListingStyle(body.workStyle);
  const deadline=body.deadline==null||body.deadline===""?null:workListingText(body.deadline,10);
  if(!kind||title.length<5||summary.length<30||!category||!compensationLabel||budgetAmount!==null&&(!Number.isSafeInteger(budgetAmount)||budgetAmount<1)||workStyle===null||deadline&&!/^\d{4}-\d{2}-\d{2}$/.test(deadline))return null;
  return {kind,title,summary,category,location:workListingText(body.location,100),compensationLabel,budgetAmount,skills,workStyle,engagement:workListingText(body.engagement,80),workload:workListingText(body.workload,80),deadline};
}
export function parseWorkSearchFilters(value:unknown):WorkSearchFilters|null{if(!value||typeof value!=="object"||Array.isArray(value))return null;const raw=value as Record<string,unknown>,result:WorkSearchFilters={};if(raw.query!=null)result.query=workListingText(raw.query,100);if(raw.kind!=null){const kind=workListingKind(raw.kind);if(!kind)return null;result.kind=kind;}if(raw.category!=null)result.category=workListingText(raw.category,60);if(raw.workStyle!=null){const style=workListingStyle(raw.workStyle);if(!style)return null;result.workStyle=style;}if(raw.skills!=null){if(!Array.isArray(raw.skills))return null;result.skills=[...new Set(raw.skills.map(v=>workListingText(v,40)).filter(Boolean))].slice(0,10);}return result;}
export function workListingQuality(input:WorkListingInput){const hints:string[]=[];if(input.summary.length<120)hints.push("Add more detail about the work and expected outcome.");if(!input.skills.length)hints.push("Add at least one relevant skill.");if(!input.deadline)hints.push("Add an application deadline.");if(!input.engagement)hints.push("Specify the engagement type.");if(!input.workload)hints.push("Describe the expected workload.");if(input.budgetAmount===null)hints.push("Add a numeric budget where possible.");return{qualityScore:Math.max(0,100-hints.length*15),qualityHints:hints};}
const prohibited=[/闇バイト/u,/口座.{0,8}(売買|譲渡)/u,/違法.{0,8}(仕事|求人)/u,/詐欺/u];
export function inspectWorkListing(input:WorkListingInput){const text=`${input.title} ${input.summary}`;return prohibited.some((rule)=>rule.test(text))?"掲載できない表現が含まれています。内容を見直してください。":null;}
import { normalizeContentTags } from "@/lib/content-tags";
