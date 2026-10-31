import {getHubD1} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {requireHubSessionProfile,HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {listGitProposals,readGitProposal,mutateGitProposal} from '@/lib/server/research-git-proposals';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
type Context={params:Promise<{projectId:string}>};
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const failure=(error:unknown)=>json({error:error instanceof ResearchWorkspaceError?error.message:error instanceof HubAuthenticationError?'ログインしてください。':'Gitの変更提案を利用できません。'},error instanceof ResearchWorkspaceError?error.status:error instanceof HubSuspendedError?403:error instanceof HubAuthenticationError?401:503);
export async function GET(request:Request,{params}:Context){
  try{const query=new URL(request.url).searchParams;if([...query.keys()].some(key=>!['proposal','cursor'].includes(key))||query.getAll('proposal').length>1||query.getAll('cursor').length>1||query.has('proposal')&&query.has('cursor'))return json({error:'指定が不正です。'},400);
    const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId}=await params,id=query.get('proposal');return json(id===null?await listGitProposals(db,projectId,viewer.id,query.get('cursor')??undefined):await readGitProposal(db,projectId,viewer.id,id));
  }catch(error){return failure(error);}
}
export async function POST(request:Request,{params}:Context){
  if(!hasSameOrigin(request))return json({error:'不正なリクエストです。'},403);
  try{const db=getHubD1(),viewer=await requireHubSessionProfile(request,db),{projectId}=await params,reader=request.body?.getReader();if(!reader)return json({error:'入力がありません。'},400);
    const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return json({error:'入力が大きすぎます。'},413);}chunks.push(value);}}finally{reader.releaseLock();}
    let input:unknown;try{const bytes=await new Blob(chunks as BlobPart[]).arrayBuffer();input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({error:'入力が不正です。'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'入力が不正です。'},400);return json(await mutateGitProposal(db,projectId,viewer.id,input as Record<string,unknown>));
  }catch(error){return failure(error);}
}
