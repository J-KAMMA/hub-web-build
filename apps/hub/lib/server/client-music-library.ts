import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import { MUSIC_WORKS, canonicalizeMusicWork, type MusicWork } from '@/lib/music-catalog';
import { listD1MusicWorksByIds } from './d1-music';
import { assertAvailableMusicItemIds, InvalidMusicPlaylistError, isPublicMusicTrackPlaylistKey } from './d1-music-playlists';
import { isRedirectResponse } from "@/lib/redirect-guard";

export const validMusicKey = (id: unknown): id is string => typeof id === 'string'
  && (/^[A-Za-z0-9_-]{1,128}$/.test(id) || isPublicMusicTrackPlaylistKey(id));

export async function favoriteMusicIds(db: D1Database, profile: string): Promise<string[]> {
  const rows = await db.prepare('SELECT music_item_id FROM music_favorites WHERE owner_profile_id = ? ORDER BY created_at DESC, music_item_id DESC')
    .bind(profile).all<{music_item_id:string}>();
  return rows.results.map(row => row.music_item_id);
}

export async function changeMusicFavorite(db: D1Database, profile: string, id: string, active: boolean) {
  if (active) {
    await assertAvailableMusicItemIds(db, [id]);
    await db.prepare(`INSERT OR IGNORE INTO music_favorites (owner_profile_id,music_item_id,created_at)
      SELECT ?,?,? WHERE (SELECT count(*) FROM music_favorites WHERE owner_profile_id=?) < 200`)
      .bind(profile,id,new Date().toISOString(),profile).run();
    const favoriteIds = await favoriteMusicIds(db,profile);
    if (!favoriteIds.includes(id)) throw new InvalidMusicPlaylistError('お気に入りは200件までです。');
    return {favoriteIds};
  }
  await db.prepare('DELETE FROM music_favorites WHERE owner_profile_id=? AND music_item_id=?').bind(profile,id).run();
  return {favoriteIds:await favoriteMusicIds(db,profile)};
}

async function publicTracks(origin: string, ids: string[]): Promise<MusicWork[]> {
  if (!ids.length) return [];
  const url = new URL('/music/api/tracks',origin);
  const requested=[...new Set(ids.map(id=>id.slice(6).toLowerCase()))];
  url.searchParams.set('ids',requested.join(','));
  const response = await fetch(url,{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(8_000),headers:{accept:'application/json'}});
  if (!response.ok||isRedirectResponse(response)) throw Error('music_metadata_unavailable');
  const reader=response.body?.getReader(); if (!reader) throw Error('music_metadata_unavailable');
  const chunks:Uint8Array[]=[]; let size=0;
  try {
    for (;;) {const {done,value}=await reader.read(); if(done)break; size+=value.length; if(size>1024*1024){await reader.cancel();throw Error('music_metadata_unavailable');} chunks.push(value);}
  } finally {reader.releaseLock();}
  const bytes=new Uint8Array(size); let start=0; for(const chunk of chunks){bytes.set(chunk,start);start+=chunk.length;}
  const result=JSON.parse(new TextDecoder().decode(bytes));
  if (!result || !Array.isArray(result.tracks) || result.tracks.length>requested.length || result.hasMore!==false
      || !Number.isSafeInteger(result.total) || result.total!==result.tracks.length) throw Error('music_metadata_invalid');
  const seen=new Set<string>();
  return result.tracks.flatMap((track: Record<string,unknown>)=> {
    if (!track || typeof track.id!=='string' || !requested.includes(track.id) || seen.has(track.id)
        || typeof track.title!=='string' || typeof track.artist!=='string' || typeof track.description!=='string'
        || typeof track.publishedAt!=='string' || !Number.isFinite(Date.parse(track.publishedAt))) throw Error('music_metadata_invalid');
    seen.add(track.id);
    return ids.filter(id=>id.toLowerCase()===`music:${track.id}`).map(id=>canonicalizeMusicWork({id,title:track.title as string,artist:track.artist as string,description:track.description as string,
      album:typeof track.album==='string'?track.album:undefined,genre:'Hub Music',year:new Date(track.publishedAt as string).getUTCFullYear(),
      accent:'',symbol:'',source:'community',createdAt:track.publishedAt as string,services:[],
      artworkUrl:typeof track.artworkUrl==='string' && track.artworkUrl===`/music/api/tracks/${track.id}/artwork`?track.artworkUrl:undefined}));
  });
}

export async function readMusicWorksByIds(db:D1Database,ids:string[],origin:string):Promise<MusicWork[]> {
  const tracks=ids.filter(isPublicMusicTrackPlaylistKey), catalog=ids.filter(id=>!isPublicMusicTrackPlaylistKey(id));
  const [community, original]=await Promise.all([listD1MusicWorksByIds(db,catalog),publicTracks(origin,tracks)]);
  const byId=new Map([...MUSIC_WORKS,...community,...original].map(work=>[work.id,work]));
  return ids.flatMap(id=>byId.has(id)?[canonicalizeMusicWork(byId.get(id)!)]:[]);
}

export async function musicFavoritePage(db:D1Database,profile:string,offset:number,origin:string) {
  const favoriteIds=await favoriteMusicIds(db,profile), page=favoriteIds.slice(offset,offset+50);
  const works=await readMusicWorksByIds(db,page,origin), available=new Set(works.map(work=>work.id));
  return {favoriteIds,works,unavailableIds:page.filter(id=>!available.has(id)),total:favoriteIds.length,
    nextOffset:offset+50<favoriteIds.length?offset+50:null};
}
