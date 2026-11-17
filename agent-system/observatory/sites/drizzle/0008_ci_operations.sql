CREATE TABLE ci_operations (
  owner_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  target_key TEXT NOT NULL,
  request TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('sending', 'accepted', 'observed', 'rejected', 'unknown', 'not_effective')),
  response TEXT NOT NULL,
  PRIMARY KEY (owner_id, operation_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX ci_operation_target ON ci_operations (target_key) WHERE state <> 'rejected';
--> statement-breakpoint
CREATE INDEX ci_operation_recent ON ci_operations (owner_id, created_at DESC);
