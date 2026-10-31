import { NextResponse } from "next/server";
import type { D1Database } from "@cloudflare/workers-types";

import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1 } from "@/lib/server/hub-d1";
import {
  HUB_SESSION_COOKIE,
  HubAuthenticationError,
  hashHubSessionSecret,
  readCookie,
  requireHubSessionProfile,
} from "@/lib/server/hub-session";

async function accountSubjectForProfile(database: D1Database, profileId: string) {
  return database.prepare(
    "SELECT pairwise_subject FROM account_profile_links WHERE profile_id=? LIMIT 1"
  ).bind(profileId).first<{ pairwise_subject: string }>();
}

export async function GET(request: Request) {
  try {
    const database = getHubD1();
    const current = await requireHubSessionProfile(request, database);
    const owner = await accountSubjectForProfile(database, current.id);
    if (!owner) {
      return NextResponse.json({
        currentProfileId: current.id,
        profiles: [{ ...current, profileKind: "online", contextLabel: "" }],
        canCreate: false,
      }, { headers: { "cache-control": "no-store" } });
    }
    const result = await database.prepare(`SELECT
        p.id, p.handle, p.display_name AS displayName, p.avatar_url AS avatarUrl,
        COALESCE(c.profile_kind, 'online') AS profileKind,
        COALESCE(c.label, '') AS contextLabel
      FROM account_profile_links l
      JOIN profiles p ON p.id=l.profile_id
      LEFT JOIN hub_profile_contexts c ON c.profile_id=p.id
      WHERE l.pairwise_subject=?
      ORDER BY l.last_used_at DESC, l.linked_at ASC`)
      .bind(owner.pairwise_subject).all();
    return NextResponse.json(
      { currentProfileId: current.id, profiles: result.results, canCreate: true },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const current = await requireHubSessionProfile(request, database);
    const body = await request.json().catch(() => null) as { profileId?: unknown } | null;
    const profileId = typeof body?.profileId === "string" ? body.profileId : "";
    if (!profileId || profileId.length > 100) {
      return NextResponse.json({ error: "invalid_profile" }, { status: 400 });
    }
    const owner = await accountSubjectForProfile(database, current.id);
    if (!owner) return NextResponse.json({ error: "profile_switch_unavailable" }, { status: 409 });
    const target = await database.prepare(`SELECT p.id, p.handle, p.display_name AS displayName
      FROM account_profile_links l JOIN profiles p ON p.id=l.profile_id
      WHERE l.pairwise_subject=? AND l.profile_id=? LIMIT 1`)
      .bind(owner.pairwise_subject, profileId)
      .first<{ id: string; handle: string; displayName: string }>();
    if (!target) return NextResponse.json({ error: "profile_not_owned" }, { status: 403 });

    const secret = readCookie(request.headers.get("cookie"), HUB_SESSION_COOKIE);
    if (!secret) throw new HubAuthenticationError();
    const now = new Date().toISOString();
    const result = await database.prepare(`UPDATE sessions SET profile_id=?, last_seen_at=?
      WHERE secret_hash=? AND profile_id=? AND revoked_at IS NULL AND expires_at>?`)
      .bind(profileId, now, await hashHubSessionSecret(secret), current.id, now).run();
    if (!result.meta.changes) {
      return NextResponse.json({ error: "session_changed" }, { status: 409 });
    }
    await database.prepare(`UPDATE account_profile_links SET last_used_at=?
      WHERE pairwise_subject=? AND profile_id=?`).bind(now, owner.pairwise_subject, profileId).run();
    return NextResponse.json({ switched: true, profile: target }, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "untrusted_origin" }, { status: 403 });
  }
  try {
    const database = getHubD1();
    const current = await requireHubSessionProfile(request, database);
    const owner = await accountSubjectForProfile(database, current.id);
    if (!owner) return NextResponse.json({ error: "account_link_required" }, { status: 409 });
    const body = await request.json().catch(() => null) as {
      handle?: unknown; displayName?: unknown; contextLabel?: unknown;
    } | null;
    const handle = typeof body?.handle === "string"
      ? body.handle.normalize("NFKC").trim().toLocaleLowerCase("en-US") : "";
    const displayName = typeof body?.displayName === "string"
      ? body.displayName.normalize("NFKC").trim() : "";
    const profileKind = "online";
    const contextLabel = typeof body?.contextLabel === "string"
      ? body.contextLabel.normalize("NFKC").trim().slice(0, 40) : "";
    if (!/^[a-z0-9_]{3,32}$/u.test(handle) || !displayName || displayName.length > 80) {
      return NextResponse.json({ error: "invalid_profile_details" }, { status: 400 });
    }
    if (await database.prepare("SELECT 1 FROM profiles WHERE handle=? COLLATE NOCASE").bind(handle).first()) {
      return NextResponse.json({ error: "handle_unavailable" }, { status: 409 });
    }
    const count = await database.prepare(
      "SELECT COUNT(*) AS count FROM account_profile_links WHERE pairwise_subject=?"
    ).bind(owner.pairwise_subject).first<{ count: number }>();
    if (Number(count?.count ?? 0) >= 5) {
      return NextResponse.json({ error: "profile_limit_reached" }, { status: 409 });
    }
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await database.batch([
      database.prepare(`INSERT INTO profiles
        (id,handle,display_name,bio,avatar_url,joined_at,created_at,updated_at)
        VALUES (?,?,?,'',NULL,?,?,?)`).bind(id, handle, displayName, now, now, now),
      database.prepare(`INSERT INTO account_profile_links
        (pairwise_subject,profile_id,linked_at,last_authenticated_at,last_used_at)
        VALUES (?,?,?,?,?)`).bind(owner.pairwise_subject, id, now, now, now),
      database.prepare(`INSERT INTO hub_profile_contexts
        (profile_id,profile_kind,label,created_at,updated_at) VALUES (?,?,?,?,?)`)
        .bind(id, profileKind, contextLabel, now, now),
    ]);
    return NextResponse.json({ created: true, profile: { id, handle, displayName, profileKind, contextLabel } }, {
      status: 201,
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "authentication_required" }, { status: 401 });
    }
    throw error;
  }
}
