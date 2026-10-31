import type { D1Database } from "@cloudflare/workers-types";

/*
 * データの書き出しに足す項目（2026-10-17、AUDIT.md 8.3-2）。
 * 本人が書いたもの・本人の設定・本人とのやり取りを返す。
 *
 * - 他人のプロフィールIDは出さない。相手は表示名（と公開の handle）で示す。
 *   DM の相手は表示名だけにする。
 * - DM は本人が送ったものと受け取ったもの。相手の書いた文は本人が受け取った範囲に限る。
 * - ウォレットは設定の画面で本人が見ている連携中のものだけ。これは本人のダウンロードで、
 *   引っ越しの束（hub.account.bundle）には入れない。
 * - 問い合わせが1つでも失敗したら書き出し全体を失敗にする。黙って空の欄を返さない。
 */
type Row = Record<string, unknown>;

async function rows<T = Row>(database: D1Database, query: string, ...values: unknown[]): Promise<T[]> {
  const result = await database.prepare(query).bind(...values).all<T>();
  return (result.results ?? []) as T[];
}

export async function readOwnSocialExport(database: D1Database, profileId: string) {
  const [
    directMessages,
    reactions,
    articleCommentLikes,
    videoLikes,
    videoCommentLikes,
    lists,
    listMembers,
    listThreads,
    listWords,
    mutedTerms,
    notificationPreferences,
    directMessagePreferences,
    notifications,
    communityMemberships,
    articleComments,
    walletLinks,
    controls,
    remoteFollows,
  ] = await Promise.all([
    rows<{ conversation_id: string; from_me: number; counterpart_display_name: string | null; body: string; created_at: string }>(
      database,
      `SELECT m.conversation_id,
              CASE WHEN m.sender_profile_id = ?1 THEN 1 ELSE 0 END AS from_me,
              (SELECT p.display_name FROM conversation_participants cp JOIN profiles p ON p.id = cp.profile_id
                WHERE cp.conversation_id = m.conversation_id AND cp.profile_id <> ?1 LIMIT 1) AS counterpart_display_name,
              m.preview_text AS body, m.created_at
         FROM direct_messages m
         JOIN conversation_participants me ON me.conversation_id = m.conversation_id AND me.profile_id = ?1
        WHERE m.encryption_state = 'sealed'
        ORDER BY m.created_at, m.id`,
      profileId,
    ),
    rows(database, "SELECT target_type, target_id, kind, created_at FROM reactions WHERE profile_id = ? ORDER BY created_at", profileId),
    rows(database, "SELECT comment_id, created_at FROM hub_user_article_comment_likes WHERE profile_id = ? ORDER BY created_at", profileId),
    rows(database, "SELECT video_id, created_at FROM video_likes WHERE profile_id = ? ORDER BY created_at", profileId),
    rows(database, "SELECT comment_id, created_at FROM video_thread_comment_likes WHERE profile_id = ? ORDER BY created_at", profileId),
    rows<{ id: string }>(database, "SELECT id, name, description, visibility, kind, sort_order, created_at, updated_at FROM user_lists WHERE owner_profile_id = ? ORDER BY sort_order, created_at", profileId),
    rows<{ list_id: string }>(
      database,
      `SELECT lp.list_id, p.handle, p.display_name, lp.position, lp.added_at
         FROM list_profiles lp JOIN user_lists l ON l.id = lp.list_id JOIN profiles p ON p.id = lp.profile_id
        WHERE l.owner_profile_id = ? ORDER BY lp.list_id, lp.position`,
      profileId,
    ),
    rows<{ list_id: string }>(
      database,
      `SELECT lt.list_id, lt.thread_id, lt.position, lt.added_at
         FROM list_threads lt JOIN user_lists l ON l.id = lt.list_id
        WHERE l.owner_profile_id = ? ORDER BY lt.list_id, lt.position`,
      profileId,
    ),
    rows<{ list_id: string }>(
      database,
      `SELECT lw.list_id, lw.word, lw.position, lw.added_at
         FROM list_words lw JOIN user_lists l ON l.id = lw.list_id
        WHERE l.owner_profile_id = ? ORDER BY lw.list_id, lw.position`,
      profileId,
    ),
    rows(database, "SELECT term, created_at FROM profile_muted_terms WHERE profile_id = ? ORDER BY created_at, term", profileId),
    rows(
      database,
      `SELECT replies_enabled, reactions_enabled, follows_enabled, messages_enabled,
              commerce_payments_enabled, commerce_delivery_enabled, commerce_returns_enabled, updated_at
         FROM notification_preferences WHERE profile_id = ?`,
      profileId,
    ),
    rows(database, "SELECT receive_policy, updated_at FROM direct_message_preferences WHERE profile_id = ?", profileId),
    rows(
      database,
      `SELECT n.id, n.notification_type, n.target_type, n.target_id, n.text, n.is_read, n.aggregation_count,
              n.created_at, n.last_event_at, a.display_name AS actor_display_name
         FROM notifications n LEFT JOIN profiles a ON a.id = n.actor_profile_id
        WHERE n.receiver_profile_id = ? ORDER BY n.created_at, n.id`,
      profileId,
    ),
    rows(
      database,
      `SELECT c.slug AS community_slug, c.name AS community_name, m.role, m.status, m.profile_visibility, m.joined_at
         FROM community_memberships m JOIN communities c ON c.id = m.community_id
        WHERE m.profile_id = ? ORDER BY m.joined_at`,
      profileId,
    ),
    rows(
      database,
      `SELECT id, article_id, parent_id, body, status, created_at, removed_at
         FROM hub_user_article_comments WHERE author_profile_id = ? ORDER BY created_at, id`,
      profileId,
    ),
    rows(
      database,
      `SELECT chain_id, network, wallet_address, visibility, tips_enabled, minimum_tip_wei, verified_at, created_at
         FROM profile_wallet_links WHERE profile_id = ? AND active = 1 ORDER BY created_at`,
      profileId,
    ),
    rows<{ handle: string; display_name: string; muted: number; blocked: number; updated_at: string }>(
      database,
      `SELECT p.handle, p.display_name, c.muted, c.blocked, c.updated_at
         FROM thread_user_controls c JOIN profiles p ON p.id = c.target_profile_id
        WHERE c.owner_profile_id = ? AND (c.muted = 1 OR c.blocked = 1) ORDER BY c.updated_at`,
      profileId,
    ),
    rows(
      database,
      `SELECT r.actor_url, r.handle, r.host, f.state, f.created_at, f.updated_at
         FROM remote_follows f JOIN remote_actor_profiles r ON r.profile_id = f.remote_profile_id
        WHERE f.follower_profile_id = ? ORDER BY f.created_at`,
      profileId,
    ),
  ]);

  const byList = <T extends { list_id: string }>(items: T[], listId: string) =>
    items.filter((item) => item.list_id === listId).map(({ list_id: _listId, ...rest }) => rest);

  return {
    directMessages: directMessages.map((row) => ({ ...row, from_me: row.from_me === 1 })),
    likes: { reactions, articleCommentLikes, videoLikes, videoCommentLikes },
    lists: lists.map((list) => ({
      ...list,
      members: byList(listMembers, list.id),
      threads: byList(listThreads, list.id),
      words: byList(listWords, list.id),
    })),
    mutedTerms,
    notificationSettings: {
      notifications: notificationPreferences[0] ?? null,
      directMessages: directMessagePreferences[0] ?? null,
    },
    notifications,
    communityMemberships,
    articleComments,
    walletLinks,
    blockedProfiles: controls.filter((row) => row.blocked === 1).map(({ handle, display_name, updated_at }) => ({ handle, display_name, updated_at })),
    mutedProfiles: controls.filter((row) => row.muted === 1 && row.blocked !== 1).map(({ handle, display_name, updated_at }) => ({ handle, display_name, updated_at })),
    remoteFollows,
  };
}
