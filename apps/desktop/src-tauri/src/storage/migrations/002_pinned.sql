ALTER TABLE tasks ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
CREATE INDEX tasks_pinned_idx ON tasks(pinned, last_opened_at DESC);
