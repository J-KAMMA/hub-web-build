-- Hubpedia ledger stub tier. A topic that fails the full gate (8 claims, 2 sources with 2 claims each) but has one
-- source with at least 4 confident claims may be composed as a short, noindex "stub" article. `eligible` keeps its
-- meaning (the full gate); `stub_eligible` marks the lower tier and is 0 whenever `eligible` is 1. Medical, health,
-- legal and drug topics never get 1 here. Claims of a topic that fails both stay in the ledger, untouched.
ALTER TABLE hubpedia_ledger_topic_stats ADD COLUMN stub_eligible INTEGER NOT NULL DEFAULT 0 CHECK (stub_eligible IN (0, 1));
CREATE INDEX hubpedia_ledger_topic_stats_stub_idx ON hubpedia_ledger_topic_stats(stub_eligible, topic_id) WHERE stub_eligible = 1;
