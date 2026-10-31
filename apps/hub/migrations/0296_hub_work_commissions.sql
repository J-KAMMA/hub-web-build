-- 指名依頼 (crowdsourcing v1, 2026-10-29; docs/hub-commissions/DESIGN.md sections 2, 3, 6, 8.1).
-- Files only: not applied to any D1 database from this change.
--
-- Hub owns the request, the offer settings, the thread, the delivery list and the public-display choice.
-- Commerce owns payment, the receipt, the refund record and every wallet address; the escrow itself is on
-- chain. Hub keeps NO wallet, transaction hash or Commerce identifier here. price_units is the displayed
-- amount of the condition (whole JPYC), not a payment record. escrow_state is only what Commerce's signed
-- state lookup last reported. The contract ID is a 128-bit random value and is never derived from a profile.

CREATE TABLE IF NOT EXISTS work_offer_settings (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
  accepting INTEGER NOT NULL DEFAULT 0 CHECK (accepting IN (0, 1)),
  min_price_units INTEGER NOT NULL DEFAULT 1000 CHECK (min_price_units BETWEEN 100 AND 30000),
  price_note TEXT NOT NULL DEFAULT '' CHECK (length(price_note) <= 500),
  accepts_text TEXT NOT NULL DEFAULT '' CHECK (length(accepts_text) <= 1000),
  refuses_text TEXT NOT NULL DEFAULT '' CHECK (length(refuses_text) <= 1000),
  turnaround_days INTEGER NOT NULL DEFAULT 7 CHECK (turnaround_days BETWEEN 1 AND 90),
  categories_json TEXT NOT NULL DEFAULT '[]' CHECK (length(categories_json) <= 600),
  adult_allowed INTEGER NOT NULL DEFAULT 0 CHECK (adult_allowed IN (0, 1)),
  max_open INTEGER NOT NULL DEFAULT 3 CHECK (max_open BETWEEN 1 AND 20),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_requests (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  mode TEXT NOT NULL DEFAULT 'direct' CHECK (mode IN ('direct', 'open')),
  client_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  worker_profile_id TEXT REFERENCES profiles(id) ON DELETE RESTRICT,
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 30),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  brief TEXT NOT NULL CHECK (length(brief) BETWEEN 1 AND 4000),
  audience TEXT NOT NULL DEFAULT 'general' CHECK (audience IN ('general', 'adult')),
  budget_units INTEGER NOT NULL CHECK (budget_units BETWEEN 100 AND 30000),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at TEXT NOT NULL,
  CHECK (mode <> 'direct' OR worker_profile_id IS NOT NULL),
  CHECK (worker_profile_id IS NULL OR worker_profile_id <> client_profile_id)
);
CREATE INDEX IF NOT EXISTS idx_work_requests_client ON work_requests(client_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_requests_worker ON work_requests(worker_profile_id, created_at DESC);

-- v1 has one contract per request (milestone_no = 1). escrow_state moves forward only.
CREATE TABLE IF NOT EXISTS work_contracts (
  id TEXT PRIMARY KEY CHECK (length(id) = 32),
  request_id TEXT NOT NULL UNIQUE REFERENCES work_requests(id) ON DELETE RESTRICT,
  client_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  worker_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  price_units INTEGER NOT NULL CHECK (price_units BETWEEN 100 AND 30000),
  turnaround_days INTEGER NOT NULL CHECK (turnaround_days BETWEEN 1 AND 90),
  milestone_no INTEGER NOT NULL DEFAULT 1 CHECK (milestone_no = 1),
  escrow_state TEXT NOT NULL DEFAULT 'pending_funding'
    CHECK (escrow_state IN ('pending_funding', 'funded', 'accepted', 'delivered', 'flagged', 'released', 'refunded')),
  accept_deadline TEXT,
  deliver_deadline TEXT,
  release_at TEXT,
  flag_until TEXT,
  -- The fingerprint Commerce read from the chain (signed state reply). Compared with work_deliveries.delivery_hash.
  chain_delivery_hash TEXT CHECK (chain_delivery_hash IS NULL OR length(chain_delivery_hash) = 64),
  state_checked_at TEXT,
  closed_at TEXT,
  publication TEXT NOT NULL DEFAULT 'private' CHECK (publication IN ('private', 'public')),
  worker_listed INTEGER NOT NULL DEFAULT 0 CHECK (worker_listed IN (0, 1)),
  audience TEXT NOT NULL DEFAULT 'general' CHECK (audience IN ('general', 'adult')),
  created_at TEXT NOT NULL,
  CHECK (worker_profile_id <> client_profile_id),
  CHECK (audience = 'general' OR publication = 'private')
);
CREATE INDEX IF NOT EXISTS idx_work_contracts_client ON work_contracts(client_profile_id, escrow_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_contracts_worker ON work_contracts(worker_profile_id, escrow_state, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_contracts_closed ON work_contracts(closed_at) WHERE closed_at IS NOT NULL;

-- files_json: [{ id, name, sha256, size }] as reported by the file component. The files stay in the
-- file component; delivery_hash is the hub.work.delivery.v1 fingerprint that the worker records on chain.
CREATE TABLE IF NOT EXISTS work_deliveries (
  contract_id TEXT PRIMARY KEY REFERENCES work_contracts(id) ON DELETE CASCADE,
  files_json TEXT NOT NULL CHECK (length(files_json) <= 20000),
  delivery_hash TEXT NOT NULL CHECK (length(delivery_hash) = 64),
  preview_kind TEXT NOT NULL DEFAULT 'metadata' CHECK (preview_kind IN ('metadata', 'image', 'text')),
  delivered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_thread_messages (
  id TEXT PRIMARY KEY CHECK (length(id) = 36),
  contract_id TEXT NOT NULL REFERENCES work_contracts(id) ON DELETE CASCADE,
  sender_profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 2000),
  flagged_payment_redirect INTEGER NOT NULL DEFAULT 0 CHECK (flagged_payment_redirect IN (0, 1)),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_thread_messages_contract ON work_thread_messages(contract_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_work_thread_messages_sender ON work_thread_messages(sender_profile_id);

CREATE TABLE IF NOT EXISTS work_client_stats (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE RESTRICT,
  completed INTEGER NOT NULL DEFAULT 0 CHECK (completed >= 0),
  refunded_after_flag INTEGER NOT NULL DEFAULT 0 CHECK (refunded_after_flag >= 0),
  updated_at TEXT NOT NULL
);

-- Replay guard for Commerce's signed state replies (one row per token ID until it expires).
CREATE TABLE IF NOT EXISTS work_ticket_jti (
  jti TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_work_ticket_jti_expiry ON work_ticket_jti(expires_at);
