import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";
import { requireDesktopHubProfile } from "@/lib/server/desktop-hub-auth";
import { getD1CommunityPageData } from "@/lib/server/d1-community-page-data";
import { memberManagementErrorResponse, memberManagementHeaders } from "@/lib/server/community-member-management-response";

export async function GET(request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(communityId)) return NextResponse.json({ error: "指定が正しくありません。" }, { status: 400, headers: memberManagementHeaders });
  try {
    const database = getHubD1();
    const viewer = await requireDesktopHubProfile(request, database);
    const data = await getD1CommunityPageData(database, communityId, { viewer });
    const community = data.communities.find(item => item.id === communityId);
    if (!community) return NextResponse.json({ error: "コミュニティが見つかりません。" }, { status: 404, headers: memberManagementHeaders });
    const members = data.members.filter(member => community.memberIds.includes(member.id)).map(member => ({
      ...member, role: community.memberRoles[member.id], status: community.memberStatuses?.[member.id] ?? "active",
    }));
    const viewerRole = community.memberRoles[viewer.id] ?? null;
    const canManage = (community.memberStatuses?.[viewer.id] ?? "active") === "active" && (viewerRole === "owner" || viewerRole === "moderator");
    return NextResponse.json({ communityId, members, viewerId: viewer.id, viewerRole, canManage }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return memberManagementErrorResponse(error); }
}
