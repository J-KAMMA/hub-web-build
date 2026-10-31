/*
 * Hub が WebFinger に自分で答えない代わりの転送口（DESIGN.md 0.2、8.0）。
 *
 * WebFinger と actor は apps/federation だけが持つ。本番は端で /.well-known/webfinger を
 * Federation へ回し、手元は next.config.mjs の rewrites が回す。この関数はどちらも効いていない
 * 構成のための保険で、FEDERATION_SERVICE_URL が設定されているときだけ Federation へ取り次ぐ。
 * 公開情報だけを読み、認証情報は渡さない。
 */
const RESOURCE = /^acct:[A-Za-z0-9_][A-Za-z0-9._-]{0,31}@[^/?#\s]{1,255}$/i;

export async function forwardWebFinger(
  requestUrl: string,
  federationBaseUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const resource = new URL(requestUrl).searchParams.get("resource") ?? "";
  if (!RESOURCE.test(resource)) {
    return Response.json({ error: "invalid_resource" }, { status: 400 });
  }
  const base = federationBaseUrl?.trim();
  if (!base) return Response.json({ error: "not_found" }, { status: 404 });
  let target: URL;
  try {
    target = new URL("/.well-known/webfinger", base);
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  const isLoopback = target.hostname === "127.0.0.1" || target.hostname === "localhost";
  if (target.protocol !== "https:" && !isLoopback) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
  target.searchParams.set("resource", resource);
  try {
    const upstream = await fetchImpl(target, {
      headers: { accept: "application/jrd+json, application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) return Response.json({ error: "not_found" }, { status: 404 });
    const text = await upstream.text();
    if (text.length > 65_536) return Response.json({ error: "not_found" }, { status: 404 });
    return new Response(text, {
      status: 200,
      headers: {
        "Content-Type": "application/jrd+json; charset=utf-8",
        "Cache-Control": "public, max-age=60",
      },
    });
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
