-- Resumable Hub Intent orchestration.
--
-- Hub stores only workflow state and safe, opaque references. AI prompts,
-- provider results, payment assertions, order records, wallet credentials,
-- and service-owned identifiers remain in their owning services.
CREATE TABLE IF NOT EXISTS hub_intent_runs (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  constraints_json TEXT NOT NULL DEFAULT '{}',
  negotiable_json TEXT NOT NULL DEFAULT '[]',
  resolution_json TEXT NOT NULL,
  state TEXT NOT NULL,
  current_stage TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  failure_code TEXT,
  CHECK (state IN (
    'awaiting_approval',
    'ready',
    'running',
    'paused',
    'handoff_required',
    'completed',
    'failed',
    'cancelled',
    'expired'
  )),
  CHECK (current_stage IN (
    'discovery',
    'comparison',
    'selection',
    'contract_approval',
    'payment_approval',
    'execution',
    'fulfillment',
    'complete'
  )),
  CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_hub_intent_runs_profile
  ON hub_intent_runs(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_hub_intent_runs_active
  ON hub_intent_runs(profile_id, state, updated_at DESC);

CREATE TABLE IF NOT EXISTS hub_intent_approvals (
  id TEXT PRIMARY KEY,
  intent_run_id TEXT NOT NULL REFERENCES hub_intent_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'required',
  preview_hash TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (kind IN ('execution','publish','confirmation','contract','payment','personal_data')),
  CHECK (status IN ('required','granted','denied','revoked')),
  UNIQUE (intent_run_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_hub_intent_approvals_run
  ON hub_intent_approvals(intent_run_id, status, kind);

CREATE TABLE IF NOT EXISTS hub_intent_checkpoints (
  id TEXT PRIMARY KEY,
  intent_run_id TEXT NOT NULL REFERENCES hub_intent_runs(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  capability_name TEXT,
  safe_summary_json TEXT NOT NULL DEFAULT '{}',
  preview_hash TEXT,
  created_at TEXT NOT NULL,
  CHECK (sequence >= 1),
  CHECK (stage IN (
    'discovery',
    'comparison',
    'selection',
    'contract_approval',
    'payment_approval',
    'execution',
    'fulfillment',
    'complete'
  )),
  CHECK (status IN ('entered','paused','handoff','completed','failed','cancelled')),
  UNIQUE (intent_run_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_hub_intent_checkpoints_run
  ON hub_intent_checkpoints(intent_run_id, sequence);
