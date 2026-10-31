import {getHubD1} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {getOptionalHubSessionProfile,requireHubSessionProfile} from '@/lib/server/hub-session';
import {researchGitInfo,mutateResearchGit} from '@/lib/server/research-git';
import {gitManagementJson as json,gitManagementFailure as failure,gitManagementQuery,gitManagementBody} from '@/lib/server/research-git-management-route';
type Context={params:Promise<{projectId:string}>};
export async function GET(request:Request,{params}:Context){try{gitManagementQuery(request);const db=getHubD1(),viewer=await getOptionalHubSessionProfile(request,db);return json(await researchGitInfo(db,(await params).projectId,viewer?.id));}catch(e){return failure(e);}}
export async function POST(request:Request,{params}:Context){if(!hasSameOrigin(request))return json({error:'不正なリクエストです。'},403);try{gitManagementQuery(request);const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),body=await gitManagementBody(request);return json(await mutateResearchGit(db,(await params).projectId,viewer.id,body));}catch(e){return failure(e);}}
