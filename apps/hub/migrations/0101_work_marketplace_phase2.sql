ALTER TABLE work_listing_inquiries ADD COLUMN status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','reviewing','accepted','declined','withdrawn'));
ALTER TABLE work_listing_inquiries ADD COLUMN owner_read_at TEXT;
ALTER TABLE work_listing_inquiries ADD COLUMN applicant_read_at TEXT;

CREATE TABLE work_inquiry_messages (
 id TEXT PRIMARY KEY,
 inquiry_id TEXT NOT NULL REFERENCES work_listing_inquiries(id) ON DELETE CASCADE,
 sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX idx_work_inquiry_messages_thread ON work_inquiry_messages(inquiry_id,created_at,id);
INSERT INTO work_inquiry_messages(id,inquiry_id,sender_profile_id,body,created_at)
 SELECT lower(hex(randomblob(16))),id,sender_profile_id,message,created_at FROM work_listing_inquiries;

CREATE TABLE work_listing_saves (
 profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 listing_id TEXT NOT NULL REFERENCES work_listings(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 PRIMARY KEY(profile_id,listing_id)
);
CREATE INDEX idx_work_listing_saves_profile ON work_listing_saves(profile_id,created_at DESC);

CREATE TABLE work_saved_searches (
 id TEXT PRIMARY KEY,
 profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 name TEXT NOT NULL,
 filters_json TEXT NOT NULL,
 notification_enabled INTEGER NOT NULL DEFAULT 0 CHECK(notification_enabled IN (0,1)),
 last_checked_at TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX idx_work_saved_searches_profile ON work_saved_searches(profile_id,updated_at DESC);

CREATE TABLE work_listing_analytics_daily (
 listing_id TEXT NOT NULL REFERENCES work_listings(id) ON DELETE CASCADE,
 event_day TEXT NOT NULL,
 list_views INTEGER NOT NULL DEFAULT 0,
 detail_views INTEGER NOT NULL DEFAULT 0,
 inquiries INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(listing_id,event_day)
);

