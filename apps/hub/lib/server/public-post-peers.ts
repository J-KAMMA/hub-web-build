import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {publicDeviceKey} from '@/lib/p2p-device-crypto';
import {p2pActor,P2PDeviceError} from './p2p-account-devices';
import {requireDesktopHubProfile} from './desktop-hub-auth';
import {hashHubSessionSecret} from './hub-session';

export type PeerActor={profileId:string;ownerHash:string;sessionId:string|null};
export async function publicPeerActor(request:Request,db:D1Database,native=false):Promise<PeerActor>{
  if(!native){const actor=await p2pActor(request,db);return {...actor,ownerHash:await hashHubSessionSecret(`web:${actor.sessionId}`)};}
  const profile=await requireDesktopHubProfile(request,db);
  // This exact assertion has already been verified, consumed, and mapped by requireDesktopHubProfile.
  const claims=JSON.parse(Buffer.from(request.headers.get('authorization')!.split('.')[1],'base64url').toString('utf8'));
  return {profileId:profile.id,ownerHash:await hashHubSessionSecret(`desktop:${claims.sub}:${claims.device_id}`),sessionId:null};
}
const LIVE=30000;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
// Browser peers disappear immediately when their login session is revoked. Native leases require fresh assertions.
const live=`p.last_seen_at>? AND (p.session_id IS NULL OR EXISTS(SELECT 1 FROM sessions s WHERE s.id=p.session_id AND s.profile_id=p.profile_id AND s.revoked_at IS NULL AND s.expires_at>?))`;
export async function publicPeerControl(db:D1Database,actor:PeerActor,input:Record<string,unknown>){
  const now=Date.now(),iso=new Date(now).toISOString();
  if(input.action==='identity')return {profileId:actor.profileId};
  if(input.action==='register'){
    if(input.scope!=='public-posts-v1'||input.consent!==true)throw new P2PDeviceError('公開投稿の共有を許可してください。');
    const label=typeof input.label==='string'?input.label.trim():'';
    if(!label||label.length>40||/[\x00-\x1f]/.test(label))throw new P2PDeviceError('端末名を確認してください。');
    let key;try{key=JSON.stringify(await publicDeviceKey(input.publicKey));}catch{throw new P2PDeviceError('公開鍵を確認してください。');}
    const id=crypto.randomUUID();
    await db.batch([db.prepare('DELETE FROM public_post_peer_signals WHERE expires_at<=?').bind(now),db.prepare('DELETE FROM public_post_peers WHERE last_seen_at<=?').bind(now-LIVE)]);
    const saved=await db.prepare(`INSERT INTO public_post_peers(id,profile_id,owner_hash,session_id,label,public_key,last_seen_at) SELECT ?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM public_post_peers WHERE profile_id=? AND last_seen_at>?)<8`).bind(id,actor.profileId,actor.ownerHash,actor.sessionId,label,key,now,actor.profileId,now-LIVE).run();
    if(!saved.meta.changes)throw new P2PDeviceError('共有中の端末が多すぎます。',429);
    return {id};
  }
  if(!uuid(input.deviceId))throw new P2PDeviceError('端末を確認してください。');
  const own=await db.prepare(`SELECT p.id FROM public_post_peers p WHERE p.id=? AND p.profile_id=? AND p.owner_hash=? AND ${live}`).bind(input.deviceId,actor.profileId,actor.ownerHash,now-LIVE,iso).first();
  if(!own)throw new P2PDeviceError('共有の有効期限が切れました。',409);
  if(input.action==='remove'){
    await db.prepare('DELETE FROM public_post_peers WHERE id=? AND owner_hash=?').bind(input.deviceId,actor.ownerHash).run();return {ok:true};
  }
  if(input.action==='poll'){
    await db.prepare('DELETE FROM public_post_peer_signals WHERE expires_at<=?').bind(now).run();
    await db.prepare('UPDATE public_post_peers SET last_seen_at=? WHERE id=? AND owner_hash=?').bind(now,input.deviceId,actor.ownerHash).run();
    const peers=await db.prepare(`SELECT p.id,p.label,p.public_key publicKey FROM public_post_peers p WHERE p.profile_id=? AND ${live} ORDER BY p.id LIMIT 8`).bind(actor.profileId,now-LIVE,iso).all<{id:string;label:string;publicKey:string}>();
    const signals=await db.prepare(`SELECT m.id,m.from_peer fromPeer,m.ciphertext FROM public_post_peer_signals m JOIN public_post_peers p ON p.id=m.from_peer WHERE m.to_peer=? AND m.expires_at>? AND p.profile_id=? AND ${live} ORDER BY m.expires_at,m.id LIMIT 16`).bind(input.deviceId,now,actor.profileId,now-LIVE,iso).all();
    return {peers:peers.results.map(p=>({...p,publicKey:JSON.parse(p.publicKey)})),signals:signals.results,leaseMs:LIVE};
  }
  if(input.action==='ack'){
    if(!Array.isArray(input.ids)||input.ids.length>16||!input.ids.every(uuid))throw new P2PDeviceError('接続情報を確認してください。');
    if(input.ids.length)await db.batch(input.ids.map(id=>db.prepare('DELETE FROM public_post_peer_signals WHERE id=? AND to_peer=?').bind(id,input.deviceId)));return {ok:true};
  }
  if(input.action==='signal'){
    if(!uuid(input.id)||!uuid(input.toPeer)||input.toPeer===input.deviceId||typeof input.ciphertext!=='string'||input.ciphertext.length<40||input.ciphertext.length>100000||!/^[A-Za-z0-9+/]+={0,2}$/.test(input.ciphertext))throw new P2PDeviceError('接続情報を確認してください。');
    const saved=await db.prepare(`INSERT OR IGNORE INTO public_post_peer_signals(id,from_peer,to_peer,ciphertext,expires_at) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM public_post_peers p WHERE p.id=? AND p.profile_id=? AND ${live}) AND (SELECT COUNT(*) FROM public_post_peer_signals WHERE to_peer=? AND expires_at>?)<16`).bind(input.id,input.deviceId,input.toPeer,input.ciphertext,now+20000,input.toPeer,actor.profileId,now-LIVE,iso,input.toPeer,now).run();
    if(!saved.meta.changes)throw new P2PDeviceError('相手の端末に接続できません。',409);return {ok:true};
  }
  throw new P2PDeviceError('操作を確認してください。');
}
