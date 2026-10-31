import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {publicDeviceKey} from '@/lib/p2p-device-crypto';
import {HUB_SESSION_COOKIE,readCookie,hashHubSessionSecret,requireHubSessionProfile,HubAuthenticationError} from './hub-session';

export class P2PDeviceError extends Error{constructor(message:string,public status=400){super(message);}}
type Actor={profileId:string;sessionId:string};
type Device={id:string;label:string;publicKey:string};
const LIVE=60000;
const active=`s.revoked_at IS NULL AND s.expires_at>?`;
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
export async function p2pActor(request:Request,db:D1Database):Promise<Actor>{
  const secret=readCookie(request.headers.get('cookie'),HUB_SESSION_COOKIE);
  if(!secret||secret.length<32||secret.length>512)throw new HubAuthenticationError();
  const profile=await requireHubSessionProfile(request,db);
  const session=await db.prepare(`SELECT id FROM sessions WHERE secret_hash=? AND profile_id=? AND revoked_at IS NULL AND expires_at>?`).bind(await hashHubSessionSecret(secret),profile.id,new Date().toISOString()).first<{id:string}>();
  if(!session)throw new HubAuthenticationError();
  return {profileId:profile.id,sessionId:session.id};
}
async function ownDevice(db:D1Database,actor:Actor,id:unknown){
  if(!uuid(id))throw new P2PDeviceError('端末を選び直してください。');
  const found=await db.prepare('SELECT id FROM p2p_devices WHERE id=? AND profile_id=? AND session_id=? AND last_seen_at>?').bind(id,actor.profileId,actor.sessionId,Date.now()-LIVE).first();
  if(!found)throw new P2PDeviceError('端末の待ち受けが終了しました。画面を開き直してください。',409);
  return id;
}
export async function listP2PDevices(db:D1Database,actor:Actor,deviceId:string){
  await ownDevice(db,actor,deviceId);
  const now=Date.now(),iso=new Date(now).toISOString();
  const devices=await db.prepare(`SELECT d.id,d.label,d.public_key publicKey FROM p2p_devices d JOIN sessions s ON s.id=d.session_id WHERE d.profile_id=? AND d.last_seen_at>? AND ${active} ORDER BY d.label LIMIT 16`).bind(actor.profileId,now-LIVE,iso).all<Device>();
  const invitations=await db.prepare(`SELECT i.id,i.from_device fromDevice,i.ciphertext,d.label,d.public_key publicKey FROM p2p_device_invitations i JOIN p2p_devices d ON d.id=i.from_device JOIN sessions s ON s.id=d.session_id WHERE i.profile_id=? AND i.to_device=? AND i.state='pending' AND i.expires_at>? AND d.last_seen_at>? AND ${active} ORDER BY i.expires_at LIMIT 8`).bind(actor.profileId,deviceId,now,now-LIVE,iso).all<Device&{fromDevice:string;ciphertext:string}>();
  return {devices:devices.results.map(d=>({...d,publicKey:JSON.parse(d.publicKey)})),invitations:invitations.results.map(i=>({...i,publicKey:JSON.parse(i.publicKey)}))};
}
export async function mutateP2PDevices(db:D1Database,actor:Actor,input:Record<string,unknown>){
  const now=Date.now(),iso=new Date(now).toISOString();
  if(input.action==='register'){
    const label=typeof input.label==='string'?input.label.trim():'';
    if(!label||label.length>40||/[\x00-\x1f]/.test(label))throw new P2PDeviceError('端末名は1〜40文字にしてください。');
    let key;try{key=JSON.stringify(await publicDeviceKey(input.publicKey));}catch{throw new P2PDeviceError('端末の鍵を確認できません。');}
    const id=crypto.randomUUID();
    await db.batch([
      db.prepare('DELETE FROM p2p_device_invitations WHERE expires_at<=?').bind(now),
      db.prepare('DELETE FROM p2p_devices WHERE last_seen_at<=?').bind(now-LIVE*2),
    ]);
    const result=await db.prepare(`INSERT INTO p2p_devices(id,profile_id,session_id,label,public_key,last_seen_at) SELECT ?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM p2p_devices WHERE profile_id=? AND last_seen_at>?)<16`).bind(id,actor.profileId,actor.sessionId,label,key,now,actor.profileId,now-LIVE).run();
    if(!result.meta.changes)throw new P2PDeviceError('接続可能な端末が多すぎます。使っていない画面を閉じてください。',429);
    return {id};
  }
  const deviceId=await ownDevice(db,actor,input.deviceId);
  if(input.action==='heartbeat'){
    await db.prepare('UPDATE p2p_devices SET last_seen_at=? WHERE id=? AND session_id=? AND profile_id=?').bind(now,deviceId,actor.sessionId,actor.profileId).run();return {ok:true};
  }
  if(input.action==='remove'){
    await db.prepare('DELETE FROM p2p_devices WHERE id=? AND session_id=? AND profile_id=?').bind(deviceId,actor.sessionId,actor.profileId).run();return {ok:true};
  }
  if(input.action==='invite'){
    if(!uuid(input.id)||!uuid(input.toDevice)||input.toDevice===deviceId||typeof input.ciphertext!=='string'||input.ciphertext.length<40||input.ciphertext.length>1024||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.ciphertext))throw new P2PDeviceError('接続の招待を確認できません。');
    const result=await db.prepare(`INSERT OR IGNORE INTO p2p_device_invitations(id,profile_id,from_device,to_device,ciphertext,expires_at) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM p2p_devices d JOIN sessions s ON s.id=d.session_id WHERE d.id=? AND d.profile_id=? AND d.last_seen_at>? AND ${active}) AND (SELECT COUNT(*) FROM p2p_device_invitations WHERE to_device=? AND state='pending' AND expires_at>?)<8`).bind(input.id,actor.profileId,deviceId,input.toDevice,input.ciphertext,now+600000,input.toDevice,actor.profileId,now-LIVE,iso,input.toDevice,now).run();
    if(!result.meta.changes)throw new P2PDeviceError('相手の端末が待ち受け中か確認してください。',409);return {ok:true};
  }
  if(input.action==='accept'||input.action==='decline'){
    if(!uuid(input.id))throw new P2PDeviceError('接続の招待を選び直してください。');
    const result=await db.prepare(`UPDATE p2p_device_invitations SET state=? WHERE id=? AND profile_id=? AND to_device=? AND state='pending' AND expires_at>? AND EXISTS(SELECT 1 FROM p2p_devices d JOIN sessions s ON s.id=d.session_id WHERE d.id=p2p_device_invitations.from_device AND d.last_seen_at>? AND ${active})`).bind(input.action==='accept'?'accepted':'declined',input.id,actor.profileId,deviceId,now,now-LIVE,iso).run();
    if(!result.meta.changes)throw new P2PDeviceError('接続の招待は終了しています。',409);return {ok:true};
  }
  throw new P2PDeviceError('操作を確認できません。');
}
