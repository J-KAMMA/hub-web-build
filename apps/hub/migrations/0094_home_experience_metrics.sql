CREATE TABLE IF NOT EXISTS home_experience_metrics (
  day TEXT NOT NULL,
  route_group TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('lcp','cls','inp','navigation')),
  sample_count INTEGER NOT NULL DEFAULT 0,
  sample_sum INTEGER NOT NULL DEFAULT 0,
  sample_max INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, route_group, metric)
);
