ALTER TABLE threads ADD COLUMN allowed_language_tags_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE threads ADD COLUMN allowed_country_codes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE threads ADD COLUMN write_ip_policy_json TEXT NOT NULL DEFAULT '{"mode":"none","cidrs":[]}';
ALTER TABLE thread_posts ADD COLUMN declared_language_tag TEXT;
ALTER TABLE thread_posts ADD COLUMN declared_country_code TEXT;

UPDATE threads
SET allowed_language_tags_json = CASE language
  WHEN 'ja' THEN '["ja-JP"]' WHEN 'en' THEN '["en-US"]'
  WHEN 'ko' THEN '["ko-KR"]' WHEN 'zh-CN' THEN '["zh-Hans"]'
  WHEN 'es' THEN '["es-ES"]' WHEN 'fr' THEN '["fr-FR"]'
  WHEN 'de' THEN '["de-DE"]' WHEN 'pt' THEN '["pt-BR"]'
  WHEN 'hi' THEN '["hi-IN"]' ELSE json_array(language) END
WHERE allowed_language_tags_json = '[]';

CREATE INDEX IF NOT EXISTS idx_threads_fine_scope
  ON threads(status, region, updated_at DESC);
