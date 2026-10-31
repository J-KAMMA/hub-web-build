import {getHubD1} from '@/lib/server/hub-d1';
import {readResearchGitHistory,readResearchGitCommit} from '@/lib/server/research-git-browse';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
export async function GET(request:Request,{params}:{params:Promise<{projectId:string}>}) {
  const headers={'Cache-Control':'no-store'};
  try {
    const query=new URL(request.url).searchParams;
    if([...query.keys()].some(key=>!['commit','base'].includes(key))||query.getAll('commit').length>1||query.getAll('base').length>1||(query.has('base')&&!query.has('commit')))throw new ResearchWorkspaceError('指定が不正です。');
    const {projectId}=await params,db=getHubD1(),oid=query.get('commit'),base=query.get('base');
    return Response.json(oid===null?await readResearchGitHistory(db,projectId):base===null?await readResearchGitCommit(db,projectId,oid):await readResearchGitCommit(db,projectId,oid,base),{headers});
  }catch(error){return Response.json({error:error instanceof ResearchWorkspaceError?error.message:'Git履歴を読み込めませんでした。'},{status:error instanceof ResearchWorkspaceError?error.status:503,headers});}
}
