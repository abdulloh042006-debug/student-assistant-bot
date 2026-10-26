import sqlite3
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "cloudflare-worker"

class MigrationTests(unittest.TestCase):
    def test_order_data_survives_migrations_and_new_tables_are_usable(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        db.executescript((WORKER / "schema.sql").read_text(encoding="utf-8"))
        db.execute(
            "INSERT INTO orders(user_id,username,service,description,quantity,deadline,budget,priority,estimate,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
            (101, "student", "Prezentatsiya", "AI mavzusi", "12", "ertaga", "20000", "Muvozanatli", 10000, "2026-10-26T10:00:00Z")
        )
        db.commit()
        db.executescript((WORKER / "migrations" / "0002_files_and_payments.sql").read_text(encoding="utf-8"))
        db.executescript((WORKER / "migrations" / "0003_order_controls_and_webhook_dedup.sql").read_text(encoding="utf-8"))

        order = db.execute("SELECT user_id,description,estimate,final_price,discount_amount,applied_discount_ids FROM orders WHERE id=1").fetchone()
        self.assertEqual(order, (101, "AI mavzusi", 10000, None, 0, "[]"))

        columns = {row[1] for row in db.execute("PRAGMA table_info(order_attachments)")}
        self.assertTrue({"media_type", "source_chat_id", "source_message_id"}.issubset(columns))

        db.execute(
            "INSERT INTO order_attachments(order_id,user_id,file_id,kind,review_status,media_type,source_chat_id,source_message_id) VALUES(1,101,'file-1','receipt','pending','photo',101,55)"
        )
        db.execute(
            "INSERT INTO payment_reviews(order_id,user_id,file_id,status) VALUES(1,101,'file-1','pending')"
        )
        db.execute("INSERT OR IGNORE INTO webhook_updates(update_id) VALUES(123)")
        db.execute("INSERT OR IGNORE INTO webhook_updates(update_id) VALUES(123)")
        self.assertEqual(db.execute("SELECT COUNT(*) FROM webhook_updates").fetchone()[0], 1)
        self.assertEqual(db.execute("SELECT COUNT(*) FROM payment_reviews").fetchone()[0], 1)
        db.close()

if __name__ == "__main__":
    unittest.main()
