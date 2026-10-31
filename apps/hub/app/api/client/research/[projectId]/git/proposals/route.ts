import {getHubD1} from '@/lib/server/hub-d1';
import {requireDesktopHubProfile} from '@/lib/server/desktop-hub-auth';
import {listGitProposals,readGitProposal,mutateGitProposal} from '@/lib/server/research-git-proposals';
import {ResearchWorkspaceError} from '@/lib/server/research-workspace';
import {clientResearchJson as json,clientResearchFailure as failure} from '@/lib/server/client-research-route';
type Context={params:Promise<{projectId:string}>};
function query(request:Request){const q=new URL(request.url).searchParams;if([...q.keys()].some(key=>!['proposal','cursor'].includes(key))||q.getAll('proposal').length>1||q.getAll('cursor').length>1||q.has('proposal')&&q.has('cursor'))throw new ResearchWorkspaceError('指定が不正です。');return q;}
export async function GET(request:Request,{params}:Context){try{const q=query(request),db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId}=await params,id=q.get('proposal');return json(id===null?await listGitProposals(db,projectId,viewer.id,q.get('cursor')??undefined):await readGitProposal(db,projectId,viewer.id,id));}catch(error){return failure(error);}}
export async function POST(request:Request,{params}:Context){
 try{if(query(request).size)throw new ResearchWorkspaceError('保存には追加の指定を使えません。');const db=getHubD1(),viewer=await requireDesktopHubProfile(request,db),{projectId}=await params,reader=request.body?.getReader();if(!reader)throw new ResearchWorkspaceError('入力がありません。');
  const chunks:Uint8Array[]=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new ResearchWorkspaceError('入力が大きすぎます。',413);}chunks.push(value);}}finally{reader.releaseLock();}
  let input:unknown;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await new Blob(chunks as BlobPart[]).arrayBuffer()));}catch{throw new ResearchWorkspaceError('入力が不正です。');}
  if(!input||typeof input!=='object'||Array.isArray(input))throw new ResearchWorkspaceError('入力が不正です。');return json(await mutateGitProposal(db,projectId,viewer.id,input as Record<string,unknown>));
 }catch(error){return failure(error);}
}
