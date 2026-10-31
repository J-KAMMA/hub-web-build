import 'server-only';
import {getHubD1} from './hub-d1';
import {hasSameOrigin} from './hub-auth-route';
import {HubAuthenticationError,HubSuspendedError} from './hub-session';
import {DesktopHubAuthenticationError} from './desktop-hub-auth';
import {P2PDeviceError} from './p2p-account-devices';
import {publicPeerActor,publicPeerControl} from './public-post-peers';
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
export async function publicPeerRoute(request:Request,native=false){
  if((!native||request.headers.has('origin'))&&!hasSameOrigin(request))return json({error:'invalid_origin'},403);
  try{
    const db=getHubD1(),actor=await publicPeerActor(request,db,native),reader=request.body?.getReader();
    if(!reader)return json({error:'invalid_input'},400);
    let text='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
    try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>128000){await reader.cancel();return json({error:'request_too_large'},413);}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}catch{return json({error:'invalid_input'},400);}finally{reader.releaseLock();}
    let input;try{input=JSON.parse(text);}catch{return json({error:'invalid_input'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input))return json({error:'invalid_input'},400);
    return json(await publicPeerControl(db,actor,input));
  }catch(error){
    if(error instanceof HubAuthenticationError||error instanceof DesktopHubAuthenticationError)return json({error:'account_required'},401);
    if(error instanceof HubSuspendedError)return json({error:'account_required'},403);
    if(error instanceof P2PDeviceError)return json({error:error.message},error.status);
    return json({error:'peer_service_unavailable'},503);
  }
}
