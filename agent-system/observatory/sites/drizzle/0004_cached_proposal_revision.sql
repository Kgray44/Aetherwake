ALTER TABLE proposals ADD COLUMN stale_revision INTEGER NOT NULL DEFAULT 0 CHECK (stale_revision IN (0, 1));
