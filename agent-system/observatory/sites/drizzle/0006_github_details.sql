ALTER TABLE github_snapshot ADD COLUMN read_reject_key TEXT;
--> statement-breakpoint
ALTER TABLE github_snapshot ADD COLUMN read_reject_until INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint

CREATE TABLE github_details (
  cache_key TEXT PRIMARY KEY,
  credential_key TEXT NOT NULL,
  retry_at INTEGER NOT NULL,
  stored_at INTEGER NOT NULL,
  payload TEXT NOT NULL,
  validators TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX github_details_recency ON github_details (stored_at DESC, cache_key);
