CREATE TABLE integration_runs (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  id TEXT NOT NULL,
  task_id TEXT,
  task_attempt_id TEXT,
  head_sha TEXT NOT NULL,
  pr_number INTEGER,
  state TEXT NOT NULL CHECK (state IN ('awaiting_pr','checking','blocked','repairing','merge_ready','merged','deployed')),
  version INTEGER NOT NULL CHECK (version >= 1),
  updated_at TEXT NOT NULL,
  record TEXT NOT NULL CHECK (json_valid(record)),
  event TEXT NOT NULL CHECK (json_valid(event)),
  PRIMARY KEY (owner_id, namespace, id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX integration_task_candidate ON integration_runs (owner_id, namespace, task_id, task_attempt_id)
WHERE task_id IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX integration_pr_head ON integration_runs (owner_id, namespace, pr_number, head_sha)
WHERE pr_number IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX integration_merge_in_flight ON integration_runs (owner_id, namespace, pr_number)
WHERE pr_number IS NOT NULL AND state NOT IN ('merged', 'deployed') AND
  json_extract(record, '$.merge_attempt.status') IN ('reserved', 'pending', 'enqueued', 'unknown', 'merged');
--> statement-breakpoint
CREATE TABLE integration_events (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  integration_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  event TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, integration_id, version),
  UNIQUE (owner_id, namespace, operation_id)
);
--> statement-breakpoint
CREATE TRIGGER integration_run_registered AFTER INSERT ON integration_runs
BEGIN
  INSERT INTO integration_events VALUES (NEW.owner_id, NEW.namespace, NEW.id, NEW.version,
    json_extract(NEW.event, '$.operation_id'), NEW.event);
END;
--> statement-breakpoint
CREATE TRIGGER integration_run_advanced AFTER UPDATE ON integration_runs
BEGIN
  INSERT INTO integration_events VALUES (NEW.owner_id, NEW.namespace, NEW.id, NEW.version,
    json_extract(NEW.event, '$.operation_id'), NEW.event);
END;
