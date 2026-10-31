import "server-only";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";

export class CommunityGuideAccessError extends Error {
  constructor(message: string, readonly status: 400 | 404) { super(message); }
}
export function readCommunityGuideOffset(params: URLSearchParams) {
  const values=params.getAll("offset");if(!values.length)return 0;
  const offset=Number(values[0]);
  if(values.length!==1 || !/^(0|[1-9]\d*)$/.test(values[0]) || !Number.isSafeInteger(offset))throw new CommunityGuideAccessError("ページ指定が正しくありません。",400);
  return offset;
}
export function readCommunityGuideDirectory(params: URLSearchParams) {
  const values=params.getAll("directory");
  if(!values.length)return null;
  if(values.length!==1 || !/^[A-Za-z0-9_-]{1,80}$/.test(values[0]))throw new CommunityGuideAccessError("分類の指定が正しくありません。",400);
  return values[0];
}
async function guideDirectories(database: D1Database, communityId: string) {
  return (await database.prepare(`SELECT d.id,d.name,p.id parentId FROM community_guide_directories d
    LEFT JOIN community_guide_directories p ON p.id=d.parent_directory_id AND p.community_id=d.community_id
    WHERE d.community_id=? ORDER BY d.position,d.name,d.id`).bind(communityId).all()).results;
}
export async function requireCommunityGuideAccess(database: D1Database, communityId: string, viewer: Profile | null) {
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(communityId)) throw new CommunityGuideAccessError("コミュニティの指定が正しくありません。", 400);
  const community = await database.prepare(`SELECT id FROM communities WHERE id=? AND lifecycle_status='active'
    AND (visibility IN ('public','approval') OR EXISTS (SELECT 1 FROM community_memberships m
      WHERE m.community_id=communities.id AND m.profile_id=? AND m.status IN ('active','muted'))) LIMIT 1`)
    .bind(communityId, viewer?.id ?? null).first();
  if (!community) throw new CommunityGuideAccessError("ガイドが見つからないか、閲覧できません。", 404);
}
export async function getCommunityGuideCatalog(database: D1Database, communityId: string, viewer: Profile | null, offset=0, directoryId: string | null=null) {
  await requireCommunityGuideAccess(database,communityId,viewer);
  if(!Number.isSafeInteger(offset)||offset<0)throw new CommunityGuideAccessError("ページ指定が正しくありません。",400);
  if(directoryId!==null && !/^[A-Za-z0-9_-]{1,80}$/.test(directoryId))throw new CommunityGuideAccessError("分類の指定が正しくありません。",400);
  const directories=await guideDirectories(database,communityId);
  if(directoryId!==null && !directories.some(item=>item.id===directoryId))throw new CommunityGuideAccessError("分類が見つからないか、閲覧できません。",404);
  const result=await database.prepare(`SELECT g.id,g.title,g.version,g.updated_at updatedAt,d.id directoryId,d.name directoryName FROM community_guide_pages g
    LEFT JOIN community_guide_directories d ON d.id=g.directory_id AND d.community_id=g.community_id
    WHERE g.community_id=? AND (? IS NULL OR g.directory_id=?) ORDER BY g.created_at,g.id LIMIT 21 OFFSET ?`).bind(communityId,directoryId,directoryId,offset).all();
  return {directories,directoryId,pages:result.results.slice(0,20),page:{offset,hasMore:result.results.length>20,nextOffset:result.results.length>20?offset+20:null}};
}
export async function getCommunityGuidePage(database: D1Database, communityId: string, pageId: string, viewer: Profile | null) {
  await requireCommunityGuideAccess(database,communityId,viewer);
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(pageId))throw new CommunityGuideAccessError("ガイドの指定が正しくありません。",400);
  const page=await database.prepare(`SELECT g.id,g.title,g.body,g.version,g.updated_at updatedAt,d.id directoryId,d.name directoryName FROM community_guide_pages g
    LEFT JOIN community_guide_directories d ON d.id=g.directory_id AND d.community_id=g.community_id WHERE g.id=? AND g.community_id=?`).bind(pageId,communityId).first();
  if(!page)throw new CommunityGuideAccessError("ガイドが見つからないか、閲覧できません。",404);
  return {page,directories:await guideDirectories(database,communityId)};
}
export async function getCommunityGuideRevisions(database: D1Database, communityId: string, pageId: string, viewer: Profile | null, metadataOnly=false, offset=0) {
  await requireCommunityGuideAccess(database, communityId, viewer);
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(pageId)) throw new CommunityGuideAccessError("ガイドの指定が正しくありません。", 400);
  const page = await database.prepare("SELECT id FROM community_guide_pages WHERE id=? AND community_id=?").bind(pageId,communityId).first();
  if (!page) throw new CommunityGuideAccessError("ガイドが見つからないか、閲覧できません。", 404);
  if(!Number.isSafeInteger(offset)||offset<0)throw new CommunityGuideAccessError("ページ指定が正しくありません。",400);
  const revisions = await database.prepare(`SELECT r.id,r.revision_no revisionNo,r.title,${metadataOnly?"":"r.body,"}r.created_at createdAt,p.display_name editorName
    FROM community_guide_revisions r LEFT JOIN profiles p ON p.id=r.editor_profile_id WHERE r.community_id=? AND r.page_id=?
    ORDER BY r.revision_no DESC LIMIT ? OFFSET ?`).bind(communityId,pageId,metadataOnly?21:100,metadataOnly?offset:0).all();
  return metadataOnly?{revisions:revisions.results.slice(0,20),page:{offset,hasMore:revisions.results.length>20,nextOffset:revisions.results.length>20?offset+20:null}}:{revisions:revisions.results};
}
export async function getCommunityGuideRevision(database: D1Database, communityId: string, pageId: string, revisionId: string, viewer: Profile | null) {
  await requireCommunityGuideAccess(database,communityId,viewer);
  if(![pageId,revisionId].every(id=>/^[A-Za-z0-9_-]{1,80}$/.test(id)))throw new CommunityGuideAccessError("改訂の指定が正しくありません。",400);
  const revision=await database.prepare(`SELECT r.id,r.revision_no revisionNo,r.title,r.body,r.created_at createdAt,p.display_name editorName
    FROM community_guide_revisions r LEFT JOIN profiles p ON p.id=r.editor_profile_id
    WHERE r.community_id=? AND r.page_id=? AND r.id=?`).bind(communityId,pageId,revisionId).first();
  if(!revision)throw new CommunityGuideAccessError("改訂が見つからないか、閲覧できません。",404);
  return {revision};
}
