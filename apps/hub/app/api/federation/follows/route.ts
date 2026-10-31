import { NextResponse } from "next/server";

import { consumeD1PostQuota, HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { followRemoteHandle, listRemoteFollows } from "@/lib/server/federation-outbound";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, HubSuspendedError, requireHubSessionProfile } from "@/lib/server/hub-session";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Cookie" };

const MESSAGES: Record<string, string> = {
  invalid_handle: "ユーザー名は @名前@ホスト の形で入力してください。",
  unsupported_host: "このホストにはつなげません。",
  cannot_follow_local_actor: "このハブの利用者は、通常のフォローを使ってください。",
  domain_suspended: "このハブとはつながらない設定になっています。",
  webfinger_no_actor: "相手が見つかりませんでした。",
  federation_not_enabled: "外部のハブをフォローするには、設定で連合を有効にしてください。",
  federation_unavailable: "連合のサービスにつなげませんでした。",
};

/** 自分が外部の人へ送ったフォローと、その状態（pending / accepted / rejected）。 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    return NextResponse.json({ follows: await listRemoteFollows(database, viewer.id) }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: "一覧を取得できませんでした。" }, { status: 400, headers: PRIVATE_HEADERS });
  }
}

/**
 * 外部のハブの人を `@user@host` でフォローする。WebFinger で相手を引き、Follow を送る。
 * 相手が承認する（Accept）まで state は pending で、承認後にフォロー中のタイムラインへ載る。
 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  const body = await request.json().catch(() => null) as { handle?: unknown } | null;
  if (typeof body?.handle !== "string" || body.handle.trim().length < 3 || body.handle.length > 320) {
    return NextResponse.json({ error: MESSAGES.invalid_handle, code: "invalid_handle" }, { status: 400, headers: PRIVATE_HEADERS });
  }
  try {
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    await consumeD1PostQuota(database, viewer, "social_follow");
    const result = await followRemoteHandle(database, viewer.id, body.handle);
    if (!result.ok) {
      return NextResponse.json(
        { error: MESSAGES[result.error] ?? "フォローできませんでした。", code: result.error },
        { status: result.status, headers: PRIVATE_HEADERS },
      );
    }
    return NextResponse.json(
      { profileId: result.profileId, handle: result.handle, displayName: result.displayName, host: result.host, state: result.state },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof HubPostRateLimitError) {
      return NextResponse.json(
        { error: "フォロー操作の回数が上限に達しました。", retry_after: error.retryAfterSeconds },
        { status: 429, headers: { ...PRIVATE_HEADERS, "Retry-After": String(error.retryAfterSeconds) } },
      );
    }
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: "フォローできませんでした。" }, { status: 400, headers: PRIVATE_HEADERS });
  }
}
