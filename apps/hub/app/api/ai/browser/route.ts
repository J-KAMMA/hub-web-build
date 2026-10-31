import { NextResponse } from "next/server";

import { BrowserReadError, readWebPage } from "@/lib/ai-browser-reader";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, HubSuspendedError, requireHubSessionProfile } from "@/lib/server/hub-session";

/* AIハーネスが外部ページを読むための、公開読み取り専用のブラウザツール。
   書き込み・ログイン・決済は伴わない。応答は信頼されないコンテンツとして扱う。 */
export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "invalid_origin" }, { status: 403 });
  try {
    await requireHubSessionProfile(request);
  } catch (error) {
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "このプロフィールは凍結されています。" }, { status: 403 });
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    throw error;
  }
  const body = await request.json().catch(() => null) as { url?: unknown } | null;
  try {
    const result = await readWebPage(body?.url);
    return NextResponse.json({ version: "1", untrusted: true, result });
  } catch (error) {
    if (error instanceof BrowserReadError) {
      const status = error.code === "invalid_url" || error.code === "private_address" ? 400
        : error.code === "unsupported_type" ? 415
        : error.code === "timeout" ? 504 : 502;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    throw error;
  }
}
