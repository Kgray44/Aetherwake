ALTER TABLE task_worker_liveness ADD COLUMN task_scope TEXT;
--> statement-breakpoint
ALTER TABLE task_worker_liveness ADD COLUMN conversation_continuation INTEGER;
--> statement-breakpoint
ALTER TABLE task_worker_liveness ADD COLUMN last_error TEXT;
--> statement-breakpoint
ALTER TABLE task_worker_liveness ADD COLUMN last_error_at INTEGER;
