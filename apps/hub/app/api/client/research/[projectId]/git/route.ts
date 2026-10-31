import {getHubD1} from '@/lib/server/hub-d1';
import {getOptionalDesktopHubProfile,requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {researchGitInfo,mutateResearchGit} from '@/lib/server/research-git';
import {gitManagementJson as json,gitManagementFailure as failure,gitManagementQuery,gitManagementBody} from '@/lib/server/research-git-management-route';
type Context={params:Promise<{projectId:string}>};
export async function GET(request:Request,{params}:Context){try{gitManagementQuery(request);const db=getHubD1(),viewer=await getOptionalDesktopHubProfile(request,db);return json(await researchGitInfo(db,(await params).projectId,viewer?.id));}catch(error){return failure(error);}}
export async function POST(request:Request,{params}:Context){try{gitManagementQuery(request);const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),body=await gitManagementBody(request);return json(await mutateResearchGit(db,(await params).projectId,viewer.id,body));}catch(error){return failure(error);}}
