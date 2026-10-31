import {getHubD1} from '@/lib/server/hub-d1';
import {exportResearchFork,researchForkOrigin} from '@/lib/server/research-fork';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';

export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':'*'};
/** Anonymous public snapshot only: sessions never expand what another Hub can read. */
export async function GET(request:Request,context:{params:Promise<{projectId:string}>}) {
  try {
    const value=await exportResearchFork(getHubD1(),(await context.params).projectId,researchForkOrigin(request));
    return Response.json(value,{headers:{...headers,'Content-Disposition':`attachment; filename="${value.project.id}.hub-research.json"`}});
  }catch(error){
    return Response.json({error:error instanceof ResearchWorkspaceError?error.message:'公開プロジェクトを取得できませんでした。'},{status:error instanceof ResearchWorkspaceError?error.status:503,headers});
  }
}
