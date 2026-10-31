import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

import { getInstanceOrigin } from "@/lib/instance-origin";
import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { WorkInputError } from "@/lib/work-commissions";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { workStateLookupDepsFromEnv, type WorkStateLookupDeps } from "@/lib/server/work-escrow-state";

export const WORK_HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie, Authorization" };

/** Commissions need Commerce and the file component: a jkamma-Hub-only feature, absent when self-hosted, and off until HUB_WORK_COMMISSIONS_ENABLED. */
export function rejectWorkRequest(request: Request, { write }: { write: boolean }): NextResponse | null {
  if (!isOptionalServiceEnabled("commerce") || !isOptionalServiceEnabled("work-commissions")) return NextResponse.json({ error: "not_found" }, { status: 404, headers: WORK_HEADERS });
  if (write && !hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: WORK_HEADERS });
  return null;
}

export function workErrorResponse(error: unknown): NextResponse {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。", code: "authentication_required" }, { status: 401, headers: WORK_HEADERS });
  }
  if (error instanceof WorkInputError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: WORK_HEADERS });
  }
  if (error instanceof HubD1UnavailableError) {
    return NextResponse.json({ error: "依頼を利用できません。しばらくしてから再度お試しください。", code: "unavailable" }, { status: 503, headers: WORK_HEADERS });
  }
  return NextResponse.json({ error: "依頼を処理できませんでした。", code: "unavailable" }, { status: 500, headers: WORK_HEADERS });
}

export async function readWorkJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    /* fall through */
  }
  throw new WorkInputError("invalid_input", "リクエストの形式が正しくありません。");
}

function secret(name: string): string | null {
  let fromBinding: unknown;
  try {
    fromBinding = Reflect.get(getCloudflareContext().env as unknown as Record<string, unknown>, name);
  } catch {
    fromBinding = undefined;
  }
  const value = typeof fromBinding === "string" ? fromBinding : process.env[name];
  return typeof value === "string" && value.trim() && !value.trim().startsWith("replace-with") ? value.trim() : null;
}

/** A Hub key distinct from the file-ticket key; unset means no ticket can be signed (fail closed). */
export const workTicketKey = () => secret("HUB_COMMERCE_WORK_TICKET_PRIVATE_KEY_PKCS8");

export function workStateDeps(): WorkStateLookupDeps {
  return workStateLookupDepsFromEnv(getInstanceOrigin());
}
