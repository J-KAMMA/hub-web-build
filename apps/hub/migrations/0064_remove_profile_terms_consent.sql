DROP INDEX IF EXISTS idx_profiles_terms_version;
ALTER TABLE profiles DROP COLUMN terms_version;
ALTER TABLE profiles DROP COLUMN terms_accepted_at;
