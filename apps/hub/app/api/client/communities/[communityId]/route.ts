import { NextResponse } from "next/server";

import { getOptionalHubD1 } from "@/lib/server/hub-d1";
import { getOptionalHubViewerProfile } from "@/lib/server/desktop-hub-auth";
import { getD1CommunityMembershipState } from "@/lib/server/d1-community-management";
import { listD1CommunityChannels } from "@/lib/server/d1-community-channels";
import { HubSuspendedError } from "@/lib/server/hub-session";

/**
 * クライアント向けのコミュニティ詳細。本体・自分の参加状態・
 * チャンネル一覧を1往復で返す。未接続でも公開コミュニティは
 * 読める（membership は null）。
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ communityId: string }> },
) {
  const { communityId } = await params;
  if (typeof communityId !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(communityId)) {
    return NextResponse.json({ error: "コミュニティの指定が正しくありません。" }, { status: 400 });
  }
  const database = getOptionalHubD1();
  if (!database) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
  try {
    const viewer = await getOptionalHubViewerProfile(request, database);
    const community = await database.prepare(
      `SELECT id, slug, name, description, category,
        image_url AS imageUrl, visibility, owner_profile_id AS ownerProfileId,
        governance_mode AS governanceMode,
        knowledge_label AS knowledgeLabel,
        knowledge_description AS knowledgeDescription,
        created_at AS createdAt,
        (SELECT count(*) FROM community_memberships m
          WHERE m.community_id = communities.id AND m.status = 'active') AS memberCount
        FROM communities
        WHERE id = ? AND lifecycle_status = 'active'
          AND (
            visibility IN ('public', 'approval')
            OR (? IS NOT NULL AND EXISTS (
              SELECT 1 FROM community_memberships membership
              WHERE membership.community_id = communities.id
                AND membership.profile_id = ?
                AND membership.status <> 'banned'
            ))
          )
        LIMIT 1`,
    ).bind(communityId, viewer?.id ?? null, viewer?.id ?? null).first();
    if (!community) {
      return NextResponse.json({ error: "コミュニティが見つかりません。" }, { status: 404 });
    }
    const [membership, channels] = await Promise.all([
      viewer
        ? getD1CommunityMembershipState(database, viewer.id, communityId)
        : Promise.resolve(null),
      listD1CommunityChannels(database, communityId, viewer?.id ?? null),
    ]);
    const role = viewer ? await database.prepare("SELECT role, status FROM community_memberships WHERE community_id = ? AND profile_id = ?").bind(communityId, viewer.id).first<{ role: string; status: string }>() : null;
    return NextResponse.json(
      { community, membership, channels, viewerId: viewer?.id ?? null, viewerRole: role?.role ?? null, viewerStatus: role?.status ?? null, canManage: role?.status === "active" && (role.role === "owner" || role.role === "moderator") },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof HubSuspendedError) {
      return NextResponse.json({ error: "suspended" }, { status: 403 });
    }
    throw error;
  }
}
