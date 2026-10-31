import { NextResponse } from "next/server";

import { parseHubOnboardingInput } from "@/lib/onboarding";
import { hasSameOrigin } from "@/lib/server/hub-auth-route";
import { getHubD1, HubD1UnavailableError } from "@/lib/server/hub-d1";
import { HubAuthenticationError, requireHubSessionProfile } from "@/lib/server/hub-session";

function setFeedPreference(response: NextResponse, request: Request) {
  response.cookies.set("hub.home.feed", "following", {
    httpOnly: false,
    sameSite: "lax",
    secure: new URL(request.url).protocol === "https:",
    path: "/",
    maxAge: 365 * 24 * 60 * 60
  });
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return NextResponse.json({ error: "不正なリクエストです。" }, { status: 403 });
  }

  try {
    const input = parseHubOnboardingInput(await request.json().catch(() => null));
    const database = getHubD1();
    const viewer = await requireHubSessionProfile(request, database);
    const now = new Date().toISOString();
    const statements = [
      database.prepare(`INSERT INTO profile_onboarding (profile_id, interests_json, completed_at, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET interests_json = excluded.interests_json, completed_at = excluded.completed_at, updated_at = excluded.updated_at`)
        .bind(viewer.id, JSON.stringify(input.interests), now, now),
      ...input.profileIds.map((profileId) =>
        database.prepare(`INSERT OR IGNORE INTO follows (follower_profile_id, followed_profile_id, created_at)
          SELECT ?, candidate.id, ? FROM profiles candidate WHERE candidate.id = ? AND candidate.id <> ?
            AND NOT EXISTS (
              SELECT 1 FROM thread_user_controls control
              WHERE control.blocked = 1 AND (
                (control.owner_profile_id = ? AND control.target_profile_id = candidate.id)
                OR (control.owner_profile_id = candidate.id AND control.target_profile_id = ?)
              )
            )`)
          .bind(viewer.id, now, profileId, viewer.id, viewer.id, viewer.id)
      ),
      ...input.communityIds.map((communityId) =>
        database.prepare(`INSERT OR IGNORE INTO community_memberships
            (community_id, profile_id, role, status, joined_at)
          SELECT id, ?, 'member', 'active', ? FROM communities WHERE id = ?`)
          .bind(viewer.id, now, communityId)
      )
    ];
    await database.batch(statements);

    const response = NextResponse.json({ saved: true, next: "/?feed=following" });
    setFeedPreference(response, request);
    return response;
  } catch (error) {
    if (error instanceof HubAuthenticationError) {
      return NextResponse.json({ error: "ログインが必要です。" }, { status: 401 });
    }
    if (error instanceof HubD1UnavailableError) {
      return NextResponse.json(
        { error: "オンボーディングを保存できません。しばらくしてから再度お試しください。" },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "オンボーディングを保存できませんでした。" },
      { status: 400 }
    );
  }
}
