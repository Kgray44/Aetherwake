CREATE TABLE github_snapshot (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  auth_mode TEXT NOT NULL,
  retry_at INTEGER NOT NULL,
  snapshot TEXT
);
