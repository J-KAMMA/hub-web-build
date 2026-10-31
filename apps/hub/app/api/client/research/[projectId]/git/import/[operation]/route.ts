import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {researchGitImportOperation,runResearchGitImport} from '@/lib/server/research-git-import';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
import {clientResearchJson as json,clientResearchFailure as failure} from '@/lib/server/client-research-route';
export async function POST(request:Request,{params}:{params:Promise<{projectId:string;operation:string}>}){
 try{
  if(new URL(request.url).search)throw new ResearchWorkspaceError('指定が不正です。');
  const {projectId,operation}=await params;researchGitImportOperation(operation);
  const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db);
  return json(await runResearchGitImport(db,projectId,viewer.id,operation,request));
 }catch(error){return failure(error);}
}
