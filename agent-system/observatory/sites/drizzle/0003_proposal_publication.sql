ALTER TABLE proposals ADD COLUMN github_state TEXT CHECK (github_state IN ('pending', 'published'));
