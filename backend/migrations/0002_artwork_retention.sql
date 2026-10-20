-- Manual fulfillment starts the 90-day artwork retention clock.
-- Existing orders are intentionally left unfulfilled until reviewed by an administrator.
ALTER TABLE orders ADD COLUMN fulfilled_at INTEGER;
ALTER TABLE artwork ADD COLUMN deleted_at INTEGER;
CREATE INDEX IF NOT EXISTS orders_fulfilled_at ON orders(fulfilled_at);
