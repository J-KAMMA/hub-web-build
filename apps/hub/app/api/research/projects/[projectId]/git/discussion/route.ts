import {getHubD1,HubD1UnavailableError} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {getOptionalHubSessionProfile,requireHubSessionProfile,HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {prepareResearchGitDiscussion,createResearchGitDiscussion} from '@/lib/server/research-git-discussion';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
import {HubPostRateLimitError} from '@/lib/server/d1-rate-limit';
import {gitCommitOid} from '@/lib/research-git-browse';

type Context={params:Promise<{projectId:string}>};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
function failure(error:unknown){
  if(error instanceof HubPostRateLimitError)return Response.json({error:error.message},{status:429,headers:{'Cache-Control':'no-store','Retry-After':String(error.retryAfterSeconds)}});
  const status=error instanceof ResearchWorkspaceError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:error instanceof HubD1UnavailableError?503:500;
  return json({error:error instanceof ResearchWorkspaceError?error.message:status===401?'ログインしてください。':'Gitの検証スレッドを処理できませんでした。'},status);
}
export async function GET(request:Request,{params}:Context){
  try{
    const query=new URL(request.url).searchParams,oid=query.get('commit');
    if([...query.keys()].some(key=>key!=='commit')||query.getAll('commit').length!==1||!gitCommitOid(oid))return json({error:'完全なコミットIDを一つ指定してください。'},400);
    const {projectId}=await params,db=getHubD1(),viewer=await getOptionalHubSessionProfile(request,db);
    return json(await prepareResearchGitDiscussion(db,projectId,oid,viewer?.id));
  }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){
  if(!hasSameOrigin(request))return json({error:'不正なリクエストです。'},403);
  try{
    const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId}=await params;
    const reader=request.body?.getReader();if(!reader)return json({error:'入力がありません。'},400);
    const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();return json({error:'入力が大きすぎます。'},413);}chunks.push(value);}}finally{reader.releaseLock();}
    let input:unknown;
    try{input=JSON.parse(await new Blob(chunks as BlobPart[]).text());}catch{return json({error:'入力が不正です。'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'入力が不正です。'},400);
    return json(await createResearchGitDiscussion(db,projectId,viewer,input as Record<string,unknown>));
  }catch(error){return failure(error);}
}
