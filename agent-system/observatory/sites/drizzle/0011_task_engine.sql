ALTER TABLE proposals ADD COLUMN engine TEXT;
--> statement-breakpoint
CREATE TABLE task_engine_events (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  task_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  event TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, task_id, version),
  UNIQUE (owner_id, namespace, operation_id)
);
--> statement-breakpoint
CREATE TRIGGER task_engine_register AFTER INSERT ON proposals
WHEN NEW.engine IS NOT NULL
BEGIN
  INSERT INTO task_engine_events VALUES (NEW.owner_id, NEW.namespace, NEW.task_id, NEW.version,
    json_extract(NEW.engine, '$.event.operation_id'), json_extract(NEW.engine, '$.event'));
END;
--> statement-breakpoint
CREATE TRIGGER task_engine_update AFTER UPDATE OF engine ON proposals
WHEN NEW.engine IS NOT NULL
BEGIN
  INSERT INTO task_engine_events VALUES (NEW.owner_id, NEW.namespace, NEW.task_id, NEW.version,
    json_extract(NEW.engine, '$.event.operation_id'), json_extract(NEW.engine, '$.event'));
END;
