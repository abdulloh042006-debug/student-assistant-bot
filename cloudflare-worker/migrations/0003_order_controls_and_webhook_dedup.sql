-- Apply once after schema.sql and migrations/0002_files_and_payments.sql.
-- Adds administrator price/deadline confirmation, attachment source metadata, and webhook deduplication.
ALTER TABLE orders ADD COLUMN final_price INTEGER;
ALTER TABLE orders ADD COLUMN confirmed_deadline TEXT;
ALTER TABLE orders ADD COLUMN applied_discount_ids TEXT NOT NULL DEFAULT '[]';

ALTER TABLE order_attachments ADD COLUMN media_type TEXT NOT NULL DEFAULT 'document';
ALTER TABLE order_attachments ADD COLUMN source_chat_id INTEGER;
ALTER TABLE order_attachments ADD COLUMN source_message_id INTEGER;

CREATE TABLE IF NOT EXISTS webhook_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings(key, value) VALUES ('allow_discount_stacking', '0');
