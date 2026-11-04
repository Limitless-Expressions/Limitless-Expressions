-- Apply once to the production D1 database before deploying the updated Worker.
ALTER TABLE deposits ADD COLUMN picked_up_at INTEGER;
