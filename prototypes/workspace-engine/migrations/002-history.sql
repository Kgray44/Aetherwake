ALTER TABLE workspace_engine_layouts ADD COLUMN history_json TEXT NOT NULL DEFAULT '{"undo":[],"redo":[]}';
CREATE TABLE workspace_engine_session (
  id INTEGER PRIMARY KEY CHECK(id=1),
  workspace_id TEXT REFERENCES workspaces(id) ON DELETE SET NULL
);
INSERT INTO workspace_engine_session VALUES(1,NULL);
CREATE TABLE workspace_engine_receipts (
  command_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_json TEXT NOT NULL
);
CREATE TABLE workspace_engine_checkpoints (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_at TEXT NOT NULL
);
