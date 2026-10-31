import { NextResponse } from "next/server";

import { isInstanceOperator } from "@/lib/hub-operators";
import { isValidPolicyAction, listKnownRemoteHosts, mergeDomainPolicies } from "@/lib/server/federation-domain-policy";
import { listFederationDomainPolicies, putFederationDomainPolicy } from "@/lib/server/federation-gateway";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, HubSuspendedError, requireHubSessionProfile } from "@/lib/server/hub-session";

const PRIVATE_HEADERS = { "cache-control": "private, no-store", vary: "Cookie" };
const DOMAIN_PATTERN = /^[a-z0-9.-]+(?::\d{1,5})?$/;

/** 運営者だけ。Hub の他の運営者 API と同じ HUB_OPERATOR_PROFILE_IDS の名簿で判定する。 */
async function requireOperator(request: Request) {
  const database = getHubD1();
  const actor = await requireHubSessionProfile(request, database);
  if (!(await isInstanceOperator(database, actor.id, process.env.HUB_OPERATOR_PROFILE_IDS))) return { database, actor: null };
  return { database, actor };
}

function failure(error: unknown) {
  if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "ログインが必要です。" }, { status: 401, headers: PRIVATE_HEADERS });
  if (error instanceof HubSuspendedError) return NextResponse.json({ error: "suspended" }, { status: 403, headers: PRIVATE_HEADERS });
  if (error instanceof HubD1UnavailableError) return NextResponse.json({ error: "unavailable" }, { status: 503, headers: PRIVATE_HEADERS });
  return NextResponse.json({ error: "処理できませんでした。" }, { status: 400, headers: PRIVATE_HEADERS });
}

const FORBIDDEN = () => NextResponse.json({ error: "Hub運営者だけが利用できます。" }, { status: 403, headers: PRIVATE_HEADERS });

export async function GET(request: Request) {
  try {
    const { database, actor } = await requireOperator(request);
    if (!actor) return FORBIDDEN();
    const [hosts, policies] = await Promise.all([listKnownRemoteHosts(database), listFederationDomainPolicies()]);
    return NextResponse.json(
      { domains: mergeDomainPolicies(hosts, policies.ok ? policies.body.domains ?? [] : []), federationAvailable: policies.ok },
      { headers: PRIVATE_HEADERS },
    );
  } catch (error) {
    return failure(error);
  }
}

export async function PUT(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403, headers: PRIVATE_HEADERS });
  try {
    const { actor } = await requireOperator(request);
    if (!actor) return FORBIDDEN();
    const body = await request.json().catch(() => null) as { domain?: unknown; action?: unknown; reason?: unknown } | null;
    const domain = typeof body?.domain === "string" ? body.domain.trim().toLowerCase() : "";
    if (!domain || domain.length > 255 || !DOMAIN_PATTERN.test(domain) || !isValidPolicyAction(body?.action)
      || (body?.reason != null && (typeof body.reason !== "string" || body.reason.length > 500))) {
      return NextResponse.json({ error: "入力内容を確認してください。" }, { status: 400, headers: PRIVATE_HEADERS });
    }
    const result = await putFederationDomainPolicy({ domain, action: body.action, reason: typeof body.reason === "string" ? body.reason : "" });
    if (!result.ok) {
      return NextResponse.json({ error: "連合のサービスに反映できませんでした。", code: result.error }, { status: result.status >= 500 ? 502 : result.status, headers: PRIVATE_HEADERS });
    }
    return NextResponse.json({ updated: true, domain, action: body.action }, { headers: PRIVATE_HEADERS });
  } catch (error) {
    return failure(error);
  }
}
