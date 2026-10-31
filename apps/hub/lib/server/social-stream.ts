import 'server-only';
import type { D1Database } from '@cloudflare/workers-types';
import { getHubD1 } from './hub-d1';
import { getOptionalHubSessionProfile, requireHubSessionProfile, HUB_SESSION_COOKIE, HubAuthenticationError } from './hub-session';
import { getOptionalDesktopHubProfile, DesktopHubAuthenticationError } from './desktop-hub-auth';
import { listD1TimelinePosts } from './d1-social-posts';
import { toClientPost } from '@/lib/client-feed-shape';
import { THREAD_TYPES, type ThreadType } from '@/lib/thread-type';
import { socialStreamTimeSql } from './social-stream-time';
import { SocialStreamInputError, decodeStreamCursor, mergeStreamPages, parseStreamQuery, streamId, streamKinds, streamOrigin, streamTimestamp,
  type SocialStreamCommunityPost, type SocialStreamKind, type StreamCandidate, type StreamContext, type StreamLanePage, type StreamPosition } from '@/lib/social-stream';

type Context = StreamContext & { limit: number };
function authorScope(column: string, body: string) {
  return `( ${column} IS NULL OR NOT EXISTS(SELECT 1 FROM profile_moderation_status moderation WHERE moderation.profile_id=${column} AND moderation.status='suspended'))
    AND NOT EXISTS(SELECT 1 FROM thread_user_controls control WHERE (control.owner_profile_id=?1 AND control.target_profile_id=${column} AND (control.muted=1 OR control.blocked=1)) OR (control.owner_profile_id=${column} AND control.target_profile_id=?1 AND control.blocked=1))
    AND NOT EXISTS(SELECT 1 FROM profile_muted_terms term WHERE term.profile_id=?1 AND instr(lower(${body}),lower(term.term))>0)`;
}
function seek(kind: 'thread' | 'community', after: StreamPosition | null) {
  const column = kind === 'thread' ? 't.id' : 'm.id', time = socialStreamTimeSql(kind);
  return after ? `AND (${time}<?2 OR (${time}=?2 AND ${column} COLLATE BINARY<?3))` : '';
}
function checkedPosition(createdAt: string, id: string): StreamPosition { streamTimestamp(createdAt); if (!streamId(id)) throw Error('social_stream_unavailable'); return { createdAt, id }; }
function count(value: number) { const number=Number(value); if (!Number.isSafeInteger(number) || number < 0) throw Error('social_stream_unavailable'); return number; }
async function posts(db: D1Database, context: Context, after: StreamPosition | null): Promise<StreamLanePage> {
  const candidates: StreamCandidate[] = []; let scanned=after, hasMore=true;
  // Only fully filtered raw pages advance without a displayed post; visible unconsumed
  // candidates remain behind the returned lane boundary, never skipped by scan tail.
  for(let round=0; round<4 && candidates.length<context.limit+1 && hasMore; round++) {
    const take=context.limit+1-candidates.length, scan={count:0,lastCreatedAt:null as string|null,lastId:null as string|null};
    const rows=await listD1TimelinePosts(db,context.viewerId,undefined,take,0,undefined,scanned,context.scope,scan,'all',true);
    for(const row of rows) { if(!['account','anonymous','guest'].includes(row.identityMode))throw Error('social_stream_unavailable');const position=checkedPosition(row.createdAt,row.id), createdAt=streamTimestamp(row.createdAt),account=row.identityMode==='account'; candidates.push({item:{kind:'post',id:row.id,createdAt,origin:context.origin,payload:{...toClientPost({...row,createdAt,authorProfileId:account?row.authorProfileId:null,handle:account?row.handle:undefined,avatarUrl:account?row.avatarUrl:undefined}),identityMode:row.identityMode,replyToPostId:row.replyToPostId??null}},position}); }
    hasMore=scan.count===take;
    const next=scan.lastCreatedAt && scan.lastId ? checkedPosition(scan.lastCreatedAt,scan.lastId) : null;
    if (hasMore && (!next || next.id===scanned?.id && next.createdAt===scanned.createdAt)) throw Error('social_stream_unavailable');
    if(next)scanned=next;
  }
  return {candidates,scanned,hasMore};
}
async function threads(db:D1Database,context:Context,after:StreamPosition|null):Promise<StreamLanePage> {
  const result=await db.prepare(`SELECT t.id,t.title,b.board_key,t.created_at,t.updated_at,t.status,COALESCE(t.thread_format,t.thread_type,'chat') AS thread_type,
    (SELECT count(*) FROM thread_posts p WHERE p.thread_id=t.id) AS post_count FROM threads t JOIN boards b ON b.id=t.board_id
    WHERE t.status IN ('open','closed') AND t.moderation_status<>'frozen' AND t.merged_into_thread_id IS NULL
      AND ${authorScope('t.created_by_profile_id','t.title')}
      ${context.scope==='following' ? "AND EXISTS(SELECT 1 FROM thread_tracking tracking WHERE tracking.thread_id=t.id AND tracking.profile_id=?1 AND tracking.following=1)" : ''}
      ${seek('thread',after)} ORDER BY ${socialStreamTimeSql('thread')} DESC,t.id COLLATE BINARY DESC LIMIT ?4`)
    .bind(context.viewerId??'',after?streamTimestamp(after.createdAt):null,after?.id??null,context.limit+1).all<{id:string;title:string;board_key:string;created_at:string;updated_at:string;status:'open'|'closed';thread_type:ThreadType;post_count:number}>();
  const candidates=result.results.map(row=>{if(!THREAD_TYPES.includes(row.thread_type))throw Error('social_stream_unavailable');return {position:checkedPosition(row.created_at,row.id),item:{kind:'thread' as const,id:row.id,createdAt:streamTimestamp(row.created_at),origin:context.origin,payload:{id:row.id,title:row.title,boardKey:row.board_key,postCount:count(row.post_count),threadType:row.thread_type,status:row.status,updatedAt:streamTimestamp(row.updated_at)}}};});
  return {candidates,scanned:candidates.at(-1)?.position??after,hasMore:result.results.length===context.limit+1};
}
async function communities(db:D1Database,context:Context,after:StreamPosition|null):Promise<StreamLanePage> {
  const result=await db.prepare(`SELECT m.id,community.id AS community_id,community.name AS community_name,c.id AS channel_id,c.name AS channel_name,
    m.body,m.created_at,p.display_name AS author_name,p.handle AS author_handle,m.kind,
    (SELECT count(*) FROM community_channel_messages reply WHERE reply.reply_to_message_id=m.id AND reply.channel_id=m.channel_id) AS reply_count,
    (SELECT count(*) FROM reactions reaction WHERE reaction.target_type='community_message' AND reaction.target_id=m.id AND reaction.kind='like') AS like_count
    FROM community_channel_messages m JOIN community_channels c ON c.id=m.channel_id JOIN communities community ON community.id=c.community_id JOIN profiles p ON p.id=m.author_profile_id
    WHERE community.visibility='public' AND community.lifecycle_status='active' AND c.archived_at IS NULL AND NOT EXISTS(SELECT 1 FROM content_access_gates cag WHERE cag.target_type='channel' AND cag.target_id=c.id) AND m.reply_to_message_id IS NULL
      AND NOT EXISTS(SELECT 1 FROM community_channel_permissions permission WHERE permission.channel_id=c.id AND permission.can_view=0)
      AND NOT EXISTS(SELECT 1 FROM community_member_custom_roles member_role JOIN community_channel_permissions permission ON permission.role_id=member_role.role_id WHERE member_role.community_id=community.id AND member_role.profile_id=?1 AND permission.channel_id=c.id AND permission.can_view=0)
      AND ${authorScope('m.author_profile_id','m.body')}
      ${context.scope==='following' ? "AND EXISTS(SELECT 1 FROM community_memberships membership WHERE membership.community_id=community.id AND membership.profile_id=?1 AND membership.status IN ('active','muted'))" : ''}
      ${seek('community',after)} ORDER BY ${socialStreamTimeSql('community')} DESC,m.id COLLATE BINARY DESC LIMIT ?4`)
    .bind(context.viewerId??'',after?streamTimestamp(after.createdAt):null,after?.id??null,context.limit+1).all<{id:string;community_id:string;community_name:string;channel_id:string;channel_name:string;body:string;created_at:string;author_name:string;author_handle:string|null;kind:SocialStreamCommunityPost['kind'];reply_count:number;like_count:number}>();
  const candidates=result.results.map(row=>{if(!['chat','guide','question','party'].includes(row.kind))throw Error('social_stream_unavailable');const createdAt=streamTimestamp(row.created_at);return {position:checkedPosition(row.created_at,row.id),item:{kind:'community_post' as const,id:row.id,createdAt,origin:context.origin,payload:{id:row.id,communityId:row.community_id,communityName:row.community_name,channelId:row.channel_id,channelName:row.channel_name,body:row.body,createdAt,authorName:row.author_name,authorHandle:row.author_handle,replyCount:count(row.reply_count),likeCount:count(row.like_count),kind:row.kind}}};});
  return {candidates,scanned:candidates.at(-1)?.position??after,hasMore:result.results.length===context.limit+1};
}
export async function readSocialStream(db:D1Database,context:Context,rawCursor:string|null) {
  if(!Number.isSafeInteger(context.limit)||context.limit<1||context.limit>40)throw new SocialStreamInputError();
  const cursor=decodeStreamCursor(rawCursor,context),pages:Partial<Record<SocialStreamKind,StreamLanePage>>={},failures:SocialStreamKind[]=[];
  if(context.scope==='following' && context.viewerId===null) { for(const kind of streamKinds(context.filter))cursor.lanes[kind].done=true;return mergeStreamPages(cursor,pages,failures,context.limit); }
  const readers={post:posts,thread:threads,community_post:communities};
  const results=await Promise.allSettled(streamKinds(context.filter).map(async kind=>({kind,page:cursor.lanes[kind].done?{candidates:[],scanned:cursor.lanes[kind].after,hasMore:false}:await readers[kind](db,context,cursor.lanes[kind].after)})));
  results.forEach((result,index)=>{const kind=streamKinds(context.filter)[index];if(result.status==='fulfilled')pages[kind]=result.value.page;else {if(result.reason instanceof HubAuthenticationError || result.reason instanceof DesktopHubAuthenticationError)throw result.reason;failures.push(kind);}});
  return mergeStreamPages(cursor,pages,failures,context.limit);
}
export async function getSocialStream(request:Request) {
  const url=new URL(request.url),query=parseStreamQuery(url),db=getHubD1();
  const hasSession=(request.headers.get('cookie')??'').split(';').some(part=>part.split('=',1)[0].trim()===HUB_SESSION_COOKIE);
  // Explicit desktop credentials must never be shadowed by a browser/dev viewer.
  const desktop=request.headers.has('authorization')||request.headers.get('x-hub-client')==='desktop';
  const viewer=desktop?await getOptionalDesktopHubProfile(request,db):await (hasSession?requireHubSessionProfile(request,db):getOptionalHubSessionProfile(request,db));
  if(viewer && (!streamId(viewer.id) || viewer.id.length>128))throw Error('social_stream_unavailable');
  let origin:string;try{origin=streamOrigin(request.url);}catch{origin=streamOrigin(process.env.HUB_PUBLIC_ORIGIN??'');}
  // Next dev may reconstruct request.url with localhost even for a loopback IP.
  // Honor only another loopback spelling on the same HTTP port, never an external Host.
  const host=request.headers.get('host');
  if(url.protocol==='http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname) && host){
    try{const incoming=new URL(`http://${host}`);if(incoming.host===host && incoming.port===url.port && ['localhost','127.0.0.1','[::1]'].includes(incoming.hostname) && !incoming.username && !incoming.password && incoming.pathname==='/' && !incoming.search && !incoming.hash)origin=streamOrigin(incoming.href);}catch{}
  }
  return readSocialStream(db,{...query,viewerId:viewer?.id??null,origin},query.cursor);
}
