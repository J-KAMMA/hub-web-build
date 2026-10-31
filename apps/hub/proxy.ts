import { NextResponse, type NextRequest } from "next/server";

import { decideHubRequest, type HubRequestPolicyEnv } from "./lib/hub-request-policy";
import { HUB_LOCALE_COOKIE } from "./lib/i18n";

/*
 * Local development adapter for the shared request policy.
 *
 * Next 16 pins this file to the Node.js runtime, which @opennextjs/cloudflare
 * refuses to bundle, so the Cloudflare build parks it and custom-worker.ts
 * applies the same policy at the Worker entry point. Keeping the rules in
 * lib/hub-request-policy.ts is what stops the two surfaces from drifting.
 */
export function proxy(request: NextRequest) {
  const env = process.env as HubRequestPolicyEnv;
  const decision = decideHubRequest(
    {
      pathname: request.nextUrl.pathname,
      search: request.nextUrl.search,
      requestedLocale: request.nextUrl.searchParams.get("lang"),
      acceptLanguage: request.headers.get("accept-language"),
      hasLocaleCookie: request.cookies.has(HUB_LOCALE_COOKIE),
      secure: request.nextUrl.protocol === "https:",
      requestId: request.headers.get("cf-ray") ?? crypto.randomUUID(),
    },
    env,
  );

  if (decision.type === "block") {
    return NextResponse.json(decision.body, { status: decision.status, headers: decision.headers });
  }

  if (decision.type === "redirect") {
    const destination = request.nextUrl.clone();
    destination.pathname = decision.pathname;
    destination.search = decision.search;
    return NextResponse.redirect(destination, decision.status);
  }

  const response = NextResponse.next();
  for (const [header, value] of Object.entries(decision.headers)) {
    response.headers.set(header, value);
  }
  if (decision.localeCookie) {
    const { name, value, ...options } = decision.localeCookie;
    response.cookies.set(name, value, options);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"]
};
