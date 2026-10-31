import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { requireCommunityGuideAccess, CommunityGuideAccessError } from "./community-guide-access";

export class CommunityGuideProposalError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 409) { super(message); }
}
const identifier = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
const optionalId = (value: unknown) => {
  if (value === undefined || value === null) return null;
  if (!identifier(value)) throw new CommunityGuideProposalError("ガイドの指定が正しくありません。",400);
  return value;
};
const text = (value: unknown, maximum: number) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new CommunityGuideProposalError("編集案の文字数を確認してください。",400);
  return value.trim();
};
export type GuideProposalInput = {
  pageId?: string | null; proposedDirectoryId?: string | null; title: string; proposedTitle: string; proposedBody: string; summary: string; requestId?: string; baseVersion?: number;
};
type Proposal = GuideProposalInput & {id: string; communityId: string; authorProfileId: string; status: string; baseVersion: number; createdAt: string; updatedAt: string};
const selection = `SELECT id,community_id communityId,page_id pageId,proposed_directory_id proposedDirectoryId,author_profile_id authorProfileId,
  title,proposed_title proposedTitle,proposed_body proposedBody,summary,status,base_version baseVersion,created_at createdAt,updated_at updatedAt,merged_at mergedAt,merged_by_profile_id mergedByProfileId
  FROM community_guide_proposals WHERE id=?`;
export async function canProposeCommunityGuide(database: D1Database, communityId: string, viewer: Profile | null) {
  return Boolean(viewer && await database.prepare("SELECT 1 FROM community_memberships WHERE community_id=? AND profile_id=? AND status='active'").bind(communityId,viewer.id).first());
}
export async function createCommunityGuideProposal(database: D1Database, actor: Profile, communityId: string, payload: unknown) {
  await requireCommunityGuideAccess(database,communityId,actor);
  if (!await canProposeCommunityGuide(database,communityId,actor)) throw new CommunityGuideProposalError("有効な参加者だけが編集案を作成できます。",403);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CommunityGuideProposalError("編集案の入力を確認してください。",400);
  const raw=payload as Record<string,unknown>,pageId=optionalId(raw.pageId),directoryId=optionalId(raw.proposedDirectoryId);
  const input={pageId,proposedDirectoryId:directoryId,title:text(raw.title,120),proposedTitle:text(raw.proposedTitle,120),proposedBody:text(raw.proposedBody,30000),summary:text(raw.summary,500)};
  const id=raw.requestId===undefined?crypto.randomUUID():raw.requestId;
  if(typeof id!=="string" || !/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(id))throw new CommunityGuideProposalError("操作IDが正しくありません。",400);
  if(raw.baseVersion!==undefined && (typeof raw.baseVersion!=="number" || !Number.isSafeInteger(raw.baseVersion) || raw.baseVersion<0))throw new CommunityGuideProposalError("元の版が正しくありません。",400);
  const existing=await database.prepare(selection).bind(id).first<Proposal>();
  const matches=(saved:Proposal)=>saved.communityId===communityId && saved.authorProfileId===actor.id
    && Object.entries(input).every(([key,value])=>saved[key as keyof Proposal]===value || key==="pageId" && value===null && saved.status==="merged" && saved.baseVersion===0)
    && (raw.baseVersion===undefined || saved.baseVersion===raw.baseVersion);
  if(existing){if(!matches(existing))throw new CommunityGuideProposalError("操作IDが別の編集案に使われています。",409);return {proposal:{...existing,reviews:[]},replayed:true};}
  const page=pageId?await database.prepare("SELECT version FROM community_guide_pages WHERE id=? AND community_id=?").bind(pageId,communityId).first<{version:number}>():null;
  if(pageId&&!page)throw new CommunityGuideAccessError("編集対象が見つかりません。",404);
  const baseVersion=Number(page?.version??0);
  if(raw.baseVersion!==undefined && raw.baseVersion!==baseVersion)throw new CommunityGuideProposalError("ガイドが更新されています。最新版を確認してから提案してください。",409);
  if(directoryId && !await database.prepare("SELECT id FROM community_guide_directories WHERE id=? AND community_id=?").bind(directoryId,communityId).first())throw new CommunityGuideAccessError("ガイドの分類が見つかりません。",404);
  const now=new Date().toISOString();
  await database.prepare(`INSERT INTO community_guide_proposals
    (id,community_id,page_id,proposed_directory_id,author_profile_id,title,proposed_title,proposed_body,summary,status,base_version,created_at,updated_at)
    SELECT ?,c.id,?,?,?,?,?,?,?,'open',?,?,? FROM communities c JOIN community_memberships m ON m.community_id=c.id
    WHERE c.id=? AND c.lifecycle_status='active' AND m.profile_id=? AND m.status='active'
      AND (? IS NULL OR EXISTS(SELECT 1 FROM community_guide_pages g WHERE g.id=? AND g.community_id=c.id AND g.version=?))
      AND (? IS NULL OR EXISTS(SELECT 1 FROM community_guide_directories d WHERE d.id=? AND d.community_id=c.id))
    ON CONFLICT(id) DO NOTHING`).bind(id,pageId,directoryId,actor.id,input.title,input.proposedTitle,input.proposedBody,input.summary,baseVersion,now,now,
      communityId,actor.id,pageId,pageId,baseVersion,directoryId,directoryId).run();
  const saved=await database.prepare(selection).bind(id).first<Proposal>();
  if(!saved || !matches(saved))throw new CommunityGuideProposalError("保存を確認できませんでした。参加状態と元の版を確認してください。",409);
  return {proposal:{...saved,reviews:[]},replayed:false};
}
export async function getCommunityGuideProposals(database: D1Database, communityId: string, viewer: Profile | null, offset=0) {
  await requireCommunityGuideAccess(database,communityId,viewer);
  if(!Number.isSafeInteger(offset)||offset<0)throw new CommunityGuideAccessError("ページ指定が正しくありません。",400);
  const rows=await database.prepare(`SELECT id,title,proposed_title proposedTitle,summary,status,page_id pageId,base_version baseVersion,updated_at updatedAt
    FROM community_guide_proposals WHERE community_id=? ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?`).bind(communityId,offset).all();
  return {proposals:rows.results.slice(0,20),page:{offset,hasMore:rows.results.length>20,nextOffset:rows.results.length>20?offset+20:null},canPropose:await canProposeCommunityGuide(database,communityId,viewer)};
}
export async function getCommunityGuideProposal(database: D1Database, communityId: string, proposalId: string, viewer: Profile | null) {
  await requireCommunityGuideAccess(database,communityId,viewer);
  if(!identifier(proposalId))throw new CommunityGuideAccessError("編集案の指定が正しくありません。",400);
  const proposal=await database.prepare(selection+" AND community_id=?").bind(proposalId,communityId).first<Proposal>();
  if(!proposal)throw new CommunityGuideAccessError("編集案が見つからないか、閲覧できません。",404);
  return {proposal,canPropose:await canProposeCommunityGuide(database,communityId,viewer)};
}
