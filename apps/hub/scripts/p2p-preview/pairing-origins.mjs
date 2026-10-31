export function pairingOrigins(origin,configured){
  const defaults=[origin,'http://localhost:3020','http://127.0.0.1:3020','https://jkamma-hub-staging.jammakamma0.workers.dev'];
  if(configured===undefined)return defaults;
  if(typeof configured!=='string'||configured.length>8192)throw Error('Invalid pairing origins configuration');
  const values=JSON.parse(configured);
  if(!Array.isArray(values)||values.length>32)throw Error('Invalid pairing origins configuration');
  if(!values.every(value=>{
    if(typeof value!=='string'||value.length>512)return false;
    const url=new URL(value);
    return url.origin===value&&!url.username&&!url.password&&(url.protocol==='https:'||(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)));
  }))throw Error('Invalid pairing origin');
  return [...new Set([origin,...values])];
}
