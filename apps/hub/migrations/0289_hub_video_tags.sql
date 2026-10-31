-- Free tags for Hub self-made videos (2026-10-29). Source of record is tags_json (display forms, at most 8 of 32
-- characters); matching goes through content_tag_links (target type video), written by indexD1ContentTags.
ALTER TABLE hub_videos ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(tags_json) AND json_type(tags_json) = 'array');
