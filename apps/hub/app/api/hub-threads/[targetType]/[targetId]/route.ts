import { NextResponse } from "next/server";
import { isHubThreadTargetType } from "@/lib/hub-thread-system";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getOptionalHubSessionProfile, HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { listD1HubThreadTargetPosts, postD1HubThreadTarget } from "@/lib/server/d1-hub-thread-targets";
import { THREAD_POST_ROLES,type ThreadPostRole,type ThreadSource } from "@/lib/thread-knowledge";

type Context = { params: Promise<{ targetType: string; targetId: string }> };
export async function GET(request: Request, { params }: Context) {
  const { targetType, targetId } = await params;
  if (!isHubThreadTargetType(targetType)) return NextResponse.json({ error: "対象が正しくありません。" }, { status: 400 });
  const db = getHubD1(), viewer = await getOptionalHubSessionProfile(request, db);
  return NextResponse.json(await listD1HubThreadTargetPosts(db, targetType, targetId, viewer?.id ?? null));
}
export async function POST(request: Request, { params }: Context) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  try {
    const { targetType, targetId } = await params;
    if (!isHubThreadTargetType(targetType)) return NextResponse.json({ error: "対象が正しくありません。" }, { status: 400 });
    const db = getHubD1(), viewer = await requireHubSessionProfile(request, db);
    const body = await request.json().catch(() => null) as { body?: unknown; parentPostId?: unknown; anonymous?: unknown;role?:unknown;sources?:unknown;supersedesPostId?:unknown } | null;
    if (typeof body?.body !== "string" || body.body.trim().length < 1 || body.body.trim().length > 2000)
      return NextResponse.json({ error: "本文は1〜2000文字で入力してください。" }, { status: 400 });
    return NextResponse.json(await postD1HubThreadTarget(db, viewer, { type: targetType, targetId,
      body: body.body.trim(), parentPostId: typeof body.parentPostId === "string" ? body.parentPostId : null, anonymous: body.anonymous === true,
      role:THREAD_POST_ROLES.includes(body.role as ThreadPostRole)?body.role as ThreadPostRole:"unspecified",
      sources:Array.isArray(body.sources)?body.sources.slice(0,5) as ThreadSource[]:[],supersedesPostId:typeof body.supersedesPostId==="string"?body.supersedesPostId:null }));
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "投稿できませんでした。" }, { status: 400 });
  }
}
