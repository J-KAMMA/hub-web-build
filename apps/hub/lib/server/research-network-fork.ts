import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {normalizeHubOrigin} from '@/lib/hub-network-client';
import {parseResearchForkPackage,researchForkPackagePath} from '@/lib/research-fork-package';
import {copyResearchFork,researchForkTarget} from './research-fork';
import {ResearchWorkspaceError} from './research-workspace';
import {readPublicResearchFork} from './research-fork-transport';

type Reader=typeof readPublicResearchFork;
const deny=(message:string,status=400):never=>{throw new ResearchWorkspaceError(message,status);};
function source(raw:unknown,id:string){try{const origin=normalizeHubOrigin(raw);researchForkPackagePath(id);if(origin!==raw||!origin.startsWith('https://'))return deny('接続先の公開HTTPS Hubを選んでください。');return origin;}catch{return deny('接続先Hubの指定が不正です。');}}
async function connected(db:D1Database,viewer:string,origin:string){
  const row=await db.prepare("SELECT 1 FROM hub_network_sources n JOIN profiles p ON p.id=n.profile_id WHERE n.profile_id=? AND n.origin=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=p.id AND m.status='suspended')").bind(viewer,origin).first();
  if(!row)return deny('このHubへの接続を確認できません。設定で接続先を確認してください。',403);
}
async function read(db:D1Database,viewer:string,origin:string,id:string,reader:Reader){
  await connected(db,viewer,origin);
  const raw=await reader(origin,id);
  let value;
  try{value=await parseResearchForkPackage(raw,origin,id);}catch{return deny('接続先Hubの公開版を確認できませんでした。',409);}
  await connected(db,viewer,origin);return value;
}
export async function prepareConnectedResearchFork(db:D1Database,viewer:string,raw:unknown,id:string,reader:Reader=readPublicResearchFork){
  const origin=source(raw,id),value=await read(db,viewer,origin,id,reader);
  return {source:null,preview:{projectId:id,href:value.href,title:value.project.title,license:value.project.license,snapshotHash:value.snapshotHash,documentCount:value.documents.length}};
}
export async function forkConnectedResearchProject(db:D1Database,viewer:string,raw:unknown,id:string,input:Record<string,unknown>,reader:Reader=readPublicResearchFork){
  const origin=source(raw,id),target=await researchForkTarget(db,id,viewer,origin,input);if(target.saved)return target.saved;
  const value=await read(db,viewer,origin,id,reader);
  if(value.snapshotHash!==input.snapshotHash)return deny('確認後に接続先の公開版が変わりました。内容を再確認してください。',409);
  const guard="EXISTS(SELECT 1 FROM hub_network_sources n JOIN profiles p ON p.id=n.profile_id WHERE n.profile_id=? AND n.origin=? AND NOT EXISTS(SELECT 1 FROM profile_moderation_status m WHERE m.profile_id=p.id AND m.status='suspended'))";
  return copyResearchFork(db,id,viewer,origin,input,{project:{title:value.project.title,description:value.project.description,defaultLicense:value.project.license},documents:value.documents,snapshotHash:value.snapshotHash},guard,[viewer,origin]);
}
