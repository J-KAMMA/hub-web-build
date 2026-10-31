import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile, requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {forkResearchProject, researchForkInfo,researchForkOrigin} from '@/lib/server/research-fork';
import {clientResearchJson, clientResearchFailure, readClientResearchInput} from '@/lib/server/client-research-route';
type Context = {params:Promise<{projectId:string}>};
export async function GET(request:Request, context:Context) {
  try {
    const db=getHubD1(), viewer=await getOptionalDesktopHubProfile(request,db);
    return clientResearchJson(await researchForkInfo(db,(await context.params).projectId,researchForkOrigin(request),viewer?.id));
  } catch(error) {return clientResearchFailure(error);}
}
export async function POST(request:Request, context:Context) {
  try {
    const db=getHubD1(), viewer=await requireDesktopHubProfile(request,db);
    return clientResearchJson(await forkResearchProject(db,(await context.params).projectId,viewer.id,researchForkOrigin(request),await readClientResearchInput(request,4096)),201);
  } catch(error) {return clientResearchFailure(error);}
}
