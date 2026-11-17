ALTER TABLE proposals ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE proposals ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
--> statement-breakpoint
ALTER TABLE proposals ADD COLUMN receipts TEXT NOT NULL DEFAULT '[]';
