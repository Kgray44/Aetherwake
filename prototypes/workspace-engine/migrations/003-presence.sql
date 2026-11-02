ALTER TABLE workspace_engine_layouts ADD COLUMN presence_json TEXT;
ALTER TABLE workspace_engine_layouts ADD COLUMN legacy_presence_json TEXT;
-- Retain exact pre-upgrade recovery JSON; migration enriches active copies only.
CREATE TABLE workspace_engine_v2_recovery_archive (
  kind TEXT NOT NULL, id TEXT NOT NULL, workspace_id TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY(kind,id)
);
INSERT INTO workspace_engine_v2_recovery_archive
  SELECT 'history',id,workspace_id,history_json FROM workspace_engine_layouts;
INSERT INTO workspace_engine_v2_recovery_archive
  SELECT 'checkpoint',id,workspace_id,snapshot_json FROM workspace_engine_checkpoints;
