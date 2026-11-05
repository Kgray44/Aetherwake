ALTER TABLE workspace_engine_layouts ADD COLUMN organization_json TEXT;
ALTER TABLE workspace_engine_layouts ADD COLUMN legacy_organization_json TEXT;
CREATE TABLE workspace_engine_v3_recovery_archive (
  kind TEXT NOT NULL, id TEXT NOT NULL, workspace_id TEXT NOT NULL, json TEXT NOT NULL,
  PRIMARY KEY(kind,id)
);
INSERT INTO workspace_engine_v3_recovery_archive
  SELECT 'history',id,workspace_id,history_json FROM workspace_engine_layouts;
INSERT INTO workspace_engine_v3_recovery_archive
  SELECT 'checkpoint',id,workspace_id,snapshot_json FROM workspace_engine_checkpoints;
