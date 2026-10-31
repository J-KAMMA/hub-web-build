-- Ephemeral, opt-in public-post readers. No posts, account master IDs, or private keys.
CREATE TABLE IF NOT EXISTS public_post_peers (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owner_hash TEXT NOT NULL,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  label TEXT NOT NULL CHECK(length(label) BETWEEN 1 AND 40),
  public_key TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS public_post_peers_live ON public_post_peers(profile_id,last_seen_at);
CREATE TABLE IF NOT EXISTS public_post_peer_signals (
  id TEXT PRIMARY KEY,
  from_peer TEXT NOT NULL REFERENCES public_post_peers(id) ON DELETE CASCADE,
  to_peer TEXT NOT NULL REFERENCES public_post_peers(id) ON DELETE CASCADE,
  ciphertext TEXT NOT NULL CHECK(length(ciphertext) BETWEEN 40 AND 100000),
  expires_at INTEGER NOT NULL,
  CHECK(from_peer <> to_peer)
);
CREATE INDEX IF NOT EXISTS public_post_peer_signals_inbox ON public_post_peer_signals(to_peer,expires_at);
