-- Apply once after schema.sql and migrations/0002_files_and_payments.sql.
-- Adds administrator price/deadline confirmation, attachment source metadata, and webhook deduplication.
ALTER TABLE orders ADD COLUMN final_price INTEGER;
ALTER TABLE orders ADD COLUMN discount_amount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN confirmed_deadline TEXT;
ALTER TABLE orders ADD COLUMN applied_discount_ids TEXT NOT NULL DEFAULT '[]';

ALTER TABLE order_attachments ADD COLUMN media_type TEXT NOT NULL DEFAULT 'document';
ALTER TABLE order_attachments ADD COLUMN source_chat_id INTEGER;
ALTER TABLE order_attachments ADD COLUMN source_message_id INTEGER;

CREATE TABLE IF NOT EXISTS webhook_updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing' CHECK(status IN ('processing','processed','failed')),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count >= 1)
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('allow_discount_stacking', '0');
