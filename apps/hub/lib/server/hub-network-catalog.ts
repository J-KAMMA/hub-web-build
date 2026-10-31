import 'server-only';
import type {D1Database} from '@cloudflare/workers-types';
import {listD1TimelinePosts} from './d1-social-posts';
import {toClientPost} from '@/lib/client-feed-shape';
import {listResearchProjects} from './d1-research';
import {hubCatalogResearchQuery} from '@/lib/hub-network-client';
import {musicNetworkItems,type MusicNetworkMedia} from './music-network-catalog';
import {videoNetworkItems,type VideoNetworkMedia} from './video-network-catalog';

export const NETWORK_KINDS = ['post','research','music','video'] as const;
export type NetworkKind = typeof NETWORK_KINDS[number];
export type NetworkItem = {id:string;title:string;summary:string;path:string;updatedAt:string;media?:MusicNetworkMedia|VideoNetworkMedia};

/** Public discovery only: never resolve cookies, desktop assertions or dev viewers. */
export async function hubNetworkCatalog(db:D1Database,kind:NetworkKind,query='',options:{musicOrigin?:string|null}={}) {
  const normalized=kind==='research'?hubCatalogResearchQuery(query):'';
  if(!NETWORK_KINDS.includes(kind)||kind!=='research'&&query!=='')throw Error('invalid_query');
  let items:NetworkItem[];
  if(kind==='post') {
    const posts=await listD1TimelinePosts(db,null,undefined,30,0,undefined,null,'latest');
    items=posts.map(toClientPost).map(p=>({id:p.id,title:p.authorName,summary:p.body,path:`/v2/posts/${encodeURIComponent(p.id)}`,updatedAt:p.createdAt}));
  } else if(kind==='music') {
    items=await musicNetworkItems(db,options.musicOrigin??null);
  } else if(kind==='video') {
    items=await videoNetworkItems(db);
  } else {
    items=(await listResearchProjects(db,null,{query:normalized,limit:30,excludeWithdrawn:true,publicOnly:true}))
      .map(p=>({id:p.id,title:p.title,summary:p.description,path:`/v2/research/${encodeURIComponent(p.id)}`,updatedAt:p.updatedAt}));
  }
  return {protocol:'hub.catalog.v1',kind,...(kind==='research'?{query:normalized}:{}),items:items.filter(item=>/^[A-Za-z0-9_-]{1,128}$/.test(item.id)).map(item=>({...item,title:item.title.slice(0,240),summary:item.summary.slice(0,5000)}))};
}
