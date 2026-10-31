import {getHubD1} from '@/lib/server/hub-d1';
import {hasSameOrigin} from '@/lib/server/hub-auth-route';
import {HubAuthenticationError,HubSuspendedError} from '@/lib/server/hub-session';
import {p2pActor,listP2PDevices,mutateP2PDevices,P2PDeviceError} from '@/lib/server/p2p-account-devices';

const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
function failed(error:unknown){
  if(error instanceof HubSuspendedError)return json({error:'このプロフィールでは接続できません。'},403);
  if(error instanceof HubAuthenticationError)return json({error:'同じHubプロフィールでログインしてください。'},401);
  if(error instanceof P2PDeviceError)return json({error:error.message},error.status);
  return json({error:'端末を確認できません。しばらくしてからお試しください。'},503);
}
export async function GET(request:Request){
  try{const db=getHubD1(),actor=await p2pActor(request,db);return json(await listP2PDevices(db,actor,new URL(request.url).searchParams.get('deviceId')??''));}catch(error){return failed(error);}
}
export async function POST(request:Request){
  if(!hasSameOrigin(request))return json({error:'この画面から操作できません。'},403);
  try{
    const db=getHubD1(),actor=await p2pActor(request,db),reader=request.body?.getReader();if(!reader)return json({error:'操作を確認できません。'},400);
    const chunks:Uint8Array[]=[];let length=0;
    try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return json({error:'要求が大きすぎます。'},413);}chunks.push(value);}}finally{reader.releaseLock();}
    const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
    let input;try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({error:'操作を確認できません。'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'操作を確認できません。'},400);
    return json(await mutateP2PDevices(db,actor,input));
  }catch(error){return failed(error);}
}
