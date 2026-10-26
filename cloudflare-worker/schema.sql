CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  username TEXT,
  service TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity TEXT NOT NULL DEFAULT '',
  deadline TEXT NOT NULL DEFAULT '',
  budget TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '',
  estimate INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Yangi',
  payment_status TEXT NOT NULL DEFAULT 'To‘lov talab qilinmagan',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  user_id INTEGER PRIMARY KEY,
  state TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS discounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('percent','fixed')),
  amount INTEGER NOT NULL CHECK(amount > 0),
  active INTEGER NOT NULL DEFAULT 1,
  starts_at TEXT,
  expires_at TEXT,
  max_uses INTEGER,
  uses_count INTEGER NOT NULL DEFAULT 0,
  service TEXT,
  requires_review INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS discount_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discount_id INTEGER NOT NULL REFERENCES discounts(id),
  user_id INTEGER NOT NULL,
  order_id INTEGER REFERENCES orders(id),
  status TEXT NOT NULL DEFAULT 'pending',
  proof_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(discount_id, user_id)
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
