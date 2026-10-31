import type { D1Database } from "@cloudflare/workers-types";

export async function applyCommunityAutoRoles(database: D1Database, communityId: string) {
  const rules = await database.prepare(`SELECT id, role_id AS roleId, criterion, threshold, token_id AS tokenId
    FROM community_role_auto_rules WHERE community_id = ? AND enabled = 1`).bind(communityId)
    .all<{ id: string; roleId: string; criterion: string; threshold: string; tokenId: string | null }>();
  const now = new Date().toISOString();
  for (const rule of rules.results) {
    const threshold = Math.max(0, Number(rule.threshold) || 0);
    let qualified: Array<{ profileId: string }> = [];
    if (rule.criterion === "membership_days") {
      qualified = (await database.prepare(`SELECT profile_id AS profileId FROM community_memberships
        WHERE community_id = ? AND status = 'active' AND julianday('now') - julianday(joined_at) >= ?`).bind(communityId, threshold).all<{ profileId: string }>()).results;
    } else if (rule.criterion === "message_count") {
      qualified = (await database.prepare(`SELECT m.author_profile_id AS profileId FROM community_channel_messages m
        JOIN community_channels c ON c.id = m.channel_id WHERE c.community_id = ? GROUP BY m.author_profile_id HAVING count(*) >= ?`).bind(communityId, threshold).all<{ profileId: string }>()).results;
    } else if (rule.criterion === "guide_contributions") {
      qualified = (await database.prepare(`SELECT author_profile_id AS profileId FROM community_guide_proposals
        WHERE community_id = ? AND status = 'merged' GROUP BY author_profile_id HAVING count(*) >= ?`).bind(communityId, threshold).all<{ profileId: string }>()).results;
    } else if (rule.criterion === "token_balance" && rule.tokenId) {
      qualified = (await database.prepare(`SELECT b.profile_id AS profileId FROM token_balances b
        JOIN community_tokens t ON t.symbol = b.symbol COLLATE NOCASE WHERE t.id = ? AND t.community_id = ? AND b.amount >= ?`)
        .bind(rule.tokenId, communityId, threshold).all<{ profileId: string }>()).results;
    }
    if (qualified.length) await database.batch(qualified.map((item) => database.prepare(`INSERT OR IGNORE INTO community_member_custom_roles
      (community_id, profile_id, role_id, assigned_at, assigned_by_profile_id)
      SELECT ?, ?, ?, ?, owner_profile_id FROM communities WHERE id = ?`).bind(communityId, item.profileId, rule.roleId, now, communityId)));
  }
}
