import {DurableObject} from 'cloudflare:workers';
import {pairingOrigins} from './pairing-origins.mjs';

const TTL=600000,CLOCK_SKEW=60000;
const reject=status=>new Response('Pairing unavailable',{status,headers:{'Cache-Control':'no-store'}});
async function readFrame(request){
  const reader=request.body?.getReader();if(!reader)return null;
  const chunks=[];let length=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>90028){await reader.cancel();return null;}chunks.push(value);}}
  finally{reader.releaseLock();}
  if(length<29)return null;const frame=new Uint8Array(length);let offset=0;
  for(const chunk of chunks){frame.set(chunk,offset);offset+=chunk.byteLength;}return frame.buffer;
}
export default {
  async fetch(request,env){
    const url=new URL(request.url),match=/^\/pair\/([a-f0-9]{32})\/(host|guest)$/.exec(url.pathname);
    if(!match)return reject(404);
    const origin=request.headers.get('Origin')||(request.headers.get('Sec-Fetch-Site')==='same-origin'?url.origin:null);
    let allowed;try{allowed=pairingOrigins(url.origin,env.HUB_PAIRING_ALLOWED_ORIGINS);}catch{return reject(503);}
    if(!allowed.includes(origin))return reject(403);
    const http=url.searchParams.get('transport')==='http';
    const cors=response=>{const result=new Response(response.body,response);result.headers.set('Access-Control-Allow-Origin',origin);result.headers.set('Vary','Origin');result.headers.set('Cache-Control','no-store');return result;};
    if(http&&request.method==='OPTIONS')return cors(new Response(null,{status:204,headers:{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}}));
    if(http?!['GET','POST'].includes(request.method):request.method!=='GET'||request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return http?cors(reject(405)):reject(426);
    const expires=Number(url.searchParams.get('expires'));
    if(!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+TTL+CLOCK_SKEW)return http?cors(reject(400)):reject(400);
    // Anonymous preview: a shared-IP limit is deliberately generous to mobile networks.
    if(!http||request.method==='POST'&&url.searchParams.get('action')==='start'){
      const {success}=await env.PAIRING_LIMIT.limit({key:request.headers.get('CF-Connecting-IP')||'local'});
      if(!success)return http?cors(reject(429)):reject(429);
    }
    const response=await env.PAIRS.getByName(match[1]).fetch(request);
    return http?cors(response):response;
  }
};

export class PairingRoom extends DurableObject {
  fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
    if(new URL(request.url).searchParams.get('transport')==='http')return this.http(request);
    const url=new URL(request.url),role=url.pathname.split('/').at(-1),expires=Number(url.searchParams.get('expires'));
    const room=await this.ctx.storage.get('room');
    // Accept small client clock differences without extending server-side room lifetime.
    const deadline=room?.deadline??Math.min(expires,Date.now()+TTL);
    if(role==='host'){
      if(room)return reject(409);
      await this.ctx.storage.put('room',{expires,deadline,joined:false});
      await this.ctx.storage.setAlarm(deadline);
    }else{
      if(!room||room.joined||room.expires!==expires||deadline<=Date.now()||!this.ctx.getWebSockets('host').some(ws=>ws.readyState===1))return reject(409);
      await this.ctx.storage.put('room',{expires,deadline,joined:true});
    }
    const [client,server]=Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server,[role]);server.serializeAttachment({role,expires:deadline});
    if(role==='guest')this.ctx.getWebSockets('host')[0].send('joined');
    return new Response(null,{status:101,webSocket:client});
  });}
  async http(request){
    const url=new URL(request.url),role=url.pathname.split('/').at(-1),expires=Number(url.searchParams.get('expires')),action=url.searchParams.get('action');
    let room=await this.ctx.storage.get('room');
    if(request.method==='POST'&&action==='start'){
      if(request.body){const reader=request.body.getReader();try{const {done}=await reader.read();if(!done){await reader.cancel();return reject(400);}}finally{reader.releaseLock();}}
      if(role==='host'){
        if(room)return reject(409);
        room={transport:'http',expires,deadline:Math.min(expires,Date.now()+TTL),joined:false,polls:0};
        await this.ctx.storage.put('room',room);await this.ctx.storage.setAlarm(room.deadline);
      }else{
        if(!room||room.transport!=='http'||room.expires!==expires||room.deadline<=Date.now())return reject(410);
        if(room.joined)return reject(409);
        await this.ctx.storage.put('room',{...room,joined:true});
      }
      return new Response(null,{status:204});
    }
    if(!room||room.transport!=='http'||room.expires!==expires||room.deadline<=Date.now())return reject(410);
    if(request.method==='GET'){
      if(room.polls>=1300)return reject(429);
      await this.ctx.storage.put('room',{...room,polls:room.polls+1});
      const frame=await this.ctx.storage.get(role==='host'?'answer':'offer');
      return frame?new Response(frame,{headers:{'Content-Type':'application/octet-stream'}}):new Response(null,{status:role==='host'&&room.joined?202:204});
    }
    if(action!=='signal'||!room.joined)return reject(409);
    const key=role==='host'?'offer':'answer';
    if(await this.ctx.storage.get(key))return reject(409);
    const frame=await readFrame(request);if(!frame)return reject(413);
    await this.ctx.storage.put(key,frame);return new Response(null,{status:204});
  }
  webSocketMessage(ws,message){return this.ctx.blockConcurrencyWhile(async()=>{
    const state=ws.deserializeAttachment();
    if(Date.now()>=state.expires||typeof message==='string'||message.byteLength<29||message.byteLength>90028||await this.ctx.storage.get(`sent-${state.role}`)){ws.close(1008,'Pairing ended');this.finish(1008);return;}
    const other=this.ctx.getWebSockets(state.role==='host'?'guest':'host').find(peer=>peer.readyState===1);
    if(!other){this.finish(1008);return;}
    await this.ctx.storage.put(`sent-${state.role}`,true);other.send(message);
  });}
  finish(code=1000){for(const ws of this.ctx.getWebSockets())if(ws.readyState===1)ws.close(code,'Pairing ended');}
  webSocketClose(ws,code){ws.close(code===1005?1000:code,'Pairing ended');this.finish();}
  webSocketError(){this.finish(1011);}
  async alarm(){this.finish();await this.ctx.storage.deleteAll();}
}
