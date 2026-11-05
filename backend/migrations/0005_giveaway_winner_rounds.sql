-- Append-only record of winner notification, acceptance, and alternate draws.
CREATE TABLE IF NOT EXISTS giveaway_winner_rounds (
 id TEXT PRIMARY KEY,
 giveaway_id TEXT NOT NULL REFERENCES giveaways(id),
 round_number INTEGER NOT NULL CHECK(round_number >= 1),
 entry_id TEXT NOT NULL REFERENCES giveaway_entries(id),
 eligible_count INTEGER NOT NULL CHECK(eligible_count > 0),
 selected_at INTEGER NOT NULL,
 notified_at INTEGER,
 response_deadline_at INTEGER,
 responded_at INTEGER,
 outcome TEXT NOT NULL DEFAULT 'selected' CHECK(outcome IN ('selected','notified','accepted','expired','ineligible')),
 selection_method TEXT NOT NULL,
 audit_hash TEXT NOT NULL,
 UNIQUE(giveaway_id,round_number),
 UNIQUE(giveaway_id,entry_id),
 CHECK((notified_at IS NULL AND response_deadline_at IS NULL) OR (notified_at IS NOT NULL AND response_deadline_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_giveaway_winner_rounds_giveaway ON giveaway_winner_rounds(giveaway_id,round_number);
