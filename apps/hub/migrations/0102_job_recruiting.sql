CREATE TABLE job_listing_details (
 listing_id TEXT PRIMARY KEY REFERENCES work_listings(id) ON DELETE CASCADE,
 employment_type TEXT NOT NULL CHECK(employment_type IN ('full_time','contract','part_time','intern','temporary','other')),
 occupation TEXT NOT NULL, salary_min INTEGER, salary_max INTEGER,
 salary_period TEXT CHECK(salary_period IS NULL OR salary_period IN ('hourly','monthly','annual')),
 hours TEXT NOT NULL DEFAULT '', holidays TEXT NOT NULL DEFAULT '', probation TEXT NOT NULL DEFAULT '',
 location TEXT NOT NULL, transfer TEXT NOT NULL DEFAULT '', remote TEXT NOT NULL DEFAULT '', benefits TEXT NOT NULL DEFAULT '',
 contract_period TEXT NOT NULL DEFAULT '', duties_change_scope TEXT NOT NULL DEFAULT '', location_change_scope TEXT NOT NULL DEFAULT '', renewal_criteria TEXT NOT NULL DEFAULT '', openings INTEGER NOT NULL DEFAULT 1 CHECK(openings BETWEEN 1 AND 1000),
 company_name TEXT NOT NULL, business TEXT NOT NULL DEFAULT '', company_size TEXT NOT NULL DEFAULT '', company_site TEXT NOT NULL DEFAULT '',
 recruiter_label TEXT NOT NULL DEFAULT '', verification TEXT NOT NULL DEFAULT 'self_reported' CHECK(verification='self_reported'),
 job_review_status TEXT NOT NULL DEFAULT 'pending' CHECK(job_review_status IN ('pending','approved','rejected')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 CHECK(salary_min IS NULL OR salary_min>=0), CHECK(salary_max IS NULL OR salary_max>=0),
 CHECK(salary_min IS NULL OR salary_max IS NULL OR salary_min<=salary_max)
);
CREATE INDEX idx_job_details_search ON job_listing_details(employment_type,salary_period,salary_min,salary_max);

CREATE TABLE job_applications (
 id TEXT PRIMARY KEY, listing_id TEXT NOT NULL REFERENCES work_listings(id) ON DELETE CASCADE,
 applicant_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
 cover_note TEXT NOT NULL, experience TEXT NOT NULL DEFAULT '', skills_json TEXT NOT NULL DEFAULT '[]',
 desired_conditions TEXT NOT NULL DEFAULT '', available_from TEXT,
 status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','screening','interview','offer','hired','rejected','withdrawn')),
 anonymized_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(listing_id,applicant_profile_id)
);
CREATE INDEX idx_job_applications_applicant ON job_applications(applicant_profile_id,updated_at DESC);
CREATE INDEX idx_job_applications_listing ON job_applications(listing_id,status,updated_at DESC);

CREATE TABLE job_application_status_history (
 id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES job_applications(id) ON DELETE CASCADE,
 actor_profile_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
 from_status TEXT, to_status TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX idx_job_application_history ON job_application_status_history(application_id,created_at,id);
