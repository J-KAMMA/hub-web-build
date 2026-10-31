-- Hubpedia Japanese Wikipedia base layer (2026-10-30, owner-approved; docs/hubpedia-ledger.md).
-- A catalog of imported Japanese Wikipedia articles. The body text lives in object storage under
-- hubpedia-wikipedia/<revision_id>.txt; this table keeps only the key, hash, length and attribution data.
-- Imported text and its derivatives stay CC BY-SA 4.0 with attribution to source_url and history_url.
-- Imported articles are always noindex and carry verification_status 'unverified' until Hub ledger review.
CREATE TABLE hubpedia_wikipedia_articles (
  page_id INTEGER PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  revision_id INTEGER NOT NULL,
  revision_timestamp TEXT NOT NULL,
  body_object_key TEXT NOT NULL,
  body_sha256 TEXT NOT NULL CHECK (length(body_sha256) = 64),
  body_bytes INTEGER NOT NULL CHECK (body_bytes > 0),
  summary TEXT NOT NULL DEFAULT '',
  license TEXT NOT NULL DEFAULT 'CC-BY-SA-4.0' CHECK (license = 'CC-BY-SA-4.0'),
  source_url TEXT NOT NULL,
  history_url TEXT NOT NULL,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('unverified', 'verified', 'superseded')),
  converter_version INTEGER NOT NULL,
  dump_id TEXT NOT NULL,
  imported_at TEXT NOT NULL
);

-- Redirect pages, recorded as aliases of the article they point to (resolved at read time).
CREATE TABLE hubpedia_wikipedia_aliases (
  alias_slug TEXT PRIMARY KEY,
  alias_title TEXT NOT NULL,
  target_slug TEXT NOT NULL
);
CREATE INDEX hubpedia_wikipedia_aliases_target_idx ON hubpedia_wikipedia_aliases(target_slug);

-- Resume point of an import: the byte offset of the next stream to read. One row per dump.
CREATE TABLE hubpedia_wikipedia_import_runs (
  dump_id TEXT PRIMARY KEY,
  next_offset INTEGER NOT NULL DEFAULT 0,
  pages_seen INTEGER NOT NULL DEFAULT 0,
  imported INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  redirects INTEGER NOT NULL DEFAULT 0,
  disambiguation INTEGER NOT NULL DEFAULT 0,
  stubs INTEGER NOT NULL DEFAULT 0,
  other_namespace INTEGER NOT NULL DEFAULT 0,
  finished INTEGER NOT NULL DEFAULT 0 CHECK (finished IN (0, 1)),
  updated_at TEXT NOT NULL
);
