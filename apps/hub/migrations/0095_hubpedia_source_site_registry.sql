INSERT INTO hubpedia_source_license_registry(source_host,license_name,license_url,reuse_status,attribution_template,reviewed_at,updated_at) VALUES
('www.wikidata.org','CC0 1.0','https://creativecommons.org/publicdomain/zero/1.0/','allowed',NULL,'2026-07-22T00:00:00.000Z',datetime('now')),
('commons.wikimedia.org','Per-file license','https://commons.wikimedia.org/wiki/Commons:Licensing','review-required',NULL,'2026-07-22T00:00:00.000Z',datetime('now')),
('wikipedia.org','CC BY-SA; discovery gateway','https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use','review-required',NULL,'2026-07-22T00:00:00.000Z',datetime('now')),
('fandom.com','Per-wiki license; default CC BY-SA 3.0','https://www.fandom.com/licensing','review-required',NULL,'2026-07-22T00:00:00.000Z',datetime('now')),
('www.gov-online.go.jp','Government of Japan Standard Terms 2.0','https://www.gov-online.go.jp/tos/','attribution-required','Source: {title} (Government Public Relations Online) {url}','2026-07-22T00:00:00.000Z',datetime('now')),
('openknowledge.worldbank.org','Per-work open license','https://www.worldbank.org/ext/en/legal/terms-conditions/open-knowledge-repository','attribution-required',NULL,'2026-07-22T00:00:00.000Z',datetime('now')),
('openstax.org','CC BY-NC-SA for current and updated titles','https://openstax.org/blog/openstax-licensing','blocked',NULL,'2026-07-22T00:00:00.000Z',datetime('now')),
('www.britannica.com','All rights reserved','https://corporate.britannica.com/termsofuse.html','blocked',NULL,'2026-07-22T00:00:00.000Z',datetime('now'))
ON CONFLICT(source_host) DO UPDATE SET license_name=excluded.license_name,license_url=excluded.license_url,reuse_status=excluded.reuse_status,attribution_template=excluded.attribution_template,reviewed_at=excluded.reviewed_at,updated_at=excluded.updated_at;
