/*
 * What happens to every column that points at a Hub profile when the profile is deleted
 * (owner decision 2026-10-17; docs/hub-privacy/AUDIT.md 2.1 and 7.2-1).
 *
 * The profiles row itself is never deleted: 47 foreign keys RESTRICT it, and other people's
 * threads, DMs and community messages point at it. It becomes a tombstone instead (see
 * `profile-deletion.ts`): the name is "削除されたユーザー", the handle is a random `deleted-…`
 * value, bio, avatar and every contact or free-text column are cleared, and `deleted_at` is set.
 * Everything that refers to the tombstone then falls into one of these policies:
 *
 *  - delete     purely personal rows: deleted in bounded batches.
 *  - null       the profile ID is set to NULL (the row is somebody else's record).
 *  - tombstone  the row stays and the author renders as the deleted user (comments, replies,
 *               community messages, DMs received by others, other people's threads).
 *  - keep       the row stays unchanged because it is an accounting, moderation or legal record.
 *  - special    handled by a named step in `profile-deletion.ts` (the `via` field).
 *
 * `lib/server/profile-deletion-plan.test.ts` rebuilds the schema from the real migrations and
 * fails when a column that references profiles(id), or is named `*profile_id*`, is missing here.
 * A new table therefore cannot be forgotten.
 */

export type DeletionPolicy = "delete" | "null" | "tombstone" | "keep" | "special";

export type DeletionPlanEntry = {
  table: string;
  column: string;
  policy: DeletionPolicy;
  /** delete only: revoke access first (sessions, credentials, wallet links) before any bulk work. */
  phase?: "access" | "bulk";
  /** delete only: extra SQL condition; `?1` is the profile ID. */
  where?: string;
  /** special only: the step in profile-deletion.ts that owns this column. */
  via?: DeletionStepName;
  /** keep/tombstone/special: why. */
  reason?: string;
};

export type DeletionStepName =
  | "tombstone"
  | "access"
  | "social_posts"
  | "articles"
  | "videos"
  | "files"
  | "code"
  | "listings"
  | "applications"
  | "scrub_names"
  | "storage_release"
  | "bulk"
  | "await_outboxes"
  | "finish";

const entries: DeletionPlanEntry[] = [];
const add = (policy: DeletionPolicy, refs: readonly string[], extra: Omit<DeletionPlanEntry, "table" | "column" | "policy"> = {}) => {
  for (const ref of refs) {
    const dot = ref.indexOf(".");
    entries.push({ table: ref.slice(0, dot), column: ref.slice(dot + 1), policy, ...extra });
  }
};

/* ------------------------------------------------------------------ delete: access first */

add("delete", [
  "sessions.profile_id",
  "profile_credentials.profile_id",
  "profile_passkeys.profile_id",
  "passkey_challenges.profile_id",
  "profile_recovery_claims.profile_id",
  "profile_link_verifications.profile_id",
  "wallet_account_link_challenges.profile_id",
  "wallet_link_challenges_v2.profile_id",
  "hub_selective_credential_challenges.profile_id",
  "hub_selective_credentials.profile_id",
  "token_balance_challenges.profile_id",
  "adult_session_handoffs.profile_id",
  "p2p_device_invitations.profile_id",
  "p2p_devices.profile_id",
  "profile_wallet_accounts.profile_id",
  "profile_wallet_links.profile_id",
  "personal_node_restore_events.profile_id",
], { phase: "access" });

/* ------------------------------------------------------------------ delete: personal rows */

add("delete", [
  "access_gate_check_rate.profile_id",
  "access_gate_checks.profile_id",
  "bookmarks.profile_id",
  "classified_favorites.profile_id",
  "classified_saved_searches.profile_id",
  "code_repository_collaborators.profile_id",
  "community_channel_notification_preferences.profile_id",
  "community_channel_reactions.profile_id",
  "community_channel_read_states.profile_id",
  "community_federated_members.profile_id",
  "community_governance_delegations.delegate_profile_id",
  "community_governance_delegations.delegator_profile_id",
  "community_guide_verifications.profile_id",
  "community_member_custom_roles.profile_id",
  "community_membership_requests.profile_id",
  "community_message_operations.profile_id",
  "community_message_poll_votes.profile_id",
  "community_notification_preferences.profile_id",
  "community_onboarding_answers.profile_id",
  "community_scheduled_messages.author_profile_id",
  "community_welcome_progress.profile_id",
  "creator_monetization_preferences.profile_id",
  "direct_message_preferences.profile_id",
  "direct_message_rate_limits.profile_id",
  "distributed_provider_preferences.profile_id",
  "external_video_playlists.owner_profile_id",
  "external_video_saves.profile_id",
  "follows.followed_profile_id",
  "follows.follower_profile_id",
  "home_feed_read_positions.profile_id",
  "home_feed_view_read_positions.profile_id",
  "hub_account_moves.profile_id",
  "hub_agent_audit.profile_id",
  "hub_agent_drafts.profile_id",
  "hub_article_tag_follows.profile_id",
  "hub_developer_services.owner_profile_id",
  "hub_download_grants.profile_id",
  "hub_gate_unlocks.profile_id",
  "hub_nav_order.profile_id",
  "hub_library_pins.profile_id",
  "hub_research_project_follows.profile_id",
  "hub_game_library.profile_id",
  "hub_game_age_declarations.profile_id",
  "hub_game_build_downloads.profile_id",
  "hub_game_seller_challenges.profile_id",
  "hub_game_seller_verifications.profile_id",
  "hub_external_protocol_links.profile_id",
  "hub_import_move_hints.profile_id",
  "hub_imported_posts.profile_id",
  "hub_instance_operators.profile_id",
  "hub_intent_runs.profile_id",
  "hub_network_sources.profile_id",
  "hub_portability_exports.profile_id",
  "hub_portable_identities.profile_id",
  "hub_portable_media_refs.profile_id",
  "hub_profile_contexts.profile_id",
  "hub_rate_limit_buckets.profile_id",
  "hub_reaction_rate_limit_buckets.profile_id",
  "hub_social_post_rate_limit_buckets.profile_id",
  "hub_trust_requests.profile_id",
  "hub_user_article_comment_likes.profile_id",
  "hub_user_article_comment_rate_limit_buckets.profile_id",
  "hub_user_article_comment_settings.owner_profile_id",
  "hub_user_article_drafts.author_profile_id",
  "hub_user_article_magazine_settings.profile_id",
  "hub_user_article_magazines.owner_profile_id",
  "hub_user_article_rate_limit_buckets.profile_id",
  "hub_user_article_revisions.author_profile_id",
  "hub_user_article_saves.profile_id",
  "hub_user_article_series.owner_profile_id",
  "hub_wallet_bundler_rate_limits.profile_id",
  "hubpedia_article_candidate_signals.profile_id",
  "hubpedia_explain_requests.requested_by",
  "hubpedia_hub_topic_signals.author_profile_id",
  "hubpedia_wiki_editor_trust.profile_id",
  "hubpedia_wiki_watches.profile_id",
  "list_profiles.profile_id",
  "music_favorites.owner_profile_id",
  "music_playlists.owner_profile_id",
  "notification_preferences.profile_id",
  "notifications.receiver_profile_id",
  "post_pushes.profile_id",
  "profile_adult_opt_in.profile_id",
  "profile_content_preferences.profile_id",
  "profile_external_links.profile_id",
  "profile_muted_terms.profile_id",
  "profile_onboarding.profile_id",
  "profile_pinned_posts.profile_id",
  "profile_translation_language_preferences.profile_id",
  "profile_translation_preferences.profile_id",
  "public_post_peers.profile_id",
  "reactions.profile_id",
  "remote_actor_profiles.profile_id",
  "remote_hub_videos.profile_id",
  "remote_community_subscriptions.profile_id",
  "remote_follows.follower_profile_id",
  "remote_follows.remote_profile_id",
  "remote_reactions.profile_id",
  "research_git_tokens.owner_profile_id",
  "shopping_price_alerts.profile_id",
  "shopping_review_reactions.profile_id",
  "social_scheduled_posts.author_profile_id",
  "thread_drafts.profile_id",
  "thread_event_preferences.profile_id",
  "thread_notification_events.receiver_profile_id",
  "thread_post_quality_votes.profile_id",
  "thread_post_votes.profile_id",
  "thread_reading_archive.profile_id",
  "thread_topic_subscriptions.profile_id",
  "thread_tracking.profile_id",
  "thread_user_controls.owner_profile_id",
  "thread_user_controls.target_profile_id",
  "thread_vote_reasons.profile_id",
  "token_balance_snapshots.profile_id",
  "token_balances.profile_id",
  "user_lists.owner_profile_id",
  "video_channel_follows.profile_id",
  "video_import_jobs.profile_id",
  "video_likes.profile_id",
  "video_profile_activity.profile_id",
  "video_recommendation_settings.profile_id",
  "video_thread_comment_likes.profile_id",
  "wallet_activity.profile_id",
  "work_listing_saves.profile_id",
  "work_saved_searches.profile_id",
]);

/** Memberships go, except in communities the profile owns: those keep the tombstone as owner. */
add("delete", ["community_memberships.profile_id"], {
  where: "AND community_id NOT IN (SELECT id FROM communities WHERE owner_profile_id = ?1)",
});

/**
 * Gates the user created go only when no content still points at them. Gates of the user's own
 * posts, articles and videos are detached by their steps first; a gate that still protects a
 * channel or thread (content that stays) must not be removed, or that content would open up.
 */
add("delete", ["access_gates.owner_profile_id"], {
  where: "AND NOT EXISTS (SELECT 1 FROM content_access_gates g WHERE g.gate_id = access_gates.id)",
});

/* ------------------------------------------------------------------ null: not the user's record */

add("null", ["copyright_cases.reporter_profile_id", "copyright_notices.reporter_profile_id"]);
add("null", ["classified_analytics_events.profile_id"]);
// The Commerce grant row stays (profile cleared) so the same order can never be redeemed again.
add("null", ["hub_game_grants.profile_id"]);
// A build is the game's record; it stays with the uploader cleared.
add("null", ["hub_game_builds.created_by_profile_id"]);

/* ------------------------------------------------------------------ special steps */

add("special", ["hub_agent_grants.profile_id"], {
  via: "access",
  reason: "Agent grants are revoked and their labels cleared, not deleted: hubpedia_memory_proposals reference them with RESTRICT.",
});

add("special", ["social_posts.author_profile_id", "social_post_images.owner_profile_id"], {
  via: "social_posts",
  reason: "Own top-level posts (and reposts) are deleted through deleteD1SocialPost, then their text is replaced and revisions removed. Replies to other people's posts stay with the author shown as the deleted user. All uploaded images are marked deleted.",
});
add("special", ["hub_user_articles.author_profile_id"], {
  via: "articles",
  reason: "Published articles are withdrawn and scrubbed in place (title, body, summary, thumbnail, tags), like a copyright takedown. Gate, likes, bookmarks, saves, tags (hub_user_article_tags and the unified content_tag_links rows with target_type user_article), daily stats, series and magazine links and revisions are deleted. Other people's comments on them stay.",
});
add("special", ["hub_videos.profile_id"], {
  via: "videos",
  reason: "Marked deleted and queued in the video outbox (action delete), which tells the Video Worker and releases the Account storage reservations. Title, description and free tags (tags_json, migration 0289) are cleared and the video's content_tag_links rows are deleted.",
});
add("special", ["hub_content_files.owner_profile_id"], {
  via: "files",
  reason: "Published files go to unpublish_pending, so the existing retry job unpublishes them through the file component's ticket path; unpublished files then become removed.",
});
add("special", [
  "code_repositories.owner_profile_id",
  "code_access_tokens.owner_profile_id",
  "code_repository_pushes.profile_id",
], {
  via: "code",
  reason: "Tokens are revoked and their labels cleared; repositories become private with an empty description; reserved and committed push reservations are released through the storage outbox. The Git data in the Code Worker has no delete path yet.",
});
add("special", [
  "hub_storage_usage.profile_id",
  "hub_storage_objects.profile_id",
  "hub_storage_outbox.profile_id",
  "hub_storage_notices.profile_id",
], {
  via: "storage_release",
  reason: "Committed objects are released through the storage outbox first; the usage rows are deleted only after the outbox has drained (the Account link is still needed to deliver releases).",
});
add("special", ["account_profile_links.profile_id", "desktop_account_profile_links.profile_id"], {
  via: "finish",
  reason: "Deleted last, after the storage and video outboxes have drained, because releases are delivered to Account under this link.",
});
add("special", [
  "classified_listings.owner_profile_id",
  "public_listings.owner_profile_id",
  "work_listings.owner_profile_id",
  "music_works.submitted_by_profile_id",
], {
  via: "listings",
  reason: "Withdrawn from public view (paused / removed) but kept: conversations, inquiries, transactions and RESTRICT references of other people depend on them. Their tag links (content_tag_links for classified, work, music_work and market_product; tags_json on classified_listings and market_products) stay but the status triggers of migration 0286 set public_visible = 0 in the same statement, so no tag listing shows them.",
});
add("special", ["job_applications.applicant_profile_id"], {
  via: "applications",
  reason: "Cover note, experience, skills, desired conditions and availability are cleared (same columns as the 180-day anonymization); the row stays for the employer's pipeline.",
});
add("special", ["thread_posts.author_profile_id"], {
  via: "scrub_names",
  reason: "Posts in threads stay; the denormalized display_name is replaced with the deleted-user name.",
});

/* ------------------------------------------------------------------ tombstone: other people's context */

const TOMBSTONE_CONTEXT = "Row stays; the author renders as the deleted user (profiles row is a tombstone).";
add("tombstone", [
  "classified_appointments.requester_profile_id",
  "classified_audit_events.actor_profile_id",
  "classified_conversations.seller_profile_id",
  "classified_conversations.buyer_profile_id",
  "classified_inquiries.replied_by_profile_id",
  "classified_inquiries.sender_profile_id",
  "classified_media.uploader_profile_id",
  "classified_messages.sender_profile_id",
  "classified_reviews.author_profile_id",
  "classified_status_events.actor_profile_id",
  "community_audit_log.target_profile_id",
  "community_audit_log.actor_profile_id",
  "community_bots.created_by_profile_id",
  "community_channel_messages.pinned_by_profile_id",
  "community_channel_messages.author_profile_id",
  "community_federated_objects.profile_id",
  "community_governance_proposals.author_profile_id",
  "community_guide_pages.updated_by_profile_id",
  "community_guide_proposals.merged_by_profile_id",
  "community_guide_proposals.author_profile_id",
  "community_guide_reviews.author_profile_id",
  "community_guide_revisions.editor_profile_id",
  "community_invites.created_by_profile_id",
  "community_member_actions.actor_profile_id",
  "community_member_actions.target_profile_id",
  "community_member_custom_roles.assigned_by_profile_id",
  "community_membership_requests.resolved_by_profile_id",
  "community_message_pins.pinned_by_profile_id",
  "community_message_reports.resolved_by_profile_id",
  "community_moderation_appeals.reviewed_by_profile_id",
  "community_tokens.created_by_profile_id",
  "community_verification_requests.requested_by_profile_id",
  "communities.owner_profile_id",
  "conversation_participants.profile_id",
  "direct_conversation_pairs.first_profile_id",
  "direct_conversation_pairs.second_profile_id",
  "direct_message_images.owner_profile_id",
  "direct_messages.sender_profile_id",
  "distributed_resource_manifests.submitted_by_profile_id",
  "distributed_video_manifests.submitted_by_profile_id",
  "external_videos.submitted_by_profile_id",
  "game_guide_edit_proposals.reviewed_by_profile_id",
  "game_guide_edit_proposals.proposed_by_profile_id",
  "game_guide_hubs.reviewed_by_profile_id",
  "game_guide_hubs.created_by_profile_id",
  "game_guide_submission_audit.actor_profile_id",
  "game_guide_updates.created_by_profile_id",
  "hub_user_article_comments.author_profile_id",
  "hubpedia_article_candidates.reviewer_profile_id",
  "hubpedia_article_candidates.proposer_profile_id",
  "hubpedia_article_discussions.created_by_profile_id",
  "hubpedia_articles.author_profile_id",
  "hubpedia_memory_proposals.proposer_profile_id",
  "hubpedia_social_knowledge_links.reviewed_by_profile_id",
  "hubpedia_social_knowledge_links.proposed_by_profile_id",
  "hubpedia_topic_submissions.reviewer_profile_id",
  "hubpedia_topic_submissions.submitter_profile_id",
  "hubpedia_wiki_activity_events.profile_id",
  "hubpedia_wiki_audit.actor_profile_id",
  "hubpedia_wiki_discussions.author_profile_id",
  "hubpedia_wiki_patrol.profile_id",
  "hubpedia_wiki_proposals.reviewer_profile_id",
  "hubpedia_wiki_proposals.editor_profile_id",
  "hubpedia_wiki_revisions.created_by_profile_id",
  "job_application_status_history.actor_profile_id",
  "notifications.actor_profile_id",
  "public_listing_audit_events.actor_profile_id",
  "public_listings.cancelled_by_profile_id",
  "research_change_proposals.author_profile_id",
  "research_contributions.contributor_profile_id",
  "research_document_revisions.author_profile_id",
  "research_git_proposals.reviewer_profile_id",
  "research_git_proposals.author_profile_id",
  "research_objects.created_by_profile_id",
  "research_projects.owner_profile_id",
  "research_proposal_discussion_requests.creator_profile_id",
  "research_proposal_discussions.creator_profile_id",
  "research_provenance_events.actor_profile_id",
  "shopping_product_reviews.profile_id",
  "shopping_review_replies.profile_id",
  "social_post_revisions.editor_profile_id",
  "thread_category_operation_notes.updated_by_profile_id",
  "thread_move_requests.requested_by_profile_id",
  "thread_relations.created_by_profile_id",
  "thread_summary_revisions.reviewed_by_profile_id",
  "thread_summary_revisions.created_by_profile_id",
  "thread_workflow_states.updated_by_profile_id",
  "threads.created_by_profile_id",
  "token_rankings.created_by_profile_id",
  "vault_content_reviews.author_profile_id",
  "video_thread_comments.profile_id",
  "work_inquiry_messages.sender_profile_id",
  "work_listing_inquiries.sender_profile_id",
], { reason: TOMBSTONE_CONTEXT });

/* ------------------------------------------------------------------ keep: accounting, moderation, legal */

add("keep", [
  "wallet_tip_transactions.sender_profile_id",
  "wallet_tip_transactions.recipient_profile_id",
  "wallet_tip_transfers.sender_profile_id",
  "wallet_tip_transfers.recipient_profile_id",
  "creator_revenue_allocations.profile_id",
  "classified_plan_payments.payer_profile_id",
  "classified_completed_transactions.seller_profile_id",
  "classified_completed_transactions.buyer_profile_id",
  "market_ticket_checkin_challenges.organizer_profile_id",
  "market_ticket_events.organizer_profile_id",
  "market_ticket_refund_requests.buyer_profile_id",
  "market_ticket_reservations.buyer_profile_id",
], { reason: "Accounting, payment and ticket records are kept for legal retention and for the counterparty; the profile row is a tombstone (the tip ledger holds no wallet address)." });

add("keep", [
  "classified_reports.reporter_profile_id",
  "community_duplicate_reports.reporter_profile_id",
  "community_message_reports.reporter_profile_id",
  "hub_user_article_comment_reports.reporter_profile_id",
  "hubpedia_wiki_discussion_reports.reporter_profile_id",
  "profile_reports.reporter_profile_id",
  "profile_reports.target_profile_id",
  "shopping_product_reports.reporter_profile_id",
  "shopping_review_reports.reporter_profile_id",
  "social_post_reports.reporter_profile_id",
  "thread_post_reports.reporter_profile_id",
  "thread_summary_reports.reporter_profile_id",
  "video_reports.reporter_profile_id",
  "video_thread_comment_reports.reporter_profile_id",
  "work_listing_reports.reporter_profile_id",
], { reason: "Moderation evidence of other people's reports and of reports about this profile; the reporter is only a tombstone." });

add("keep", [
  "moderation_appeals.profile_id",
  "social_post_moderation_appeals.author_profile_id",
  "community_moderation_appeals.profile_id",
  "profile_moderation_status.profile_id",
  "hubpedia_wiki_suspensions.profile_id",
  "copyright_case_responses.author_profile_id",
  "copyright_case_targets.author_profile_id",
], { reason: "Sanction, appeal and copyright-case records are legal and safety evidence. Only the copyright reporter IDs are nulled (decision 2026-10-17)." });

add("keep", [
  "community_governance_votes.profile_id",
  "community_governance_vote_snapshots.profile_id",
], { reason: "Votes of closed or open proposals must keep adding up; the voter is a tombstone." });

add("delete", [
  "work_offer_settings.profile_id",
  "work_client_stats.profile_id",
]);

add("keep", [
  "work_requests.client_profile_id",
  "work_requests.worker_profile_id",
  "work_contracts.client_profile_id",
  "work_contracts.worker_profile_id",
], { reason: "A commission is the counterparty's record of an escrowed deal (DESIGN 8.1); both parties stay as tombstones." });

add("tombstone", ["work_thread_messages.sender_profile_id"], { reason: "The other party keeps the thread (1 year after close) for abuse review; the sender renders as the deleted user." });

add("delete", ["hub_image_boards.owner_profile_id"]);

add("keep", ["hubpedia_revision_reviews.reviewer_profile_id"], { reason: "An approved review is what keeps an AI-written revision indexable (docs/hubpedia-ledger.md); the reviewer renders as a tombstone." });

add("keep", [
  "hubpedia_material_item_optouts.profile_id",
  "hubpedia_material_profile_optouts.profile_id",
], { reason: "An opt-out must keep protecting the comments and posts that remain." });

add("keep", [
  "hub_consent_records.profile_id",
  "hub_data_requests.profile_id",
  "hub_profile_deletions.profile_id",
  "hub_bootstrap_state.claimed_profile_id",
  "music_reports.reporter_profile_id",
], { reason: "Proof of consent, the deletion request itself and its schedule, and the one-time bootstrap marker, and music reports (a NOT NULL reporter ID without a foreign key; like every other report it is moderation evidence, and the ID now points at the tombstone). No personal text." });

/*
 * Actor columns named `*_by` or `actor_key` that hold a profile ID without a foreign key
 * (AUDIT.md 8.3-6). They are Hubpedia moderation and provenance records: who appointed or revoked
 * patrol, who suspended or lifted a suspension, and the `human:<profile ID>` idempotency key of a
 * memory proposal. They stay; the profile they name becomes the tombstone, so the ID no longer
 * leads to a person.
 */
add("keep", [
  "hubpedia_wiki_suspensions.suspended_by",
  "hubpedia_wiki_suspensions.lifted_by",
  "hubpedia_wiki_patrol.appointed_by",
  "hubpedia_wiki_patrol.revoked_by",
  "hubpedia_memory_proposals.actor_key",
], { reason: "Hubpedia moderation and provenance records (patrol appointments, suspensions, memory-proposal idempotency key). The named profile is a tombstone." });

export const PROFILE_DELETION_PLAN: readonly DeletionPlanEntry[] = Object.freeze(entries.map((entry) => Object.freeze(entry)));

/** Identity columns that carry a copy of the name or handle without pointing at profiles(id). */
export const PROFILE_DELETION_DENORMALIZED_NAMES: readonly { table: string; columns: readonly string[]; step: DeletionStepName }[] = Object.freeze([
  { table: "social_posts", columns: ["display_name", "handle"], step: "social_posts" },
  { table: "thread_posts", columns: ["display_name"], step: "scrub_names" },
]);

export const DELETED_USER_NAME = "削除されたユーザー";

/*
 * Columns named `*_by` or `actor_key` that never hold a Hub profile ID (checked against every
 * writer, AUDIT.md 8.3-6). `profile-deletion-plan.test.ts` counts `*_by` and `actor_key` columns
 * too, so each one is either in the plan above or listed here with what it holds.
 */
export const PROFILE_DELETION_NON_PROFILE_ACTOR_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  "hub_user_article_comments.removed_by": "role: author, article_author or moderator (CHECK constraint)",
  "hub_ad_system_controls.changed_by_actor_key": "ad operator role key",
  "hub_ad_creative_versions.reviewed_by_actor_key": "ad operator role key",
  "hub_ad_traffic_reviews.reviewed_by_actor_key": "ad operator role key",
  "hub_ad_campaigns.created_by_actor_key": "advertiser:<advertiser_ref> or operator role key",
  "hub_ad_audit_logs.actor_key": "advertiser:<advertiser_ref> or operator role key such as moderation-admin",
  "hubpedia_claim_knowledge_state.checked_by": "process label such as human-edit or hubpedia-hub-topics",
  "encyclopedia_article_revisions.created_by": "process label such as encyclopedia-ai-worker or seed-migration",
  "hubpedia_memory_proposals.superseded_by": "foreign key to another memory proposal",
  "hubpedia_memory_proposals.answered_by": "foreign key to another memory proposal",
  "hubpedia_ledger_claim_topics.assigned_by": "process label such as the topic-assignment script",
  "hubpedia_ledger_extractions.served_by": "process label naming the model or provider that served the extraction",
});
