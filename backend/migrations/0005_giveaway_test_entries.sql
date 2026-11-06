-- Isolated test entries never appear in the real giveaway_entries table or winner selection.
CREATE TABLE IF NOT EXISTS giveaway_test_entries (id TEXT PRIMARY KEY,giveaway_id TEXT NOT NULL,token_hash TEXT UNIQUE,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,verified_at INTEGER);
CREATE INDEX IF NOT EXISTS idx_giveaway_test_entries_id ON giveaway_test_entries(giveaway_id,verified_at);
