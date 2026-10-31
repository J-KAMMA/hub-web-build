import { NextResponse } from "next/server";
import type { D1PreparedStatement } from "@cloudflare/workers-types";

import { verifyHubAccountAssertion } from "@/lib/hub-account-assertion";
import { getHubD1 } from "@/lib/server/hub-d1";
import { hasSameOrigin, setHubSessionCookie } from "@/lib/server/hub-auth-route";
import { createHubSession } from "@/lib/server/hub-auth";

const tokenHash = async (token: string) => {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
};

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "cross_origin_request" }, { status: 403 });
  const body = await request.json().catch(() => null) as { assertion?: unknown; token?: unknown } | null;
  if (typeof body?.assertion !== "string" || typeof body.token !== "string" || body.token.length < 32 || body.token.length > 256) {
    return NextResponse.json({ error: "invalid_profile_recovery" }, { status: 400 });
  }
  const assertion = await verifyHubAccountAssertion(body.assertion, process.env.ACCOUNT_ASSERTION_PUBLIC_KEY_SPKI ?? "");
  if (!assertion) return NextResponse.json({ error: "invalid_assertion" }, { status: 401 });

  const database = getHubD1();
  const now = new Date().toISOString();
  const recoveryTokenHash = await tokenHash(body.token);
  const recovery = await database.prepare(`SELECT profile_id FROM profile_recovery_claims
    WHERE token_hash=? AND used_at IS NULL AND consumption_jti IS NULL AND expires_at>?`)
    .bind(recoveryTokenHash, now).first<{ profile_id: string }>();
  if (!recovery) return NextResponse.json({ error: "profile_recovery_expired" }, { status: 410 });
  const linked = await database.prepare("SELECT 1 FROM account_profile_links WHERE profile_id=? LIMIT 1").bind(recovery.profile_id).first();
  if (linked) return NextResponse.json({ error: "profile_already_linked" }, { status: 409 });
  const replay = await database.prepare("SELECT 1 FROM account_assertion_replays WHERE assertion_jti=?").bind(assertion.jti).first();
  if (replay) return NextResponse.json({ error: "assertion_replayed" }, { status: 409 });

  const session = await createHubSession();
  const consumptionJti = crypto.randomUUID();
  const statements: D1PreparedStatement[] = [
    database.prepare(`UPDATE profile_recovery_claims SET used_at=?,consumption_jti=?
      WHERE token_hash=? AND profile_id=? AND used_at IS NULL AND consumption_jti IS NULL AND expires_at>?`)
      .bind(now, consumptionJti, recoveryTokenHash, recovery.profile_id, now),
    database.prepare(`INSERT INTO account_profile_links
      (pairwise_subject,profile_id,linked_at,last_authenticated_at,last_used_at)
      SELECT ?,profile_id,?,?,? FROM profile_recovery_claims
      WHERE token_hash=? AND profile_id=? AND consumption_jti=?`)
      .bind(assertion.sub, now, now, now, recoveryTokenHash, recovery.profile_id, consumptionJti),
    database.prepare(`INSERT INTO account_assertion_replays(assertion_jti,expires_at,consumed_at)
      SELECT ?,?,? FROM profile_recovery_claims
      WHERE token_hash=? AND profile_id=? AND consumption_jti=?`)
      .bind(assertion.jti, new Date(assertion.exp * 1000).toISOString(), now,
        recoveryTokenHash, recovery.profile_id, consumptionJti),
    database.prepare(`INSERT INTO sessions
      (id,profile_id,secret_hash,created_at,last_seen_at,expires_at,revoked_at)
      SELECT ?,profile_id,?,?,?,?,NULL FROM profile_recovery_claims
      WHERE token_hash=? AND profile_id=? AND consumption_jti=?`)
      .bind(session.id, session.secretHash, session.createdAt, session.createdAt, session.expiresAt,
        recoveryTokenHash, recovery.profile_id, consumptionJti),
  ];
  const results = await database.batch(statements);
  if ((results[0].meta.changes ?? 0) !== 1) {
    return NextResponse.json({ error: "profile_recovery_expired" }, { status: 410 });
  }
  if (results.some((result) => (result.meta.changes ?? 0) !== 1)) {
    return NextResponse.json({ error: "profile_recovery_state_unknown" }, { status: 503 });
  }
  const response = NextResponse.json({ recovered: true });
  setHubSessionCookie(response, request, session.secret, session.expiresAt);
  return response;
}
