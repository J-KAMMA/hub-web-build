import { AdminAccessRequired } from "@/components/admin-access-required";
import { cookies } from "next/headers";
import { GameReviewQueue } from "@/components/game-review-queue";
import { getHubD1 } from "@/lib/server/hub-d1";
import { isModerationAdminToken, MODERATION_ADMIN_COOKIE } from "@/lib/server/moderation-admin-auth";

export const dynamic = "force-dynamic";
export default async function AdminGamesPage() {
  const cookieStore = await cookies();
  if (!isModerationAdminToken(cookieStore.get(MODERATION_ADMIN_COOKIE)?.value)) return <AdminAccessRequired />;
  const database = getHubD1();
  const [result, proposals] = await Promise.all([
    database.prepare(`SELECT id, title, summary, platforms, official_url, created_at FROM game_guide_hubs WHERE status = 'pending' ORDER BY created_at`).all<{ id: string; title: string; summary: string; platforms: string; official_url: string | null; created_at: string }>(),
    database.prepare(`SELECT e.id, e.proposed_fields, e.reason, e.created_at, g.title AS game_title FROM game_guide_edit_proposals e JOIN game_guide_hubs g ON g.id = e.game_id WHERE e.status = 'pending' ORDER BY e.created_at`).all<{ id: string; game_title: string; proposed_fields: string; reason: string; created_at: string }>(),
  ]);
  return <div className="games-catalog"><GameReviewQueue initialGames={result.results ?? []} initialProposals={proposals.results ?? []} /></div>;
}
