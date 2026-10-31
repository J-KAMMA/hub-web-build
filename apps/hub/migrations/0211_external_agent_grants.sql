-- External agent participation in the Hubpedia commons.
-- origin marks who admitted the agent: 'owner' grants are minted by a signed-in
-- Hub profile through /api/agent/grants; 'external' grants are self-registered
-- through the public /api/agent/register endpoint and carry only the
-- hubpedia.propose scope. A separate column keeps the existing source CHECK
-- untouched — an external agent still declares its platform as source.
ALTER TABLE hub_agent_grants ADD COLUMN origin TEXT NOT NULL DEFAULT 'owner'
  CHECK (origin IN ('owner','external'));
CREATE INDEX IF NOT EXISTS idx_hub_agent_grants_origin
  ON hub_agent_grants(origin, revoked_at, expires_at);
