-- Giveaway #001 foundation. Schema only: no entries are accepted until the API is enabled.
CREATE TABLE IF NOT EXISTS giveaways (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 prize_description TEXT NOT NULL,
 prize_value_cents INTEGER NOT NULL CHECK(prize_value_cents >= 0),
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','closed','drawn','cancelled')),
 opens_at INTEGER,
 closes_at INTEGER,
 created_at INTEGER NOT NULL,
 CHECK(opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at)
);
CREATE TABLE IF NOT EXISTS giveaway_entries (
 id TEXT PRIMARY KEY,
 giveaway_id TEXT NOT NULL REFERENCES giveaways(id),
 email TEXT NOT NULL,
 email_hash TEXT NOT NULL,
 tiktok_username TEXT,
 verification_token_hash TEXT,
 verification_expires_at INTEGER,
 verified_at INTEGER,
 created_at INTEGER NOT NULL,
 marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK(marketing_opt_in IN (0,1)),
 UNIQUE(giveaway_id,email_hash)
);
CREATE INDEX IF NOT EXISTS idx_giveaway_entries_verified ON giveaway_entries(giveaway_id,verified_at);
CREATE TABLE IF NOT EXISTS giveaway_draws (
 id TEXT PRIMARY KEY,
 giveaway_id TEXT NOT NULL UNIQUE REFERENCES giveaways(id),
 entry_id TEXT NOT NULL REFERENCES giveaway_entries(id),
 eligible_count INTEGER NOT NULL,
 selected_at INTEGER NOT NULL,
 selection_method TEXT NOT NULL,
 audit_hash TEXT NOT NULL
);
