import "server-only";

import { NextResponse } from "next/server";

import { HUB_SESSION_COOKIE, hashHubSessionSecret, readCookie } from "@/lib/server/hub-session";
import type { D1Database } from "@cloudflare/workers-types";

export function isSecureRequest(request: Request): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
  return forwardedProtocol ? forwardedProtocol === "https" : new URL(request.url).protocol === "https:";
}

export const HUB_PASSKEY_CEREMONY_COOKIE = "hub.passkey.ceremony";

export function setHubPasskeyCeremonyCookie(response: NextResponse, request: Request, value: string, expiresAt: string) {
  response.cookies.set(HUB_PASSKEY_CEREMONY_COOKIE, value, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/api/auth/passkey",
    expires: new Date(expiresAt)
  });
}

export function clearHubPasskeyCeremonyCookie(response: NextResponse, request: Request) {
  response.cookies.set(HUB_PASSKEY_CEREMONY_COOKIE, "", {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/api/auth/passkey",
    maxAge: 0
  });
}

export function hasSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    const originUrl = new URL(origin);
    const requestUrl = new URL(request.url);
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",", 1)[0]?.trim();
    const requestHost = forwardedHost || request.headers.get("host") || requestUrl.host;
    const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim();
    const requestProtocol = forwardedProtocol ? `${forwardedProtocol}:` : requestUrl.protocol;
    return !originUrl.username && !originUrl.password && originUrl.host === requestHost && originUrl.protocol === requestProtocol;
  } catch {
    return false;
  }
}

export function setHubSessionCookie(
  response: NextResponse,
  request: Request,
  secret: string,
  expiresAt: string
) {
  response.cookies.set(HUB_SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/",
    expires: new Date(expiresAt)
  });
}

export function clearHubSessionCookie(response: NextResponse, request: Request) {
  response.cookies.set(HUB_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
}

export async function revokeHubSession(request: Request, database: D1Database): Promise<void> {
  const secret = readCookie(request.headers.get("cookie"), HUB_SESSION_COOKIE);
  if (!secret || secret.length < 32 || secret.length > 512) return;
  const secretHash = await hashHubSessionSecret(secret);
  await database.prepare("UPDATE sessions SET revoked_at = ? WHERE secret_hash = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), secretHash)
    .run();
}
