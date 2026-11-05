CREATE TABLE workspace_engine_schema(version INTEGER NOT NULL);
INSERT INTO workspace_engine_schema VALUES(1);
CREATE TABLE block_presentations (
  block_id TEXT PRIMARY KEY REFERENCES blocks(id) ON DELETE CASCADE,
  json TEXT NOT NULL
);
CREATE TABLE workspace_engine_layouts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE
);
