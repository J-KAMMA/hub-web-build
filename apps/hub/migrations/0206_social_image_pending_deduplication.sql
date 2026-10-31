-- Published attachments have independent lifecycles. Reusing their image ID
-- would attach a new post to an old post's ownership/deletion state.
DROP INDEX IF EXISTS idx_social_post_images_owner_hash;
CREATE UNIQUE INDEX idx_social_post_images_owner_hash
  ON social_post_images(owner_profile_id, content_hash)
  WHERE status = 'pending';
