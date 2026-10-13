PRAGMA foreign_keys = ON;
CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  access_hash TEXT NOT NULL UNIQUE,
  request_hash TEXT NOT NULL,
  product TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customization TEXT NOT NULL,
  pricing_snapshot TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK(status IN ('submitted','awaiting_payment','paid','review_required')),
  checkout_eligible INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  stripe_session_id TEXT UNIQUE,
  payment_intent_id TEXT,
  shipping_details TEXT,
  amount_total INTEGER,
  currency TEXT
);
CREATE TABLE artwork (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  object_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  order_reference TEXT,
  outcome TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  order_id TEXT REFERENCES orders(id),
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt INTEGER NOT NULL,
  claimed_at INTEGER,
  provider_id TEXT,
  last_error TEXT
);
CREATE INDEX notification_due ON notifications(state, next_attempt);
CREATE INDEX artwork_order ON artwork(order_id);
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
