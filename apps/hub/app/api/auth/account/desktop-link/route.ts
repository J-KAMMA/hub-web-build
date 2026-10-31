import { NextResponse } from "next/server";

import { verifyDesktopLinkAssertion } from "@/lib/desktop-account-assertion";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "cross_origin_request" }, { status: 403 });
  const body = await request.json().catch(() => null) as { assertion?: unknown } | null;
  if (typeof body?.assertion !== "string") return NextResponse.json({ error: "invalid_assertion" }, { status: 400 });
  const assertion = await verifyDesktopLinkAssertion(body.assertion, process.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? "");
  if (!assertion) return NextResponse.json({ error: "invalid_assertion" }, { status: 401 });
  const database = getHubD1();
  let viewer;
  try { viewer = await requireHubSessionProfile(request, database); }
  catch (error) {
    if (error instanceof HubAuthenticationError) return NextResponse.json({ error: "hub_session_required" }, { status: 401 });
    throw error;
  }
  const [replay, hubBinding, desktopBinding] = await Promise.all([
    database.prepare("SELECT assertion_jti FROM account_assertion_replays WHERE assertion_jti=?").bind(assertion.jti).first(),
    database.prepare("SELECT profile_id FROM account_profile_links WHERE pairwise_subject=? AND profile_id=?")
      .bind(assertion.hubSub, viewer.id).first(),
    database.prepare("SELECT profile_id FROM desktop_account_profile_links WHERE desktop_pairwise_subject=?")
      .bind(assertion.sub).first<{ profile_id: string }>(),
  ]);
  if (replay) return NextResponse.json({ error: "assertion_replayed" }, { status: 409 });
  if (!hubBinding) return NextResponse.json({ error: "account_profile_mismatch" }, { status: 409 });
  if (desktopBinding && desktopBinding.profile_id !== viewer.id) {
    return NextResponse.json({ error: "desktop_binding_conflict" }, { status: 409 });
  }
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO desktop_account_profile_links
      (desktop_pairwise_subject,profile_id,linked_at,last_used_at) VALUES (?,?,?,?)
      ON CONFLICT(desktop_pairwise_subject) DO UPDATE SET last_used_at=excluded.last_used_at`)
      .bind(assertion.sub, viewer.id, now, now),
    database.prepare("INSERT INTO account_assertion_replays VALUES (?,?,?)")
      .bind(assertion.jti, new Date(assertion.exp * 1000).toISOString(), now),
  ]);
  return NextResponse.json({ linked: true });
}
