-- Hub content licenses (docs/hub-copyright/PLAN.md section 7, lane 1j).
-- One row per licensed work; no row means all rights reserved. Images carry their post's license.
CREATE TABLE IF NOT EXISTS content_licenses (
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  license TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (target_type, target_id),
  CHECK (target_type IN ('post', 'article')),
  CHECK (length(target_id) BETWEEN 1 AND 200),
  CHECK (license IN ('arr', 'cc-by-4.0', 'cc-by-sa-4.0', 'cc-by-nc-4.0', 'cc-by-nc-sa-4.0', 'cc-by-nd-4.0', 'cc-by-nc-nd-4.0', 'cc0-1.0'))
);

-- Gated content must stay all rights reserved. Enforced in the database as well as in the
-- application, so no write path can combine a gate with a CC license.
CREATE TRIGGER IF NOT EXISTS content_licenses_no_cc_on_gated_insert
BEFORE INSERT ON content_licenses
WHEN NEW.license <> 'arr' AND EXISTS (
  SELECT 1 FROM content_access_gates gate WHERE gate.target_type = NEW.target_type AND gate.target_id = NEW.target_id
)
BEGIN
  SELECT RAISE(ABORT, 'cc_license_on_gated_content');
END;

CREATE TRIGGER IF NOT EXISTS content_licenses_no_cc_on_gated_update
BEFORE UPDATE OF license ON content_licenses
WHEN NEW.license <> 'arr' AND EXISTS (
  SELECT 1 FROM content_access_gates gate WHERE gate.target_type = NEW.target_type AND gate.target_id = NEW.target_id
)
BEGIN
  SELECT RAISE(ABORT, 'cc_license_on_gated_content');
END;

CREATE TRIGGER IF NOT EXISTS content_access_gates_no_gate_on_cc_insert
BEFORE INSERT ON content_access_gates
WHEN EXISTS (
  SELECT 1 FROM content_licenses lic WHERE lic.target_type = NEW.target_type AND lic.target_id = NEW.target_id AND lic.license <> 'arr'
)
BEGIN
  SELECT RAISE(ABORT, 'gate_on_cc_licensed_content');
END;

CREATE TRIGGER IF NOT EXISTS content_access_gates_no_gate_on_cc_update
BEFORE UPDATE ON content_access_gates
WHEN EXISTS (
  SELECT 1 FROM content_licenses lic WHERE lic.target_type = NEW.target_type AND lic.target_id = NEW.target_id AND lic.license <> 'arr'
)
BEGIN
  SELECT RAISE(ABORT, 'gate_on_cc_licensed_content');
END;

-- Article drafts remember the chosen license until they are published.
ALTER TABLE hub_user_article_drafts ADD COLUMN license TEXT NOT NULL DEFAULT 'arr'
  CHECK (license IN ('arr', 'cc-by-4.0', 'cc-by-sa-4.0', 'cc-by-nc-4.0', 'cc-by-nc-sa-4.0', 'cc-by-nd-4.0', 'cc-by-nc-nd-4.0', 'cc0-1.0'));
