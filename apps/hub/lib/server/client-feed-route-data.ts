import { getHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import { getOptionalDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { listD1TimelinePosts } from "@/lib/server/d1-social-posts";
import { listPublicationUpdates } from './publication-updates';
import { pullFederationInboundIfStale } from "@/lib/server/federation-inbound";
import { decodeTimelineCursor, encodeTimelineCursor } from "@/lib/timeline-cursor";
import {
  readLimit, readOffset, readScope, toClientPost,
  type ClientFeedPost
} from "@/lib/client-feed-shape";

/**
 * 画面を持たないクライアント向けのフィード。
 *
 * ハブのSNSはこれまでサーバ側で描いていて、外から読む口が無かった。**それが
 * 無いと、デスクトップやスマホのアプリは「サイトを包むだけ」にしかなれない。**
 * プロトコル文書は Hub GUI を「任意の公式クライアント」と位置付けているので、
 * 公式のクライアントが素で使える口が要る。
 *
 * データの組み立ては `listD1TimelinePosts` に任せる。ここで独自に SQL を書くと、
 * 画面とアプリで違うものが見えるようになる。
 */
export async function getClientFeed(request: Request) {
  const url = new URL(request.url);
  const scope = readScope(url.searchParams.get("scope"));
  const limit = readLimit(url.searchParams.get("limit"));
  const offset = readOffset(url.searchParams.get("offset"));

  const database = getHubD1();
  await pullFederationInboundIfStale(database);
  const browserViewer = await getOptionalHubSessionProfile(request, database);
  const desktopViewer = browserViewer ? null : await getOptionalDesktopHubProfile(request, database);
  const viewer = browserViewer ?? desktopViewer;
  // 「following」は誰が見ているかで中身が変わる。見ている人がいないなら
  // 空を返す。全員に同じものを返すと、フォローしていない投稿が
  // フォロー中として並ぶ。
  if (scope === "following" && !viewer) {
    return { scope, limit, offset, signedIn: false, posts: [] as ClientFeedPost[] };
  }

  /*
   * 続きの取り方は画面側（/api/social/posts?view=timeline）と同じ計算にする。
   * アプリだけ別のページネーションにすると、同じフィードが違う長さで見える。
   */
  const rawCursor = url.searchParams.get("cursor");
  const cursor = scope === "popular" || scope === "recommended"
    ? null
    : decodeTimelineCursor(rawCursor);
  const pageScan = {
    count: 0,
    lastCreatedAt: null as string | null,
    lastId: null as string | null,
  };
  const posts = await listD1TimelinePosts(
    database,
    viewer?.id ?? null,
    undefined,
    limit,
    offset,
    undefined,
    cursor,
    scope,
    pageScan
  );
  return {
    scope,
    limit,
    offset,
    signedIn: Boolean(viewer),
    posts: posts.map((post) => toClientPost(post)),
    researchUpdates: offset === 0 && !cursor && (scope === 'recommended' || scope === 'latest') ? await listPublicationUpdates(database).catch(() => []) : [],
    hasMore: pageScan.count === limit,
    nextCursor: scope !== "popular" && scope !== "recommended" && pageScan.lastCreatedAt && pageScan.lastId
      ? encodeTimelineCursor({ createdAt: pageScan.lastCreatedAt, id: pageScan.lastId })
      : null,
    nextOffset: offset + pageScan.count,
  };
}
