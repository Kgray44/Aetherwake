CREATE TABLE task_telemetry (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  task_id TEXT NOT NULL,
  digest TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, task_id)
);
