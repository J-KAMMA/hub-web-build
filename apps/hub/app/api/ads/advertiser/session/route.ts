import { NextResponse } from "next/server";
import { verifyHubAdsAccountAssertion } from "@/lib/hub-ads-account-assertion";
import { getHubD1 } from "@/lib/server/hub-d1";
import { acceptHubAdPolicy, opaqueSubjectHash } from "@/lib/server/hub-ads-policy";
import { requireSameOrigin } from "@/lib/server/moderation-admin-auth";
import { advertiserSessionFromRequest, createHubAdsAdvertiserSession, HUB_ADVERTISER_SESSION_COOKIE } from "@/lib/server/hub-ads-advertiser-session";

export async function GET(request: Request) {
  const session = advertiserSessionFromRequest(request);
  if (!session) return NextResponse.json({ authenticated: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const advertiser = await getHubD1().prepare(`SELECT advertiser_ref advertiserRef, status, policy_version policyVersion,
    policy_accepted_at policyAcceptedAt FROM hub_ad_advertisers WHERE advertiser_ref=?`).bind(session.advertiserRef).first();
  return advertiser ? NextResponse.json({ authenticated: true, advertiser }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ authenticated: false }, { status: 401 });
}

export async function DELETE(request: Request) {
  const originError = requireSameOrigin(request); if (originError) return originError;
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(HUB_ADVERTISER_SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 0 });
  return response;
}

export async function POST(request: Request) {
  const originError = requireSameOrigin(request); if (originError) return originError;
  const body = await request.json().catch(() => null) as { assertion?: unknown; acceptPolicy?: unknown } | null;
  if (body?.acceptPolicy !== true || typeof body.assertion !== "string") return NextResponse.json({ error: "policy_acceptance_required" }, { status: 400 });
  const assertion = await verifyHubAdsAccountAssertion(body.assertion, process.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? "");
  const subjectHash = assertion && opaqueSubjectHash(assertion.sub, process.env.HUB_ADS_ADVERTISER_SUBJECT_SECRET ?? "");
  if (!assertion || !subjectHash) return NextResponse.json({ error: "invalid_account_assertion" }, { status: 401 });
  const database = getHubD1(); const existing = await database.prepare("SELECT advertiser_ref advertiserRef FROM hub_ad_advertisers WHERE access_subject_hash=?").bind(subjectHash).first<{ advertiserRef: string }>();
  const advertiserRef = existing?.advertiserRef ?? `adv_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  try {
    await database.batch([
      database.prepare("INSERT INTO hub_ad_assertion_replay(jti,consumed_at,expires_at) VALUES(?,?,?)").bind(assertion.jti, Date.now(), assertion.exp * 1000),
      database.prepare("DELETE FROM hub_ad_assertion_replay WHERE expires_at < ?").bind(Date.now()),
    ]);
  } catch { return NextResponse.json({ error: "assertion_replayed" }, { status: 409 }); }
  await acceptHubAdPolicy(database, advertiserRef, subjectHash);
  const token = createHubAdsAdvertiserSession(advertiserRef);
  if (!token) return NextResponse.json({ error: "advertiser_session_unavailable" }, { status: 503 });
  const response = NextResponse.json({ advertiserRef, status: existing ? "linked" : "pending_review" }, { status: existing ? 200 : 201, headers: { "Cache-Control": "no-store" } });
  response.cookies.set(HUB_ADVERTISER_SESSION_COOKIE, token, { httpOnly: true, sameSite: "strict", secure: new URL(request.url).protocol === "https:", path: "/", maxAge: 60 * 60 });
  return response;
}
