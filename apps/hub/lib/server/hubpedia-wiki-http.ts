import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";
import type { Profile } from "@/lib/domain";
import { getHubD1 } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { WikiConflictError, WikiInputError, WikiRateLimitError } from "@/lib/server/hubpedia-wiki";
import {
  assertHumanEditingEnabled,
  HumanEditingDisabledError,
  WikiPermissionError,
  WikiSuspendedError,
} from "@/lib/server/hubpedia-wiki-policy";

/*
 * Shared plumbing for the Hubpedia human-editing routes: same-origin check for writes,
 * session, feature flag, and one mapping from domain errors to HTTP statuses.
 */

type Context<P> = { params: Promise<P> };

export function wikiErrorResponse(error: unknown) {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。", code: "login_required" }, { status: 401 });
  if (error instanceof HumanEditingDisabledError) {
    return NextResponse.json(
      { error: "Hubpediaの人間による編集は現在受け付けていません。", code: "human_editing_disabled" },
      { status: 403 },
    );
  }
  if (error instanceof WikiSuspendedError) {
    return NextResponse.json({ error: error.message, code: "editor_suspended", expiresAt: error.expiresAt, reason: error.reason }, { status: 403 });
  }
  if (error instanceof WikiPermissionError) return NextResponse.json({ error: error.message, code: "forbidden" }, { status: 403 });
  if (error instanceof WikiRateLimitError) return NextResponse.json({ error: error.message, code: "rate_limited" }, { status: 429 });
  if (error instanceof WikiConflictError) return NextResponse.json({ error: error.message, code: "conflict" }, { status: 409 });
  if (error instanceof WikiInputError) return NextResponse.json({ error: error.message, code: "invalid_input" }, { status: 400 });
  if (error instanceof SyntaxError) return NextResponse.json({ error: "Invalid JSON.", code: "invalid_input" }, { status: 400 });
  throw error;
}

export type WikiRouteOptions = {
  /** Writes need a same-origin request. Defaults to true for non-GET. */
  write?: boolean;
  /** Require a signed-in profile. Defaults to true. */
  auth?: boolean;
  /** Require HUBPEDIA_HUMAN_EDITING (proposal submission only). Defaults to false. */
  requireFlag?: boolean;
};

export function wikiRoute<P = Record<string, never>>(
  options: WikiRouteOptions,
  handler: (input: { request: Request; db: D1Database; actor: Profile | null; params: P }) => Promise<unknown>,
) {
  const write = options.write ?? false;
  const requireFlag = options.requireFlag ?? false;
  // Next 16 route types require the context argument (an optional one fails the build).
  return async (request: Request, context: Context<P>) => {
    if (write) {
      const origin = requireSameOrigin(request);
      if (origin) return origin;
    }
    try {
      if (requireFlag) assertHumanEditingEnabled();
      const db = getHubD1();
      const actor = options.auth === false ? null : await requireHubSessionProfile(request, db);
      const params = ((await context?.params) ?? {}) as P;
      const result = await handler({ request, db, actor, params });
      if (result instanceof Response) return result;
      return NextResponse.json(result);
    } catch (error) {
      return wikiErrorResponse(error);
    }
  };
}

export async function readJson(request: Request) {
  const body = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new WikiInputError("A JSON object is required.");
  return body as Record<string, unknown>;
}
