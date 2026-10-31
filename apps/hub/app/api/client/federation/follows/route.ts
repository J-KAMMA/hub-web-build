import { NextResponse } from "next/server";

import { consumeD1PostQuota, HubPostRateLimitError } from "@/lib/server/d1-rate-limit";
import { DesktopHubAuthenticationError, requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { followRemoteHandle, listRemoteFollows } from "@/lib/server/federation-outbound";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubSuspendedError } from "@/lib/server/hub-session";

const HEADERS = { "cache-control": "private, no-store" };

const MESSAGES: Record<string, string> = {
  invalid_handle: "ユーザー名は @名前@ホスト の形で入力してください。",
  unsupported_host: "このホストにはつなげません。",
  cannot_follow_local_actor: "このハブの利用者は、通常のフォローを使ってください。",
  domain_suspended: "このハブとはつながらない設定になっています。",
  webfinger_no_actor: "相手が見つかりませんでした。",
  federation_not_enabled: "外部のハブをフォローするには、設定で連合を有効にしてください。",
  federation_unavailable: "連合のサービスにつなげませんでした。",
};

function failure(error: unknown) {
  if (error instanceof DesktopHubAuthenticationError) return NextResponse.json({ error: "desktop_authentication_failed" }, { status: 401, headers: HEADERS });
  if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers: HEADERS });
  if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: HEADERS });
  if (error instanceof HubPostRateLimitError) {
    return NextResponse.json(
      { error: "フォロー操作の回数が上限に達しました。", retry_after: error.retryAfterSeconds },
      { status: 429, headers: { ...HEADERS, "Retry-After": String(error.retryAfterSeconds) } },
    );
  }
  return NextResponse.json({ error: "フォローできませんでした。" }, { status: 400, headers: HEADERS });
}

/** クライアント向け。/api/federation/follows と同じ関数を、desktop assertion の Bearer で通す。 */
export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    return NextResponse.json({ follows: await listRemoteFollows(database, viewer.id) }, { headers: HEADERS });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { handle?: unknown } | null;
  if (typeof body?.handle !== "string" || body.handle.trim().length < 3 || body.handle.length > 320) {
    return NextResponse.json({ error: MESSAGES.invalid_handle, code: "invalid_handle" }, { status: 400, headers: HEADERS });
  }
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    await consumeD1PostQuota(database, viewer, "social_follow");
    const result = await followRemoteHandle(database, viewer.id, body.handle);
    if (!result.ok) {
      return NextResponse.json(
        { error: MESSAGES[result.error] ?? "フォローできませんでした。", code: result.error },
        { status: result.status, headers: HEADERS },
      );
    }
    return NextResponse.json(
      { profileId: result.profileId, handle: result.handle, displayName: result.displayName, host: result.host, state: result.state },
      { headers: HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}
