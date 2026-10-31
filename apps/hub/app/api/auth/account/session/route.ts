import { NextResponse } from "next/server";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";

import { verifyHubAccountAssertion } from "@/lib/hub-account-assertion";
import { hasSignupConsent } from "@/lib/hub-consent";
import { signupConsentStatement } from "@/lib/server/hub-consent-records";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin, setHubSessionCookie } from "@/lib/server/hub-auth-route";
import { createHubSession } from "@/lib/server/hub-auth";
import { HUB_SESSION_COOKIE, hashHubSessionSecret, readCookie } from "@/lib/server/hub-session";

type Body = { assertion?: unknown; handle?: unknown; displayName?: unknown; acceptedTerms?: unknown; confirmedMinimumAge?: unknown };

const normalizeHandle = (value: unknown) =>
  typeof value === "string" ? value.normalize("NFKC").trim().toLocaleLowerCase("en-US") : "";
const normalizeDisplayName = (value: unknown) =>
  typeof value === "string" ? value.normalize("NFKC").trim() : "";

async function legacyProfileId(request: Request, database: D1Database): Promise<string | null> {
  const secret = readCookie(request.headers.get("cookie"), HUB_SESSION_COOKIE);
  if (!secret || secret.length < 32 || secret.length > 512) return null;
  const row = await database.prepare(
    "SELECT profile_id FROM sessions WHERE secret_hash=? AND revoked_at IS NULL AND expires_at>?"
  ).bind(await hashHubSessionSecret(secret), new Date().toISOString()).first<{ profile_id: string }>();
  return row?.profile_id ?? null;
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "cross_origin_request" }, { status: 403 });
  const body = await request.json().catch(() => null) as Body | null;
  if (!body || typeof body.assertion !== "string") {
    return NextResponse.json({ error: "invalid_assertion" }, { status: 400 });
  }
  const assertion = await verifyHubAccountAssertion(
    body.assertion,
    process.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? ""
  );
  if (!assertion) return NextResponse.json({ error: "invalid_assertion" }, { status: 401 });

  const database = getHubD1();
  const replay = await database.prepare("SELECT assertion_jti FROM account_assertion_replays WHERE assertion_jti=?")
    .bind(assertion.jti).first();
  if (replay) return NextResponse.json({ error: "assertion_replayed" }, { status: 409 });

  const existing = await database.prepare(
    `SELECT profile_id FROM account_profile_links WHERE pairwise_subject=?
      ORDER BY last_used_at DESC, linked_at ASC LIMIT 1`
  ).bind(assertion.sub).first<{ profile_id: string }>();
  const previousProfileId = await legacyProfileId(request, database);
  if (existing && previousProfileId && existing.profile_id !== previousProfileId) {
    return NextResponse.json({ error: "account_already_linked" }, { status: 409 });
  }

  let profileId = existing?.profile_id ?? previousProfileId;
  const handle = normalizeHandle(body.handle);
  const displayName = normalizeDisplayName(body.displayName);
  if (!profileId) {
    if (!/^[a-z0-9_]{3,32}$/u.test(handle) || displayName.length < 1 || displayName.length > 80) {
      return NextResponse.json({ error: "profile_details_required" }, { status: 400 });
    }
    /* 新しいプロフィールを作るときだけ、規約への同意と16歳以上の確認を求める（既存の利用者には求めない）。 */
    if (!hasSignupConsent(body)) {
      return NextResponse.json({ error: "signup_consent_required" }, { status: 400 });
    }
    if (await database.prepare("SELECT id FROM profiles WHERE handle=? COLLATE NOCASE").bind(handle).first()) {
      return NextResponse.json({ error: "handle_unavailable" }, { status: 409 });
    }
    profileId = crypto.randomUUID();
  }

  const now = new Date().toISOString();
  const session = await createHubSession();
  const statements: D1PreparedStatement[] = [];
  if (!existing && !previousProfileId) {
    statements.push(database.prepare(`INSERT INTO profiles (
      id,handle,display_name,bio,avatar_url,joined_at,created_at,updated_at
    ) VALUES (?,?,?,'',NULL,?,?,?)`).bind(profileId, handle, displayName, now, now, now));
    statements.push(signupConsentStatement(database, profileId, "account_signup", now));
  }
  statements.push(
    database.prepare(`INSERT INTO account_profile_links (
      pairwise_subject,profile_id,linked_at,last_authenticated_at,last_used_at
    ) VALUES (?,?,?,?,?) ON CONFLICT(pairwise_subject,profile_id) DO UPDATE SET
      last_authenticated_at=excluded.last_authenticated_at,
      last_used_at=excluded.last_used_at`)
      .bind(assertion.sub, profileId, now, now, now),
    database.prepare("INSERT INTO account_assertion_replays VALUES (?,?,?)")
      .bind(assertion.jti, new Date(assertion.exp * 1000).toISOString(), now),
    database.prepare(`INSERT INTO sessions (
      id,profile_id,secret_hash,created_at,last_seen_at,expires_at,revoked_at
    ) VALUES (?,?,?,?,?,?,NULL)`)
      .bind(session.id, profileId, session.secretHash, session.createdAt, session.createdAt, session.expiresAt)
  );
  await database.batch(statements);

  const response = NextResponse.json({ linked: true, migrated: Boolean(previousProfileId) });
  setHubSessionCookie(response, request, session.secret, session.expiresAt);
  return response;
}
