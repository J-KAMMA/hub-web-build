import { NextResponse } from "next/server";
import { getHubD1 } from "@/lib/server/hub-d1";

export async function GET(_request: Request, { params }: { params: Promise<{ communityId: string }> }) {
  const { communityId } = await params;
  const game = await getHubD1().prepare(`SELECT g.id, g.slug, g.title, g.summary, g.image_url, g.platforms, g.release_date
    FROM game_guide_community_links l JOIN game_guide_hubs g ON g.id = l.game_id
    WHERE l.community_id = ? AND g.status = 'published' ORDER BY l.linked_at DESC LIMIT 1`)
    .bind(communityId).first();
  return NextResponse.json({ game: game ?? null });
}
