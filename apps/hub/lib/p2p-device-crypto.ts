import {pairingLink,readPairing,type PairingTicket} from './p2p-pairing.mjs';

export type DevicePublicKey={kty:'EC';crv:'P-256';x:string;y:string};
export async function deviceKeys(){
  const keys=await crypto.subtle.generateKey({name:'ECDH',namedCurve:'P-256'},false,['deriveKey']);
  return {privateKey:keys.privateKey,publicKey:await publicDeviceKey(await crypto.subtle.exportKey('jwk',keys.publicKey))};
}
export async function publicDeviceKey(value:unknown):Promise<DevicePublicKey>{
  if(!value||typeof value!=='object')throw Error('端末の鍵を確認できません。');
  const key=value as JsonWebKey;
  if(key.kty!=='EC'||key.crv!=='P-256'||key.d||!key.x||!key.y||!(/^[A-Za-z0-9_-]{43}$/).test(key.x)||!(/^[A-Za-z0-9_-]{43}$/).test(key.y))throw Error('端末の鍵を確認できません。');
  await crypto.subtle.importKey('jwk',key,{name:'ECDH',namedCurve:'P-256'},false,[]);
  return {kty:'EC',crv:'P-256',x:key.x,y:key.y};
}
async function sharedKey(privateKey:CryptoKey,publicKey:DevicePublicKey){
  const other=await crypto.subtle.importKey('jwk',await publicDeviceKey(publicKey),{name:'ECDH',namedCurve:'P-256'},false,[]);
  return crypto.subtle.deriveKey({name:'ECDH',public:other},privateKey,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
const aad=(id:string,from:string,to:string)=>new TextEncoder().encode(`hub-device-invite-v1:${id}:${from}:${to}`);
export async function sealDeviceInvitation(privateKey:CryptoKey,publicKey:DevicePublicKey,id:string,from:string,to:string,ticket:PairingTicket){
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(id,from,to)},await sharedKey(privateKey,publicKey),new TextEncoder().encode(new URL(pairingLink('https://unused.invalid',ticket)).hash));
  const frame=new Uint8Array(12+bytes.byteLength);frame.set(iv);frame.set(new Uint8Array(bytes),12);
  return btoa(String.fromCharCode(...frame));
}
export async function openDeviceInvitation(privateKey:CryptoKey,publicKey:DevicePublicKey,id:string,from:string,to:string,ciphertext:string){
  if(ciphertext.length>1024)throw Error('招待を確認できません。');
  const frame=Uint8Array.from(atob(ciphertext),character=>character.charCodeAt(0));
  const bytes=await crypto.subtle.decrypt({name:'AES-GCM',iv:frame.slice(0,12),additionalData:aad(id,from,to)},await sharedKey(privateKey,publicKey),frame.slice(12));
  return readPairing(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
