PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS hub_data_requests(id TEXT PRIMARY KEY,profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,request_type TEXT NOT NULL CHECK(request_type IN('deletion')),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN('open','processing','completed','rejected')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hub_data_requests_open ON hub_data_requests(profile_id,request_type) WHERE status IN('open','processing');
