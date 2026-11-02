-- The kernel runs this rebuild with foreign keys temporarily disabled OUTSIDE
-- the transaction, checks every FK before commit, then restores enforcement.
-- Do not rename the old blocks table: extension FKs must keep targeting blocks.
CREATE TABLE block_subject_refs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('project','collection','resource-query')),
  project_id TEXT REFERENCES projects(id) ON DELETE RESTRICT,
  collection_id TEXT REFERENCES collections(id) ON DELETE RESTRICT,
  query_json TEXT,
  CHECK((kind='project' AND project_id IS NOT NULL AND collection_id IS NULL AND query_json IS NULL)
     OR (kind='collection' AND project_id IS NULL AND collection_id IS NOT NULL AND query_json IS NULL)
     OR (kind='resource-query' AND query_json IS NOT NULL AND json_valid(query_json)))
);
CREATE TABLE blocks_subject_upgrade (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE RESTRICT,
  resource_id TEXT REFERENCES resources(id) ON DELETE RESTRICT,
  x REAL NOT NULL DEFAULT 0, y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 320 CHECK(width > 0), height REAL NOT NULL DEFAULT 240 CHECK(height > 0),
  z INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  subject_ref_id TEXT REFERENCES block_subject_refs(id) ON DELETE RESTRICT,
  CHECK((resource_id IS NOT NULL AND subject_ref_id IS NULL) OR (resource_id IS NULL AND subject_ref_id IS NOT NULL))
);
INSERT INTO blocks_subject_upgrade(id,workspace_id,resource_id,x,y,width,height,z,version)
  SELECT id,workspace_id,resource_id,x,y,width,height,z,version FROM blocks;
DROP TABLE blocks;
ALTER TABLE blocks_subject_upgrade RENAME TO blocks;
CREATE INDEX blocks_by_resource ON blocks(resource_id);
CREATE INDEX blocks_by_subject ON blocks(subject_ref_id);
UPDATE app_schema_version SET version=3;
