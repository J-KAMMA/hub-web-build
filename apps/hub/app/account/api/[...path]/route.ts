import { NextRequest } from "next/server";

const ACCOUNT_STAGING_ORIGIN = "https://jkamma-account-dev.jammakamma0.workers.dev";
const ACCOUNT_PRODUCTION_ORIGIN = "https://account.jkamma.com";

function accountOrigin(): string | null {
  if (process.env.HUB_DEPLOYMENT_ENVIRONMENT === "staging") return ACCOUNT_STAGING_ORIGIN;
  if (process.env.HUB_DEPLOYMENT_ENVIRONMENT === "production") return ACCOUNT_PRODUCTION_ORIGIN;
  const configured = process.env.HUB_ACCOUNT_DEV_ORIGIN ?? "http://127.0.0.1:8791";
  try {
    const url = new URL(configured);
    if (url.protocol !== "http:" || !new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) return null;
    return url.origin;
  } catch {
    return null;
  }
}

async function proxyAccountRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const origin = accountOrigin();
  if (!origin) {
    return Response.json(
      { error: "account_service_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const { path } = await context.params;
  const target = new URL(`/api/${path.map(encodeURIComponent).join("/")}`, origin);
  target.search = request.nextUrl.search;
  target.searchParams.set("_proxy_redirect", "manual");

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  headers.set("x-jkamma-proxy-redirect", "manual");
  const body = request.method === "GET" || request.method === "HEAD"
    ? undefined
    : await request.arrayBuffer();
  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json(
      { error: "account_service_unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
  const responseHeaders = new Headers(upstream.headers);
  // Server-side fetch exposes the decoded response body. Forwarding the
  // upstream compression metadata would make the browser decode it twice.
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.set("cache-control", "no-store");
  const redirectLocation = responseHeaders.get("x-jkamma-redirect-location");
  responseHeaders.delete("x-jkamma-redirect-location");
  if (redirectLocation) {
    responseHeaders.set("location", redirectLocation);
    return new Response(null, { status: 302, headers: responseHeaders });
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const GET = proxyAccountRequest;
export const POST = proxyAccountRequest;
export const PUT = proxyAccountRequest;
export const PATCH = proxyAccountRequest;
export const DELETE = proxyAccountRequest;
export const HEAD = proxyAccountRequest;
