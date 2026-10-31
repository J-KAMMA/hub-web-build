'use client';
import {createPeerCatalog} from './hub-peer-catalog.mjs';
import {readHubCatalog,readHubCatalogDocument,readHubPostManifest,parseHubCatalog} from './hub-network-client';
let runtime:ReturnType<typeof createPeerCatalog>|null=null;
export function browserPostPeers(create=false){
  if(typeof window==='undefined'||typeof RTCPeerConnection==='undefined')return null;
  if(runtime)return runtime;
  const prefix=`hub.public-post-peers.v1.${encodeURIComponent(location.origin)}.`;
  if(!create){try{if(!Object.keys(localStorage).some(key=>key.startsWith(prefix)&&localStorage.getItem(key)==='on'))return null;}catch{return null;}}
  runtime=createPeerCatalog({base:location.origin,storage:localStorage,readManifest:readHubPostManifest,readCatalog:(origin,signal)=>readHubCatalogDocument(origin,'post',signal),
    control:async input=>{
      const response=await fetch('/api/network/peers',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(10000)});
      if(!response.ok)throw Error(response.status===401||response.status===403?'account_required':'peer_service_unavailable');
      return response.json();
    }});
  void runtime.refresh();
  const recover=()=>{if(runtime?.state.status==='reconnecting')void runtime.refresh();};
  const consent=(event:StorageEvent)=>{if(event.storageArea===localStorage&&(!event.key||event.key.startsWith(prefix)))void runtime?.syncConsent();};
  window.addEventListener('focus',recover);window.addEventListener('online',recover);window.addEventListener('storage',consent);
  window.addEventListener('pagehide',()=>{window.removeEventListener('focus',recover);window.removeEventListener('online',recover);window.removeEventListener('storage',consent);const old=runtime;runtime=null;void old?.dispose();},{once:true});
  return runtime;
}
export async function readPeerPostCatalog(origin:string,signal?:AbortSignal){
  const peer=browserPostPeers(true);return peer?parseHubCatalog(await peer.read(origin,signal),origin,'post'):readHubCatalog(origin,'post',signal);
}
