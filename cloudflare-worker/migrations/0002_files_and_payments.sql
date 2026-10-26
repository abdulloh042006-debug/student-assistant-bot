-- Apply this migration to the existing D1 database after schema.sql.
-- Keeps existing orders and settings intact.
CREATE TABLE IF NOT EXISTS order_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  file_name TEXT,
  mime_type TEXT,
  kind TEXT NOT NULL DEFAULT 'attachment' CHECK(kind IN ('attachment','receipt')),
  review_status TEXT NOT NULL DEFAULT 'not_required' CHECK(review_status IN ('not_required','pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_attachments_order_id
  ON order_attachments(order_id);
CREATE INDEX IF NOT EXISTS idx_order_attachments_user_kind
  ON order_attachments(user_id, kind);

CREATE TABLE IF NOT EXISTS payment_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL REFERENCES orders(id),
  user_id INTEGER NOT NULL,
  file_id TEXT NOT NULL,
  file_unique_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_reviews_status
  ON payment_reviews(status);
