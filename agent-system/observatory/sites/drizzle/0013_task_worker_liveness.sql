CREATE TABLE IF NOT EXISTS task_worker_liveness (
  owner_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  worker_id TEXT NOT NULL,
  seen_at INTEGER NOT NULL,
  state TEXT NOT NULL,
  PRIMARY KEY (owner_id, namespace, worker_id)
);
