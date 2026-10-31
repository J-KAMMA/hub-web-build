import type { ClientFeedPost } from '@/lib/client-feed-shape';
import type { ThreadType } from '@/lib/thread-type';
import type { SocialIdentityMode } from '@/lib/domain';

export const SOCIAL_STREAM_KINDS = ['post', 'thread', 'community_post'] as const;
export type SocialStreamKind = typeof SOCIAL_STREAM_KINDS[number];
export type SocialStreamFilter = 'all' | 'post' | 'thread' | 'community';
export type SocialStreamScope = 'latest' | 'following';
export type SocialStreamThread = { id: string; title: string; boardKey: string; postCount: number; threadType: ThreadType; status: 'open' | 'closed'; updatedAt: string };
export type SocialStreamCommunityPost = { id: string; communityId: string; communityName: string; channelId: string; channelName: string; body: string; createdAt: string; authorName: string; authorHandle: string | null; replyCount: number; likeCount: number; kind: 'chat' | 'guide' | 'question' | 'party' };
type Item<K extends SocialStreamKind, P> = { kind: K; id: string; createdAt: string; origin: string; payload: P };
export type SocialStreamPost = ClientFeedPost & { identityMode: SocialIdentityMode; replyToPostId: string | null };
export type SocialStreamItem = Item<'post', SocialStreamPost> | Item<'thread', SocialStreamThread> | Item<'community_post', SocialStreamCommunityPost>;
export type SocialStreamResponse = { version: 1; filter: SocialStreamFilter; scope: SocialStreamScope; viewerId: string | null; signedIn: boolean; items: SocialStreamItem[]; hasMore: boolean; nextCursor: string | null; failures: SocialStreamKind[] };
export type StreamPosition = { createdAt: string; id: string };
export type StreamLane = { after: StreamPosition | null; done: boolean };
export type StreamContext = { filter: SocialStreamFilter; scope: SocialStreamScope; viewerId: string | null; origin: string };
export type StreamCursor = StreamContext & { version: 1; lanes: Record<SocialStreamKind, StreamLane> };
export type StreamCandidate = { item: SocialStreamItem; position: StreamPosition };
export type StreamLanePage = { candidates: StreamCandidate[]; scanned: StreamPosition | null; hasMore: boolean };
export class SocialStreamInputError extends Error { constructor() { super('invalid_request'); this.name = 'SocialStreamInputError'; } }
export class SocialStreamItemTooLargeError extends Error { constructor() { super('social_stream_item_too_large'); this.name = 'SocialStreamItemTooLargeError'; } }
export const MAX_STREAM_ITEMS_BYTES = 1_572_864;
export function streamId(value: unknown): value is string { return typeof value === 'string' && value.length >= 1 && value.length <= 200 && /^[A-Za-z0-9]/u.test(value) && !/[^A-Za-z0-9._:-]/u.test(value); }
const exact = (value: unknown, keys: string[]): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
export function streamTimestamp(raw: string): string {
  if(typeof raw!=='string'||raw.length>40)throw new SocialStreamInputError();
  const parts=raw.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?Z?)?$/u);
  if(!parts)throw new SocialStreamInputError();
  const iso=`${parts[1]}T${parts[2]??'00:00:00'}.${(parts[3]??'').padEnd(3,'0').slice(0,3)}Z`;
  const date = new Date(iso); if (!Number.isFinite(date.getTime()) || date.toISOString() !== iso) throw new SocialStreamInputError();
  return iso;
}
export function streamOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin === 'null') throw new SocialStreamInputError();
  if(url.origin.length>2048)throw new SocialStreamInputError(); return url.origin;
}
export function streamKinds(filter: SocialStreamFilter): SocialStreamKind[] { return filter === 'all' ? [...SOCIAL_STREAM_KINDS] : [filter === 'community' ? 'community_post' : filter]; }
export function parseStreamQuery(url: URL) {
  for (const key of url.searchParams.keys()) if (!['filter', 'scope', 'limit', 'cursor'].includes(key) || url.searchParams.getAll(key).length !== 1) throw new SocialStreamInputError();
  const filter = url.searchParams.get('filter') ?? 'all', scope = url.searchParams.get('scope') ?? 'latest', rawLimit = url.searchParams.get('limit') ?? '20', cursor = url.searchParams.get('cursor');
  if (!['all', 'post', 'thread', 'community'].includes(filter) || !['latest', 'following'].includes(scope) || !/^[1-9][0-9]?$/u.test(rawLimit) || Number(rawLimit) > 40 || cursor === '') throw new SocialStreamInputError();
  return { filter: filter as SocialStreamFilter, scope: scope as SocialStreamScope, limit: Number(rawLimit), cursor };
}
export function initialStreamCursor(context: StreamContext): StreamCursor { return { version: 1, filter:context.filter,scope:context.scope,viewerId:context.viewerId,origin:context.origin,lanes: { post: { after: null, done: false }, thread: { after: null, done: false }, community_post: { after: null, done: false } } }; }
export function encodeStreamCursor(cursor: StreamCursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(cursor));
  if(bytes.length>3072)throw new SocialStreamInputError();
  const encoded = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
  if (encoded.length > 4096) throw new SocialStreamInputError(); return encoded;
}
export function decodeStreamCursor(raw: string | null, context: StreamContext): StreamCursor {
  if (raw === null) return initialStreamCursor(context);
  if (!raw.length || raw.length > 4096 || /[^A-Za-z0-9_-]/u.test(raw)) throw new SocialStreamInputError();
  try {
    const bytes = Uint8Array.from(atob(raw.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(raw.length / 4) * 4, '=')), char => char.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!exact(value, ['version', 'filter', 'scope', 'viewerId', 'origin', 'lanes']) || value.version !== 1 || value.filter !== context.filter || value.scope !== context.scope || value.viewerId !== context.viewerId || value.origin !== context.origin || !exact(value.lanes, [...SOCIAL_STREAM_KINDS])) throw new SocialStreamInputError();
    const cursor=initialStreamCursor(context);
    for (const kind of SOCIAL_STREAM_KINDS) {
      const lane = value.lanes[kind]; if (!exact(lane, ['after', 'done']) || typeof lane.done !== 'boolean') throw new SocialStreamInputError();
      let position:StreamPosition|null=null;
      if (lane.after !== null) { if (!exact(lane.after, ['createdAt', 'id']) || typeof lane.after.createdAt !== 'string' || !streamId(lane.after.id)) throw new SocialStreamInputError(); streamTimestamp(lane.after.createdAt);position={createdAt:lane.after.createdAt,id:lane.after.id}; }
      cursor.lanes[kind]={after:position,done:lane.done};
    }
    if (encodeStreamCursor(cursor) !== raw) throw new SocialStreamInputError(); return cursor;
  } catch { throw new SocialStreamInputError(); }
}
export function compareStreamItems(a: SocialStreamItem, b: SocialStreamItem): number {
  return a.createdAt === b.createdAt ? SOCIAL_STREAM_KINDS.indexOf(a.kind) - SOCIAL_STREAM_KINDS.indexOf(b.kind) || (a.id === b.id ? 0 : a.id > b.id ? -1 : 1) : a.createdAt > b.createdAt ? -1 : 1;
}
export function mergeStreamPages(context: StreamCursor, pages: Partial<Record<SocialStreamKind, StreamLanePage>>, failures: SocialStreamKind[], limit: number): SocialStreamResponse {
  const candidates = Object.values(pages).flatMap(page => page?.candidates ?? []).sort((a, b) => compareStreamItems(a.item, b.item));
  const selected:StreamCandidate[]=[], next = initialStreamCursor(context);let bytes=2;
  for(const candidate of candidates.slice(0,limit)) {
    const size=new TextEncoder().encode(JSON.stringify(candidate.item)).byteLength;
    if(size+2>MAX_STREAM_ITEMS_BYTES)throw new SocialStreamItemTooLargeError();
    if(bytes+size+(selected.length?1:0)>MAX_STREAM_ITEMS_BYTES)break;
    bytes+=size+(selected.length?1:0);selected.push(candidate);
  }
  for (const kind of SOCIAL_STREAM_KINDS) {
    const page = pages[kind], consumed = selected.filter(c => c.item.kind === kind);
    next.lanes[kind] = { ...context.lanes[kind] };
    if (!page) continue;
    const remaining = page.candidates.length > consumed.length;
    next.lanes[kind] = { after: !remaining ? page.scanned ?? consumed.at(-1)?.position ?? context.lanes[kind].after : consumed.at(-1)?.position ?? context.lanes[kind].after, done: !remaining && !page.hasMore };
  }
  const hasMore = failures.length > 0 || streamKinds(context.filter).some(kind => !next.lanes[kind].done);
  return { version: 1, filter: context.filter, scope: context.scope, viewerId: context.viewerId, signedIn: context.viewerId !== null, items: selected.map(c => c.item), hasMore, nextCursor: hasMore ? encodeStreamCursor(next) : null, failures };
}
