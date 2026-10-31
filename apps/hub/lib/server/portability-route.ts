import "server-only";

import type { D1Database } from "@cloudflare/workers-types";
import { NextResponse } from "next/server";

import type { Profile } from "@/lib/domain";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, HubSuspendedError, requireHubSessionProfile } from "@/lib/server/hub-session";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Cookie" };

export const MESSAGES: Record<string, string> = {
  federation_unavailable: "連合のサービスにつなげませんでした。",
  federation_not_enabled: "先に設定で連合を有効にしてください。",
  registration_signature_invalid: "署名を確かめられませんでした。",
  root_key_already_registered: "別の根鍵がすでに公開されています。",
  bundle_contains_forbidden_data: "束に、持ち出してはいけない項目が入っています。",
  bundle_proof_invalid: "束の署名が合いません。改ざんされた可能性があります。何も取り込んでいません。",
  post_proof_invalid: "投稿の署名が合いません。改ざんされた可能性があります。何も取り込んでいません。",
  move_too_soon: "移転は30日あけてください。",
  target_does_not_acknowledge: "移転先が、この actor を alsoKnownAs に載せていません。先に移転先で設定してください。",
};

/** 認証・同一オリジン確認・エラーの形をそろえる。errors は HTTP の状態コードつきの JSON。 */
export async function portabilityRoute(
  request: Request,
  run: (context: { database: D1Database; profile: Profile }) => Promise<Response>,
  options: { mutating?: boolean } = {},
): Promise<Response> {
  if (options.mutating !== false && request.method !== "GET" && !hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: PRIVATE_HEADERS });
  }
  try {
    const database = getHubD1();
    const profile = await requireHubSessionProfile(request, database);
    return await run({ database, profile });
  } catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
    if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers: PRIVATE_HEADERS });
    if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
    return NextResponse.json({ error: "処理できませんでした。" }, { status: 500, headers: PRIVATE_HEADERS });
  }
}

export function portabilityJson(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return NextResponse.json(body, { status, headers: { ...PRIVATE_HEADERS, ...extra } });
}

export function portabilityFailure(result: { status: number; error: string; detail?: string }): Response {
  return portabilityJson({ error: MESSAGES[result.error] ?? result.error, code: result.error, ...(result.detail ? { detail: result.detail } : {}) }, result.status);
}

export async function readJsonBody(request: Request, maxBytes = 32 * 1024 * 1024): Promise<unknown | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  return request.json().catch(() => null);
}
