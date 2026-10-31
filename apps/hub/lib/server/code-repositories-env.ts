import { getCloudflareContext } from "@opennextjs/cloudflare";
import { NextResponse } from "next/server";

import { isOptionalServiceEnabled } from "@/lib/optional-services";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError } from "@/lib/server/hub-session";
import { getHubStorageAccountClient } from "@/lib/server/hub-storage-account-client";
import { HubCodeError, type CodeWorkerSend, type HubCodeDeps } from "@/lib/server/code-repositories";

/**
 * Production wiring for Hub code hosting (code-repositories.ts keeps no `@/` imports so the Code
 * Worker's tests can run it against the real Worker).
 *
 * The Code Worker is reached through the `HUB_CODE_WORKER` service binding when present, otherwise
 * `HUB_CODE_ORIGIN` (an http(s) origin that serves `/code/api/v1/*`). The signing key is the Hub
 * secret `HUB_CODE_TICKET_PRIVATE_KEY_PKCS8`, separate from the file and video keys. The Code
 * Worker's calls into Hub (authorize, push report) carry the shared secret `HUB_CODE_SERVICE_KEY`:
 * a leaked token hash alone must not be enough to obtain a ticket.
 */

type Env = Record<string, unknown>;

export const NO_STORE = { "Cache-Control": "private, no-store" };
export const HUB_CODE_SERVICE_HEADER = "x-hub-code-service-key";

function bindings(env?: Env): Env | undefined {
  if (env) return env;
  try {
    return getCloudflareContext().env as unknown as Env;
  } catch {
    return undefined;
  }
}

function readString(env: Env | undefined, name: string): string | null {
  const fromEnv = env ? Reflect.get(env, name) : undefined;
  const value = typeof fromEnv === "string" ? fromEnv : process.env[name];
  return typeof value === "string" && value.trim() && !value.trim().startsWith("replace-with") ? value.trim() : null;
}

export function hubCodeDepsFromEnv(env?: Env): HubCodeDeps {
  const resolved = bindings(env);
  const binding = resolved ? Reflect.get(resolved, "HUB_CODE_WORKER") : undefined;
  const origin = readString(resolved, "HUB_CODE_ORIGIN");
  let send: CodeWorkerSend | null = null;
  if (binding && typeof (binding as { fetch?: unknown }).fetch === "function") {
    const fetcher = binding as { fetch(request: Request): Promise<Response> };
    send = (path, init) => fetcher.fetch(new Request(new URL(path, "https://code.internal"), init));
  } else if (origin && /^https?:\/\/[^/]+$/i.test(origin.replace(/\/$/, ""))) {
    const base = origin.replace(/\/$/, "");
    send = (path, init) => fetch(`${base}${path}`, { ...init, redirect: "manual" });
  }
  return {
    privateKeyPkcs8: readString(resolved, "HUB_CODE_TICKET_PRIVATE_KEY_PKCS8"),
    send,
    account: getHubStorageAccountClient(),
  };
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/** Calls from the Code Worker: the service key must be configured (32+ chars) and match. */
export function rejectCodeServiceRequest(request: Request, env?: Env): NextResponse | null {
  if (!isOptionalServiceEnabled("code")) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  const expected = readString(bindings(env), "HUB_CODE_SERVICE_KEY");
  if (!expected || expected.length < 32) return NextResponse.json({ code: "code_unavailable" }, { status: 503, headers: NO_STORE });
  const presented = request.headers.get(HUB_CODE_SERVICE_HEADER) ?? "";
  if (!constantTimeEqual(presented, expected)) return NextResponse.json({ code: "service_forbidden" }, { status: 403, headers: NO_STORE });
  return null;
}

/** Code hosting is a jkamma-Hub-only feature (it needs the Code Worker): absent when self-hosted. */
export function rejectCodeRequest(request: Request, { write }: { write: boolean }): NextResponse | null {
  if (!isOptionalServiceEnabled("code")) return NextResponse.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
  if (write && !hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: NO_STORE });
  return null;
}

export function codeErrorResponse(error: unknown): NextResponse {
  if (error instanceof HubAuthenticationError) {
    return NextResponse.json({ error: "ログインが必要です。", code: "authentication_required" }, { status: 401, headers: NO_STORE });
  }
  if (error instanceof HubCodeError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE });
  }
  return NextResponse.json({ error: "コード置き場を処理できませんでした。", code: "unavailable" }, { status: 503, headers: NO_STORE });
}
