import { NextResponse } from "next/server";

import { normalizePostReplyOrder } from "@/lib/post-reply-order";
import {
  decodePostReplyCursor,
  encodePostReplyCursor,
} from "@/lib/post-reply-cursor";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { getOptionalHubSessionProfile } from "@/lib/server/hub-session";
import {
  listD1PostRepliesPage,
  listD1TimelinePosts,
} from "@/lib/server/d1-social-posts";

const MAX_PAGE_SIZE = 50;
const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  Vary: "Cookie",
};

function privateJson(body: unknown, init: { status?: number } = {}) {
  return NextResponse.json(body, { ...init, headers: PRIVATE_HEADERS });
}

function readInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const postId = url.searchParams.get("postId")?.trim();
    if (!postId || postId.length > 128) {
      return privateJson({ error: "postId is required." }, { status: 400 });
    }

    const order = normalizePostReplyOrder(url.searchParams.get("order") ?? undefined);
    const limit = Math.max(1, readInteger(url.searchParams.get("limit"), 20, MAX_PAGE_SIZE));
    const rawCursor = url.searchParams.get("cursor");
    const cursor = decodePostReplyCursor(rawCursor, order);
    if (rawCursor && !cursor) {
      return privateJson({ error: "invalid_cursor" }, { status: 400 });
    }

    const database = getHubD1();
    const viewer = await getOptionalHubSessionProfile(request, database);
    const root = await listD1TimelinePosts(
      database,
      viewer?.id ?? null,
      undefined,
      1,
      0,
      [postId],
    );
    if (!root.length) {
      return privateJson({ error: "post not found." }, { status: 404 });
    }
    const page = await listD1PostRepliesPage(
      database,
      viewer?.id ?? null,
      postId,
      order,
      limit,
      cursor,
    );
    const lastReply = page.replies.at(-1);
    return privateJson({
      replies: page.replies,
      hasMore: page.hasMore,
      nextCursor: lastReply
        ? encodePostReplyCursor({
          order,
          score: lastReply.score,
          likeCount: lastReply.likeCount,
          replyCount: lastReply.replyCount,
          createdAt: lastReply.createdAt,
          id: lastReply.id,
        })
        : null,
      offset: 0,
      limit,
    });
  } catch (error) {
    if (error instanceof HubD1UnavailableError) {
      return privateJson({ error: "Reply service is unavailable." }, { status: 503 });
    }
    throw error;
  }
}
