import "server-only";

import type { D1Database } from "@cloudflare/workers-types";

import type { Profile } from "@/lib/domain";

export type GameSubmissionInput = {
  title: string;
  slug: string;
  aliases: string[];
  summary: string;
  officialUrl?: string;
  platforms: string[];
  releaseDate?: string;
  communityId?: string;
};

export class GameSubmissionConflictError extends Error {
  constructor(public readonly existing: { id: string; slug: string; title: string; status: string }) {
    super("同じ作品の可能性があるゲームがすでに登録されています。");
  }
}

export async function createD1GameGuideSubmission(
  database: D1Database,
  actor: Profile,
  input: GameSubmissionInput,
) {
  const duplicate = await database.prepare(`SELECT id, slug, title, status FROM game_guide_hubs
    WHERE slug = ? OR lower(title) = lower(?) OR (? IS NOT NULL AND official_url = ?)
    LIMIT 1`).bind(input.slug, input.title, input.officialUrl ?? null, input.officialUrl ?? null)
    .first<{ id: string; slug: string; title: string; status: string }>();
  if (duplicate) throw new GameSubmissionConflictError(duplicate);

  if (input.communityId) {
    const membership = await database.prepare(`SELECT role FROM community_memberships
      WHERE community_id = ? AND profile_id = ? AND status = 'active' LIMIT 1`)
      .bind(input.communityId, actor.id)
      .first<{ role: "owner" | "moderator" | "member" }>();
    if (!membership || !["owner", "moderator"].includes(membership.role)) {
      throw new Error("コミュニティを作品に紐付けられるのは管理者だけです。");
    }
  }

  const id = `game-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const statements = [
    database.prepare(`INSERT INTO game_guide_hubs
      (id, slug, title, summary, status, aliases, official_url, platforms, release_date,
       created_by_profile_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.slug, input.title, input.summary, JSON.stringify(input.aliases), input.officialUrl ?? null, JSON.stringify(input.platforms), input.releaseDate ?? null, actor.id, now, now),
    database.prepare(`INSERT INTO game_guide_submission_audit
      (id, game_id, actor_profile_id, action, detail, created_at)
      VALUES (?, ?, ?, 'submitted', ?, ?)`)
      .bind(crypto.randomUUID(), id, actor.id, input.communityId ?? "", now),
  ];
  if (input.communityId) {
    statements.push(
      database.prepare(`INSERT INTO game_guide_community_links
        (game_id, community_id, role, linked_at, approved_at) VALUES (?, ?, 'maintainer', ?, ?)`)
        .bind(id, input.communityId, now, now),
      database.prepare(`INSERT INTO game_guide_submission_audit
        (id, game_id, actor_profile_id, action, detail, created_at)
        VALUES (?, ?, ?, 'community_linked', ?, ?)`)
        .bind(crypto.randomUUID(), id, actor.id, input.communityId, now),
    );
  }
  await database.batch(statements);
  return { id, ...input, status: "pending" as const, createdAt: now };
}

export async function findD1GameGuideCandidates(database: D1Database, query: string) {
  const normalized = `%${query.trim().slice(0, 80)}%`;
  const result = await database.prepare(`SELECT id, slug, title, summary, status
    FROM game_guide_hubs WHERE title LIKE ? OR aliases LIKE ? OR slug LIKE ?
    ORDER BY CASE status WHEN 'published' THEN 0 ELSE 1 END, updated_at DESC LIMIT 8`)
    .bind(normalized, normalized, normalized)
    .all<{ id: string; slug: string; title: string; summary: string; status: "pending" | "published" | "rejected" }>();
  return result.results ?? [];
}
