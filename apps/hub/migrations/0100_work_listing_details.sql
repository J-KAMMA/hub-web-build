ALTER TABLE work_listings ADD COLUMN skills_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE work_listings ADD COLUMN work_style TEXT CHECK (work_style IS NULL OR work_style IN ('remote','hybrid','onsite'));
ALTER TABLE work_listings ADD COLUMN engagement TEXT NOT NULL DEFAULT '';
ALTER TABLE work_listings ADD COLUMN workload TEXT NOT NULL DEFAULT '';
ALTER TABLE work_listings ADD COLUMN deadline TEXT;
ALTER TABLE work_listings ADD COLUMN rejection_reason TEXT;

CREATE TABLE work_listing_inquiries (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES work_listings(id) ON DELETE CASCADE,
 sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, message TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(listing_id,sender_profile_id)
);
CREATE INDEX idx_work_listing_inquiries_owner ON work_listing_inquiries(listing_id,updated_at DESC);

CREATE TABLE work_listing_reports (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES work_listings(id) ON DELETE CASCADE,
 reporter_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE, reason TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved','dismissed')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_work_listing_reports_open ON work_listing_reports(listing_id,reporter_profile_id) WHERE status='open';
