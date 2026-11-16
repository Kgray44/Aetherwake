CREATE TABLE proposals (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  task_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  record TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, task_id)
);
--> statement-breakpoint
CREATE INDEX proposals_overview ON proposals (owner_id, namespace, created_at DESC);
