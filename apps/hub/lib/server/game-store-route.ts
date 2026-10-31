import "server-only";

import { NextResponse } from "next/server";

import { GameStoreError } from "@/lib/server/d1-game-store";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubD1UnavailableError, HubMediaUnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError } from "@/lib/server/hub-session";

export const GAME_STORE_HEADERS = { "Cache-Control": "no-store" };

export function gameStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: GAME_STORE_HEADERS });
}

/** Mutations come only from the Hub page itself (Web, or the Desktop browser view of it). */
export function refuseCrossOrigin(request: Request) {
  return hasSameOrigin(request) ? null : gameStoreJson({ error: "cross_origin_refused" }, 403);
}

export function gameStoreFailure(error: unknown) {
  if (error instanceof HubAuthenticationError) return gameStoreJson({ error: "login_required" }, 401);
  if (error instanceof GameStoreError) return gameStoreJson({ error: error.code }, error.status);
  if (error instanceof HubD1UnavailableError || error instanceof HubMediaUnavailableError) return gameStoreJson({ error: "game_store_unavailable" }, 503);
  return gameStoreJson({ error: "game_store_failed" }, 500);
}
