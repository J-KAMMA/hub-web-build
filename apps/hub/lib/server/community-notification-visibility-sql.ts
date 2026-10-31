export const COMMUNITY_NOTIFICATION_VISIBILITY_SCOPE = `
    AND NOT EXISTS (
      SELECT 1 FROM community_notification_events community_event
      WHERE community_event.notification_id = notifications.id
        AND (
          NOT EXISTS (
            SELECT 1 FROM community_memberships membership
            WHERE membership.community_id = community_event.community_id
              AND membership.profile_id = notifications.receiver_profile_id
              AND membership.status = 'active'
          )
          OR EXISTS (
            SELECT 1 FROM community_notification_preferences preference
            WHERE preference.community_id = community_event.community_id
              AND preference.profile_id = notifications.receiver_profile_id
              AND (
                (community_event.event_kind = 'reply' AND preference.replies = 0)
                OR (community_event.event_kind = 'mention' AND preference.mentions = 0)
              )
          )
          OR EXISTS (
            SELECT 1 FROM community_channel_notification_preferences channel_preference
            WHERE channel_preference.channel_id = community_event.channel_id
              AND channel_preference.profile_id = notifications.receiver_profile_id
              AND (
                channel_preference.mode = 'none'
                OR (
                  channel_preference.muted_until IS NOT NULL
                  AND julianday(channel_preference.muted_until) > julianday('now')
                )
              )
          )
          OR EXISTS (
            SELECT 1 FROM community_member_custom_roles member_role
            JOIN community_channel_permissions permission
              ON permission.role_id = member_role.role_id
              AND permission.channel_id = community_event.channel_id
            WHERE member_role.community_id = community_event.community_id
              AND member_role.profile_id = notifications.receiver_profile_id
              AND permission.can_view = 0
          )
        )
    )`;
