import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {normalizeHubOrigin} from '@/lib/hub-network-client';

export async function listHubSources(db:D1Database, profileId:string) {
  const rows = await db.prepare('SELECT origin FROM hub_network_sources WHERE profile_id=? ORDER BY created_at, origin LIMIT 8').bind(profileId).all<{origin:string}>();
  return rows.results.map(row => row.origin);
}
export async function changeHubSource(db:D1Database, profileId:string, raw:unknown, remove:boolean) {
  const origin = normalizeHubOrigin(raw);
  if(remove) await db.prepare('DELETE FROM hub_network_sources WHERE profile_id=? AND origin=?').bind(profileId, origin).run();
  else {
    await db.prepare(`INSERT OR IGNORE INTO hub_network_sources(profile_id,origin,created_at)
      SELECT ?,?,? WHERE (SELECT COUNT(*) FROM hub_network_sources WHERE profile_id=?)<8`)
      .bind(profileId, origin, new Date().toISOString(), profileId).run();
    const saved = await db.prepare('SELECT origin FROM hub_network_sources WHERE profile_id=? AND origin=?').bind(profileId, origin).first();
    if(!saved) return null;
  }
  return listHubSources(db, profileId);
}

export const networkSourcesJson = (body:unknown, status=200) => Response.json(body, {status, headers:{'Cache-Control':'private, no-store', Vary:'Cookie, Authorization'}});

/** Browser and native callers resolve their own authentication before reaching here. */
export async function updateHubSources(request:Request, db:D1Database, profileId:string) {
  const reader=request.body?.getReader(); if(!reader) return networkSourcesJson({error:'入力を確認してください。'},400);
  let body=''; const decoder=new TextDecoder(); let size=0;
  try {while(true) {const {done,value}=await reader.read(); if(done) break; size+=value.byteLength;
    if(size>2048) {await reader.cancel();return networkSourcesJson({error:'入力が長すぎます。'},413);} body+=decoder.decode(value,{stream:true});
  } body+=decoder.decode();} finally {reader.releaseLock();}
  let input, origin:string;
  try {input=JSON.parse(body); origin=normalizeHubOrigin(input.origin);} catch {return networkSourcesJson({error:'HubのURLを確認してください。'},400);}
  if(!['add','remove'].includes(input.action) || origin===new URL(request.url).origin) return networkSourcesJson({error:'別のHubのURLを指定してください。'},400);
  const sources=await changeHubSource(db,profileId,origin,input.action==='remove');
  return sources ? networkSourcesJson({sources}) : networkSourcesJson({error:'追加するHubは8件までです。'},409);
}
