CREATE TABLE app_schema_version (version INTEGER NOT NULL CHECK(version >= 1));
INSERT INTO app_schema_version(version) VALUES (1);

CREATE TABLE projects (
  id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE workspaces (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE resources (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('note','conversation','generic')),
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE notes (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE RESTRICT,
  content TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE conversation_refs (
  resource_id TEXT PRIMARY KEY REFERENCES resources(id) ON DELETE RESTRICT,
  local_history_ref TEXT, backend_state TEXT NOT NULL DEFAULT 'unavailable'
    CHECK(backend_state IN ('unavailable','connected','disconnected'))
);
CREATE TABLE collections (
  id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  title TEXT NOT NULL CHECK(length(trim(title)) > 0),
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','archived')),
  version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE collection_members (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  PRIMARY KEY(collection_id, resource_id)
);
CREATE TABLE blocks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 320 CHECK(width > 0), height REAL NOT NULL DEFAULT 240 CHECK(height > 0),
  z INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX blocks_by_resource ON blocks(resource_id);
CREATE TABLE workspace_layouts (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'freeform' CHECK(mode IN ('freeform','structured')),
  viewport_json TEXT NOT NULL DEFAULT '{}', version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  target_id TEXT NOT NULL REFERENCES resources(id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(length(trim(kind)) > 0),
  provenance TEXT NOT NULL CHECK(provenance IN ('user','inferred','imported')),
  created_at TEXT NOT NULL,
  UNIQUE(source_id, target_id, kind), CHECK(source_id <> target_id)
);
CREATE TABLE change_events (
  id TEXT PRIMARY KEY, entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL,
  resource_id TEXT REFERENCES resources(id) ON DELETE SET NULL,
  resource_version INTEGER NOT NULL, occurred_at TEXT NOT NULL,
  origin TEXT NOT NULL, correlation_id TEXT NOT NULL, type TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}', schema_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX events_by_entity ON change_events(entity_kind, entity_id, occurred_at);
