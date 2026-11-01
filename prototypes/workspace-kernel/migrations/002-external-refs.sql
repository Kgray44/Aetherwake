CREATE TABLE external_provider_refs (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL CHECK(length(trim(provider)) > 0),
  namespace TEXT NOT NULL,
  external_id TEXT NOT NULL CHECK(length(trim(external_id)) > 0),
  state TEXT NOT NULL DEFAULT 'unverified' CHECK(state IN ('unverified','verified','stale','revoked')),
  created_at TEXT NOT NULL,
  UNIQUE(provider, namespace, external_id)
);
CREATE INDEX external_refs_by_resource ON external_provider_refs(resource_id);
UPDATE app_schema_version SET version = 2;
