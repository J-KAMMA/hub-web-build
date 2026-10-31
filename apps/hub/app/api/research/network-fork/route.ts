import {getHubD1} from '@/lib/server/hub-d1';
import {requireHubSessionProfile,HubAuthenticationError} from '@/lib/server/hub-session';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {prepareConnectedResearchFork,forkConnectedResearchProject} from '@/lib/server/research-network-fork';
import {clientResearchJson,clientResearchFailure,readClientResearchInput} from '@/lib/server/client-research-route';

export async function GET(request:Request){
  try{const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),params=new URL(request.url).searchParams;return clientResearchJson(await prepareConnectedResearchFork(db,viewer.id,params.get('origin'),params.get('projectId')??''));}
  catch(error){return error instanceof HubAuthenticationError?clientResearchJson({error:'ログインが必要です。'},401):clientResearchFailure(error);}
}
export async function POST(request:Request){
  if(!hasSameOrigin(request))return clientResearchJson({error:'不正なリクエストです。'},403);
  try{const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),input=await readClientResearchInput(request,4096);return clientResearchJson(await forkConnectedResearchProject(db,viewer.id,input.origin,typeof input.projectId==='string'?input.projectId:'',input),201);}
  catch(error){return error instanceof HubAuthenticationError?clientResearchJson({error:'ログインが必要です。'},401):clientResearchFailure(error);}
}
