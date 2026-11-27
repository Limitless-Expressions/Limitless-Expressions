-- Additive refund tracking; preserve existing fulfillment status and artwork records.
-- This migration does not rewrite the orders table or change historical status values.
ALTER TABLE orders ADD COLUMN refund_status TEXT NOT NULL DEFAULT 'none'
  CHECK (refund_status IN ('none', 'partial', 'full'));
CREATE INDEX IF NOT EXISTS orders_payment_intent_idx ON orders(payment_intent_id);
