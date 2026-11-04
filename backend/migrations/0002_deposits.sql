CREATE TABLE IF NOT EXISTS deposits (
 id TEXT PRIMARY KEY,
 token_hash TEXT NOT NULL UNIQUE,
 customer_name TEXT NOT NULL,
 customer_email TEXT,
 description TEXT NOT NULL,
 total_cents INTEGER NOT NULL CHECK(total_cents >= 100),
 deposit_cents INTEGER NOT NULL CHECK(deposit_cents >= 50 AND deposit_cents <= total_cents),
 status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','checkout_pending','paid','review_required','cancelled')),
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 stripe_session_id TEXT UNIQUE,
 payment_intent_id TEXT,
 paid_at INTEGER
);
CREATE INDEX IF NOT EXISTS deposits_status ON deposits(status, created_at);