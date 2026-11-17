-- Keep cached records for outage fallback, but fetch a full response for the
-- first post-upgrade CI refresh so the projection gains workflow identity.
UPDATE github_snapshot
SET validators = json_remove(validators, '$."/actions/runs?per_page=40"'), retry_at = 0
WHERE json_array_length(snapshot, '$.ci.items') > 0
  AND json_type(snapshot, '$.ci.items[0].workflow_id') IS NULL;
--> statement-breakpoint
UPDATE github_details
SET validators = json_remove(validators, '$.core'), retry_at = 0
WHERE cache_key LIKE 'runs:%' AND json_type(payload, '$.detail.workflow_id') IS NULL;
