ALTER TABLE github_snapshot ADD COLUMN lease_until INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE github_snapshot ADD COLUMN credential_key TEXT;
--> statement-breakpoint
ALTER TABLE github_snapshot ADD COLUMN validators TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
ALTER TABLE github_snapshot ADD COLUMN rate_until INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE github_snapshot ADD COLUMN rate_failures INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
UPDATE github_snapshot SET rate_until = COALESCE(json_extract(snapshot, '$.retry_at'), 0)
WHERE snapshot IS NOT NULL AND json_valid(snapshot);
